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

- `GitOps Change Timeline`
  - file: `infrastructure/monitoring/grafana-dashboard-gitops-change-timeline.yaml`
  - purpose: Flux reconcile activity, controller noise, slow objects, and restart spikes in `flux-system`.

- `DNS and Access Paths`
  - file: `infrastructure/monitoring/grafana-dashboard-dns-access-paths.yaml`
  - purpose: CoreDNS health, DNS failure signals, ingress host inventory, TLS coverage, and public-edge access surfaces.

- `TrueNAS Host Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-truenas-host-overview.yaml`
  - purpose: NAS management-plane probes, NFS reachability, Netdata memory headroom, ARC size, and per-service memory for `nginx` and `middlewared`.

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

- These dashboards are built from kubelet, kube-state-metrics, Flux controllers, exposure-control, Prometheus, Grafana, resource-advisor, and node-exporter.
- `TrueNAS Host Overview` additionally depends on the NAS Netdata endpoint at `${NAS_IP}:6999`, scraped by `ServiceMonitor/monitoring/truenas-netdata`.
- `nodeExporter` is enabled primarily to surface host hardware signals such as the utility node Raspberry Pi low-voltage alarm on the power dashboard.
- The `monitoring` namespace now carries privileged PodSecurity labels because node-exporter requires host mounts and host networking.
- Host-disk latency and broader hardware tuning are still mostly out of scope for these dashboards unless a panel explicitly uses those series.
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
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-gitops-change-timeline.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-dns-access-paths.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/servicemonitor-truenas-netdata.yaml
kubectl apply --dry-run=client -f infrastructure/monitoring/grafana-dashboard-truenas-host-overview.yaml

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get configmap -n monitoring | rg grafana-dashboard
kubectl get prometheusrule -n monitoring homelab-ops-dashboards -o yaml
```
