# Homelab Operations Dashboards

Additional GitOps-managed Grafana dashboards live under `infrastructure/monitoring/`.

## Dashboards

- `Homelab Control Room`
  - file: `infrastructure/monitoring/grafana-dashboard-homelab-control-room.yaml`
  - purpose: single-screen operational status across cluster health, node pressure, Flux, exposures, restarts, and power.

- `Storage Risk Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-storage-risk-overview.yaml`
  - purpose: PVC saturation, storage-class split, projected fill pressure, and top-risk claims.

- `Public Edge Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-public-edge-overview.yaml`
  - purpose: exposure-control lifecycle, current active shares, deny reasons, and reconcile health.

- `Efficiency and Placement`
  - file: `infrastructure/monitoring/grafana-dashboard-efficiency-and-placement.yaml`
  - purpose: requested-vs-actual pressure, resource-advisor budget signals, and workload placement on the primary node vs Pi.

- `Stateful Services Risk`
  - file: `infrastructure/monitoring/grafana-dashboard-stateful-services-risk.yaml`
  - purpose: PVC-backed pod health, restart pressure, and persistent-volume risk for stateful services.

## Shared Recording Rules

These dashboards rely on precomputed series in:

- `infrastructure/monitoring/prometheusrule-homelab-ops-dashboards.yaml`

Current shared metrics:

- `homelab:pvc_used_bytes`
- `homelab:pvc_capacity_bytes`
- `homelab:pvc_available_bytes`
- `homelab:pvc_utilization:ratio`
- `homelab:node_requested_cpu_cores`
- `homelab:node_requested_memory_bytes`
- `homelab:node_allocatable_cpu_cores`
- `homelab:node_allocatable_memory_bytes`
- `homelab:node_requested_cpu_utilization:ratio`
- `homelab:node_requested_memory_utilization:ratio`

## Notes

- These dashboards are built only from metrics already scraped in this cluster: kubelet, kube-state-metrics, Flux controllers, exposure-control, Prometheus, Grafana, and resource-advisor.
- `nodeExporter` remains disabled, so host-disk IOPS, host filesystem latency, thermals, and hardware-network counters are intentionally out of scope.
- `Public Edge Overview` reflects the current exposure-control exporter surface. It does not infer per-share identity beyond the totals exported today.

## Verification

```bash
cd /Users/khz/Code/rangoonpulse

kubectl apply --dry-run=client -f infrastructure/monitoring/prometheusrule-homelab-ops-dashboards.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-homelab-control-room.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-storage-risk-overview.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-public-edge-overview.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-efficiency-and-placement.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-stateful-services-risk.yaml

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get configmap -n monitoring | rg grafana-dashboard
kubectl get prometheusrule -n monitoring homelab-ops-dashboards -o yaml
```
