#!/bin/sh
# Uses only tools already present in the shared PostgreSQL image.
set -eu
umask 077
export PGCONNECT_TIMEOUT=10
export PGAPPNAME=power-ledger
[ -n "$POWER_LEDGER_IRIS_START_SECONDS" ] || {
  echo 'Iris enrollment is missing; refusing to advance the ledger' >&2
  exit 1
}
# Five-minute settlement delay, aligned to the recording rule's two-minute cadence.
POWER_LEDGER_CUTOFF=$(( ($(date +%s) - 300) / 120 * 120 ))
export POWER_LEDGER_CUTOFF
# Fetch raw recorded points, not query_range resamples (which can repeat stale values).
query="homelab:node_estimated_cost_sgd_per_hour%7Bnode%3D~%22$POWER_LEDGER_NODES%22%7D%5B1123200s%5D"
wget -q -T 60 -O /tmp/power-samples.json \
  "$PROMETHEUS_URL/api/v1/query?query=$query&time=$POWER_LEDGER_CUTOFF"
[ "$(wc -c < /tmp/power-samples.json)" -le 4194304 ] || {
  echo 'Unexpectedly large Prometheus response' >&2
  exit 1
}
psql -X -w -v ON_ERROR_STOP=1 -f /scripts/collect.sql
# Cache a token-free copy in the existing cockpit through its authenticated push route.
# Credentials live only in a private temporary body file, never process arguments/logs.
psql -X -w -q -v ON_ERROR_STOP=1 -f /scripts/snapshot.sql
wget -q -T 30 --header 'Content-Type: application/json' --header "Host: $POWER_LEDGER_COCKPIT_HOST" \
  --post-file /tmp/ledger-snapshot.json -O /dev/null \
  http://exposure-control.default.svc.cluster.local:8080/api/power-cost-ledger
rm -f /tmp/ledger-snapshot.json /tmp/power-samples.json
if [ -r /sys/fs/cgroup/memory.peak ]; then
  read -r peak_bytes < /sys/fs/cgroup/memory.peak
  echo "Collector peak cgroup memory: $peak_bytes bytes"
fi
