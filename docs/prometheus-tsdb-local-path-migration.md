# Prometheus TSDB: Move From NFS to Primary-Node `local-path`

## Why

Grafana long-range panels were timing out while querying Prometheus.

Observed pattern:

- Grafana `/api/ds/query` requests reached roughly `30s` and failed downstream.
- Prometheus logged `/query_range` broken-pipe errors after Grafana gave up.
- Prometheus TSDB lived on `truenas-nfs`, mounted from TrueNAS, while the pod was
  scheduled on the Raspberry Pi node.

This put Prometheus range-query and compaction I/O on the slowest storage path in
the cluster.

## Current Decision

Prometheus now runs on the primary node (`talos-7nf-osf`) with TSDB on
node-local storage:

- node: `talos-7nf-osf`
- storageClass: `local-path`
- PVC size: `12Gi`
- `retention: 14d`
- `retentionSize: 8GB`
- `walCompression: true`

This preserves the 14-day Resource Advisor metrics window while keeping TSDB
cleanup bounded so the PVC does not fill during normal operation.

## Resource Advisor Dependency

Resource Advisor queries Prometheus over a 14-day window.

To avoid resetting data maturity:

- stop Prometheus before the final copy
- copy the full TSDB, including WAL/checkpoint content
- verify the restored data before bringing Prometheus back

Expected result after migration:

- `resource-advisor-latest` keeps `metrics_coverage_days_estimate` near 14
- daily report CronJob continues to produce reports normally
- weekly apply-PR logic keeps its existing maturity gates

## Files

- `infrastructure/monitoring/helmrelease.yaml`
- `flux/kustomizations/monitoring.yaml`
- `docs/resource-advisor-phase1-phase2.md`
