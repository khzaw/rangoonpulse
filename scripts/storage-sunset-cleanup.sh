#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/storage-sunset-cleanup.sh [options]

Default mode is dry-run (no deletes).

Options:
  --apply                               Execute deletions.
  --namespace <ns>                      Limit PVC/claim scope to one namespace.
  --match <regex>                       Regex filter against "<ns>/<name>" claim and PV name.
  --delete-truenas-datasets             Also delete released TrueNAS datasets via API.
  --truenas-host <host>                 TrueNAS host/IP (default: 10.0.0.210).
  --truenas-secret-namespace <ns>       Secret namespace for TrueNAS creds (default: democratic-csi).
  --truenas-secret-name <name>          Secret name for TrueNAS creds (default: truenas-credentials).
  --wait-seconds <n>                    Wait after PVC deletion before PV sweep (default: 5).
  -h, --help                            Show this help.

Examples:
  scripts/storage-sunset-cleanup.sh
  scripts/storage-sunset-cleanup.sh --namespace default --match 'default/(booklore|vaultwarden)'
  scripts/storage-sunset-cleanup.sh --apply --namespace default --match 'default/booklore'
  scripts/storage-sunset-cleanup.sh --apply --delete-truenas-datasets
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

APPLY=0
NAMESPACE_FILTER=""
MATCH_REGEX=""
DELETE_TRUENAS_DATASETS=0
TRUENAS_HOST="10.0.0.210"
TRUENAS_SECRET_NAMESPACE="democratic-csi"
TRUENAS_SECRET_NAME="truenas-credentials"
WAIT_SECONDS=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --namespace)
      NAMESPACE_FILTER="${2:-}"
      shift 2
      ;;
    --match)
      MATCH_REGEX="${2:-}"
      shift 2
      ;;
    --delete-truenas-datasets)
      DELETE_TRUENAS_DATASETS=1
      shift
      ;;
    --truenas-host)
      TRUENAS_HOST="${2:-}"
      shift 2
      ;;
    --truenas-secret-namespace)
      TRUENAS_SECRET_NAMESPACE="${2:-}"
      shift 2
      ;;
    --truenas-secret-name)
      TRUENAS_SECRET_NAME="${2:-}"
      shift 2
      ;;
    --wait-seconds)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd kubectl
require_cmd jq
require_cmd awk
require_cmd sort
require_cmd comm

if [[ "$DELETE_TRUENAS_DATASETS" -eq 1 ]]; then
  require_cmd curl
  require_cmd base64
fi

TS="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="/tmp/storage-sunset-cleanup-${TS}"
mkdir -p "$REPORT_DIR"

echo "report_dir=$REPORT_DIR"
echo "apply=$APPLY namespace_filter=${NAMESPACE_FILTER:-<none>} match_regex=${MATCH_REGEX:-<none>} delete_truenas_datasets=$DELETE_TRUENAS_DATASETS"

collect_pvc_data() {
  kubectl get pvc -A -o json \
    | jq -r '.items[] | [.metadata.namespace, .metadata.name, (.spec.volumeName // "")] | @tsv' \
    | sort > "$REPORT_DIR/all-pvc.tsv"

  kubectl get pods -A -o json \
    | jq -r '.items[] as $p | ($p.spec.volumes // [])[]? | select(.persistentVolumeClaim != null) | [$p.metadata.namespace, .persistentVolumeClaim.claimName] | @tsv' \
    | sort -u > "$REPORT_DIR/used-pvc.tsv"

  awk -F'\t' -v ns="$NAMESPACE_FILTER" -v re="$MATCH_REGEX" '
    {
      key=$1 "/" $2
      ns_ok=(ns == "" || $1 == ns)
      re_ok=(re == "" || key ~ re || $2 ~ re)
      if (ns_ok && re_ok) print
    }
  ' "$REPORT_DIR/all-pvc.tsv" | sort > "$REPORT_DIR/candidate-pvc.tsv"

  cut -f1,2 "$REPORT_DIR/candidate-pvc.tsv" | sort -u > "$REPORT_DIR/candidate-pvc-keys.tsv"
  sort -u "$REPORT_DIR/used-pvc.tsv" > "$REPORT_DIR/used-pvc-keys.tsv"
  comm -23 "$REPORT_DIR/candidate-pvc-keys.tsv" "$REPORT_DIR/used-pvc-keys.tsv" > "$REPORT_DIR/orphan-pvc-keys.tsv"

  awk -F'\t' '
    NR==FNR {
      map[$1 "\t" $2] = $3
      next
    }
    {
      key=$1 "\t" $2
      print $1 "\t" $2 "\t" map[key]
    }
  ' "$REPORT_DIR/candidate-pvc.tsv" "$REPORT_DIR/orphan-pvc-keys.tsv" > "$REPORT_DIR/orphan-pvc.tsv"
}

collect_released_pv_data() {
  kubectl get pv -o json \
    | jq -r '
      .items[]
      | select(.status.phase == "Released")
      | [
          .metadata.name,
          (.spec.persistentVolumeReclaimPolicy // ""),
          (.spec.storageClassName // ""),
          ((.spec.claimRef.namespace // "?") + "/" + (.spec.claimRef.name // "?")),
          (.spec.csi.driver // ""),
          (.spec.csi.volumeAttributes.provisioner_driver // ""),
          (.spec.csi.volumeHandle // ""),
          (.spec.csi.volumeAttributes.share // "")
        ]
      | @tsv
    ' | sort > "$REPORT_DIR/released-pv-raw.tsv"

  awk -F'\t' -v ns="$NAMESPACE_FILTER" -v re="$MATCH_REGEX" '
    {
      claim=$4
      claim_ns=claim
      sub(/\/.*/, "", claim_ns)
      ns_ok=(ns == "" || claim_ns == ns)
      re_ok=(re == "" || claim ~ re || $1 ~ re)
      if (ns_ok && re_ok) print
    }
  ' "$REPORT_DIR/released-pv-raw.tsv" > "$REPORT_DIR/released-pv.tsv"
}

collect_bound_truenas_datasets() {
  kubectl get pv -o json \
    | jq -r '
      .items[]
      | select(.status.phase == "Bound")
      | select(.spec.csi != null)
      | select((.spec.csi.volumeAttributes.provisioner_driver // "") == "freenas-api-nfs")
      | .spec.csi.volumeAttributes.share
    ' \
    | sed 's#^/mnt/##' \
    | sort -u > "$REPORT_DIR/bound-truenas-datasets.tsv"
}

collect_pvc_data
collect_released_pv_data

echo "candidate_pvcs=$(wc -l < "$REPORT_DIR/candidate-pvc.tsv" | tr -d ' ')"
echo "orphan_pvcs=$(wc -l < "$REPORT_DIR/orphan-pvc.tsv" | tr -d ' ')"
echo "released_pvs=$(wc -l < "$REPORT_DIR/released-pv.tsv" | tr -d ' ')"

echo
echo "orphan PVCs (ns name volumeName):"
if [[ -s "$REPORT_DIR/orphan-pvc.tsv" ]]; then
  cat "$REPORT_DIR/orphan-pvc.tsv"
else
  echo "<none>"
fi

echo
echo "released PVs (pv reclaimPolicy sc claim csiDriver provisionerDriver volumeHandle share):"
if [[ -s "$REPORT_DIR/released-pv.tsv" ]]; then
  cat "$REPORT_DIR/released-pv.tsv"
else
  echo "<none>"
fi

if [[ "$APPLY" -ne 1 ]]; then
  echo
  echo "Dry-run only. Re-run with --apply to execute deletions."
  exit 0
fi

echo
echo "Applying cleanup..."

if [[ -s "$REPORT_DIR/orphan-pvc.tsv" ]]; then
  while IFS=$'\t' read -r ns name _; do
    echo "delete pvc $ns/$name"
    kubectl delete pvc -n "$ns" "$name"
  done < "$REPORT_DIR/orphan-pvc.tsv"

  echo "waiting ${WAIT_SECONDS}s for PV phase transitions..."
  sleep "$WAIT_SECONDS"
fi

collect_released_pv_data

mkdir -p "$REPORT_DIR/released-pv-yaml"
if [[ -s "$REPORT_DIR/released-pv.tsv" ]]; then
  while IFS=$'\t' read -r pv _; do
    kubectl get pv "$pv" -o yaml > "$REPORT_DIR/released-pv-yaml/${pv}.yaml"
  done < "$REPORT_DIR/released-pv.tsv"
fi

if [[ -s "$REPORT_DIR/released-pv.tsv" ]]; then
  while IFS=$'\t' read -r pv _; do
    echo "delete pv $pv"
    kubectl delete pv "$pv" --wait=false
  done < "$REPORT_DIR/released-pv.tsv"
else
  echo "no released PVs to delete"
fi

if [[ "$DELETE_TRUENAS_DATASETS" -eq 1 ]]; then
  echo
  echo "TrueNAS dataset cleanup enabled."

  kubectl get secret -n "$TRUENAS_SECRET_NAMESPACE" "$TRUENAS_SECRET_NAME" >/dev/null
  TRUENAS_USER="$(kubectl get secret -n "$TRUENAS_SECRET_NAMESPACE" "$TRUENAS_SECRET_NAME" -o jsonpath='{.data.username}' | base64 -d)"
  TRUENAS_PASS="$(kubectl get secret -n "$TRUENAS_SECRET_NAMESPACE" "$TRUENAS_SECRET_NAME" -o jsonpath='{.data.password}' | base64 -d)"

  awk -F'\t' '
    $6 == "freenas-api-nfs" && $8 != "" {
      ds=$8
      sub("^/mnt/", "", ds)
      print ds "\t" $1 "\t" $4 "\t" $3
    }
  ' "$REPORT_DIR/released-pv.tsv" | sort -u > "$REPORT_DIR/released-truenas-datasets.tsv"

  collect_bound_truenas_datasets

  cut -f1 "$REPORT_DIR/released-truenas-datasets.tsv" | sort -u > "$REPORT_DIR/released-truenas-dataset-keys.tsv"
  comm -23 "$REPORT_DIR/released-truenas-dataset-keys.tsv" "$REPORT_DIR/bound-truenas-datasets.tsv" > "$REPORT_DIR/truenas-delete-keys.tsv"

  awk -F'\t' '
    NR==FNR { allow[$1]=1; next }
    ($1 in allow) { print }
  ' "$REPORT_DIR/truenas-delete-keys.tsv" "$REPORT_DIR/released-truenas-datasets.tsv" > "$REPORT_DIR/truenas-delete-plan.tsv"

  if [[ -s "$REPORT_DIR/truenas-delete-plan.tsv" ]]; then
    : > "$REPORT_DIR/truenas-delete-results.tsv"
    : > "$REPORT_DIR/truenas-delete-verify.tsv"

    while IFS=$'\t' read -r ds pv claim sc; do
      enc="$(printf '%s' "$ds" | jq -sRr @uri)"
      code="$(curl -sS -u "$TRUENAS_USER:$TRUENAS_PASS" -X DELETE -o "$REPORT_DIR/.truenas-delete-response.json" -w '%{http_code}' "http://${TRUENAS_HOST}/api/v2.0/pool/dataset/id/${enc}/?recursive=true&force=true" || true)"
      if [[ "$code" == "200" || "$code" == "202" || "$code" == "204" ]]; then
        echo -e "${ds}\t${pv}\t${claim}\t${sc}\tDELETE_OK\t${code}" >> "$REPORT_DIR/truenas-delete-results.tsv"
      else
        msg="$(tr '\n' ' ' < "$REPORT_DIR/.truenas-delete-response.json" | cut -c1-300)"
        echo -e "${ds}\t${pv}\t${claim}\t${sc}\tDELETE_ERR\t${code}\t${msg}" >> "$REPORT_DIR/truenas-delete-results.tsv"
      fi
    done < "$REPORT_DIR/truenas-delete-plan.tsv"

    while IFS=$'\t' read -r ds _; do
      enc="$(printf '%s' "$ds" | jq -sRr @uri)"
      code="$(curl -sS -u "$TRUENAS_USER:$TRUENAS_PASS" -o "$REPORT_DIR/.truenas-verify-response.json" -w '%{http_code}' "http://${TRUENAS_HOST}/api/v2.0/pool/dataset/id/${enc}" || true)"
      if [[ "$code" == "200" ]]; then
        echo -e "${ds}\tSTILL_EXISTS\t${code}" >> "$REPORT_DIR/truenas-delete-verify.tsv"
      else
        echo -e "${ds}\tGONE\t${code}" >> "$REPORT_DIR/truenas-delete-verify.tsv"
      fi
    done < "$REPORT_DIR/truenas-delete-plan.tsv"

    echo "truenas_delete_results=$REPORT_DIR/truenas-delete-results.tsv"
    echo "truenas_delete_verify=$REPORT_DIR/truenas-delete-verify.tsv"
  else
    echo "no safe TrueNAS datasets matched for deletion"
  fi
fi

PV_SUMMARY="$(
  kubectl get pv -o json \
    | jq -r '"total=\(.items|length) bound=\([.items[] | select(.status.phase=="Bound")]|length) released=\([.items[] | select(.status.phase=="Released")]|length)'
)"
echo
echo "post_cleanup_pv_summary: $PV_SUMMARY"

collect_pvc_data
echo "post_cleanup_orphan_pvcs=$(wc -l < "$REPORT_DIR/orphan-pvc.tsv" | tr -d ' ')"
echo
echo "done. report_dir=$REPORT_DIR"
