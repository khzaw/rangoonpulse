# Ops Command Cheatsheet

Practical command snippets for common day-2 scenarios in this cluster.

## 0) Session Setup

```bash
# Repo root
cd /Users/khz/Code/rangoonpulse

# Use repo kubeconfig explicitly
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig
```

## 1) Flux Health and Reconcile

```bash
# Top-level health
flux get kustomizations -n flux-system
flux get hr -A

# Reconcile source + one kustomization
flux reconcile kustomization flux-system -n flux-system --with-source
flux reconcile kustomization <name> -n flux-system --with-source

# Suspend/resume one kustomization
flux suspend kustomization <name> -n flux-system
flux resume kustomization <name> -n flux-system
```

## 2) Fast Cluster Triage

```bash
kubectl get pods -A
kubectl get events -A --sort-by=.lastTimestamp | tail -n 80

# One HelmRelease
kubectl describe hr -n <ns> <name>
kubectl get pods -n <ns> -o wide
kubectl logs -n <ns> deploy/<name> --tail=120
```

## 3) Ingress + DNS + TLS Checks

```bash
# Public DNS answer
dig @1.1.1.1 +short <host>.khzaw.dev

# Local resolver answer (for split/rebind checks)
dig @10.0.0.233 +short <host>.khzaw.dev

# HTTPS response headers
curl -I --max-time 20 https://<host>.khzaw.dev

# Ingress object + cert-manager events
kubectl describe ingress -n <ns> <ingress-name>
kubectl get certificate -A
kubectl get certificaterequest -A
```

## 4) SOPS (Repo-Local, No Home Directory Keys)

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

# Bootstrap repo-local age key from cluster secret once
mkdir -p .local/sops-age
chmod 700 .local/sops-age
kubectl -n flux-system get secret sops-age -o jsonpath='{.data.age\.agekey}' \
  | base64 -D > .local/sops-age/keys.txt
chmod 600 .local/sops-age/keys.txt

# Use repo-local key for all sops operations
export SOPS_AGE_KEY_FILE="$PWD/.local/sops-age/keys.txt"
```

```bash
# Edit one encrypted secret (auto decrypt/edit/re-encrypt)
sops infrastructure/secrets/<group>/<secret>.yaml

# Sanity check decrypt works
sops -d infrastructure/secrets/<group>/<secret>.yaml >/dev/null && echo "SOPS OK"
```

## 5) Public Edge (Cloudflare Tunnel Pilot)

```bash
# Public edge status
flux get kustomizations -n flux-system | rg 'public-edge|secrets|namespaces'
kubectl get pods -n public-edge -o wide
kubectl logs -n public-edge deploy/cloudflared --tail=120

# Restart cloudflared after token rotation
flux reconcile kustomization secrets -n flux-system --with-source
kubectl rollout restart deployment/cloudflared -n public-edge
kubectl rollout status deployment/cloudflared -n public-edge --timeout=120s
kubectl logs -n public-edge deploy/cloudflared --tail=120
```

```bash
# Pilot hostname validation
dig @1.1.1.1 +short share-sponsorblocktv.khzaw.dev
curl -I --max-time 20 https://share-sponsorblocktv.khzaw.dev
```

## 6) Exposure Control (Phase 2 + 3 MVP)

```bash
# Backend/control panel health
flux get kustomizations -n flux-system | rg 'exposure-control'
kubectl get pods -n default | rg exposure-control
kubectl logs -n default deploy/exposure-control --tail=120
curl -I --max-time 20 https://controlpanel.khzaw.dev
```

```bash
# API actions (default expiry is 2h)
curl -s https://controlpanel.khzaw.dev/api/services | jq

curl -s -X POST https://controlpanel.khzaw.dev/api/services/sponsorblocktv/enable \
  -H 'content-type: application/json' -d '{}' | jq

curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/enable \
  -H 'content-type: application/json' -d '{"hours":2}' | jq

curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/disable \
  -H 'content-type: application/json' -d '{}' | jq
```

## 7) Resource Advisor Operations

```bash
# Runtime components
kubectl get cronjobs -n monitoring | rg resource-advisor
kubectl get jobs -n monitoring | rg resource-advisor
kubectl get configmap resource-advisor-latest -n monitoring -o yaml

# Logs
kubectl logs -n monitoring job/<job-name>
```

```bash
# Manual one-off runs
kubectl create job -n monitoring \
  --from=cronjob/resource-advisor-report \
  resource-advisor-report-manual-$(date +%s)

kubectl create job -n monitoring \
  --from=cronjob/resource-advisor-apply-pr \
  resource-advisor-apply-pr-manual-$(date +%s)
```

## 8) NFS / democratic-csi Incident Path

```bash
# Immediate checks
kubectl -n democratic-csi get pods -o wide
kubectl -n democratic-csi logs <controller-pod> -c external-provisioner --tail=200
kubectl get pods -A | rg 'ContainerCreating|CrashLoopBackOff'
```

```bash
# Controller restart (after root cause fix, e.g. TrueNAS Tailscale Accept Routes off)
kubectl -n democratic-csi delete pod \
  -l app.kubernetes.io/component=controller-linux,app.kubernetes.io/instance=democratic-csi-hdd

kubectl -n democratic-csi delete pod \
  -l app.kubernetes.io/component=controller-linux,app.kubernetes.io/instance=democratic-csi-nvme
```

Reference: `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`

## 9) DNS Reliability Path (CoreDNS + Flux Source)

```bash
kubectl describe gitrepository -n flux-system flux-system
flux reconcile kustomization flux-system -n flux-system --with-source
flux reconcile kustomization dns-reliability -n flux-system --with-source

kubectl get cm -n kube-system coredns -o yaml
kubectl get podmonitor -n monitoring flux-controllers
kubectl get prometheusrule -n monitoring dns-reliability
```

## 10) Talos Node Quick Check

```bash
talosctl -n 10.0.0.197 dashboard
```

## 11) Storage Sunset Cleanup Script

```bash
# Dry run
scripts/storage-sunset-cleanup.sh

# Example apply mode
scripts/storage-sunset-cleanup.sh --apply --namespace default --match 'default/booklore'
```
