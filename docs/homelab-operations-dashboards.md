---
title: Homelab Operations Dashboards
summary: Current operating guidance for Homelab Operations Dashboards.
status: active
owner: homelab
last_reviewed: 2026-11-16
---

# Homelab Operations Dashboards

Additional GitOps-managed Grafana dashboards live under `infrastructure/monitoring/`.

## Dashboards

- `Iris Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-iris-overview.yaml`
  - purpose: native macOS host metrics, launchd supervision, readiness, and APFS capacity; see `docs/iris-operations.md`.

- `Homelab Control Room`
  - file: `infrastructure/monitoring/grafana-dashboard-homelab-control-room.yaml`
  - purpose: operational status across AdGuard checks, DNS router/node redundancy, cluster health, node pressure, Flux, exposures, restarts, and power.

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
  - purpose: per-AdGuard private DNS checks and latency, Tailscale router readiness/placement/resources, CoreDNS health, DNS failure signals, ingress host inventory, TLS coverage, and public-edge access surfaces. See [DNS dashboard](./dns-access-path-dashboard.md) for probe boundaries and missing-telemetry behavior.

- `TrueNAS Host Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-truenas-host-overview.yaml`
  - purpose: NAS management-plane probes, NFS reachability, Netdata memory headroom, ARC size, and per-service memory.

- `Node Capacity Overview`
  - file: `infrastructure/monitoring/grafana-dashboard-node-capacity-overview.yaml`
  - purpose: node fit, schedulable headroom, and workload capacity.

- `Node Power Estimation`
  - file: `infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml`
  - purpose: estimated node power, cost, and Raspberry Pi low-voltage telemetry.

- `TLS Certificate Audit`
  - file: `infrastructure/monitoring/grafana-dashboard-tls-certificate-audit.yaml`
  - purpose: certificate readiness, expiry, issuer, and hostname coverage.

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
- `Storage Risk Overview` uses `truenas-pvc-dataset-exporter` for TrueNAS-backed PVC dataset usage, so NAS media datasets remain visible even when kubelet/CSI volume stats are missing. The exporter reads TrueNAS at most every 15 minutes and serves that read to each 120-second scrape; `truenas_pvc_dataset_last_scrape_timestamp_seconds` is the read time. PVC usage alerts use kubelet volume stats, not these series.
- `local-path` claims are hostPath directories, so the kubelet never emits `kubelet_volume_stats_*` for them. `infrastructure/storage/local-path-provisioner/usage-exporter.yaml` runs a busybox DaemonSet that walks `/var/mnt/local-path-provisioner` (primary) and `/var/lib/local-path-provisioner` (utility node) with `du` every hour, writes `local_path_pvc_used_bytes{namespace,persistentvolumeclaim,volumename,node}` into an emptyDir, and serves it on port 9101 with busybox `httpd` for a PodMonitor. It deliberately avoids node-exporter's textfile collector: Talos keeps `/var/lib` at 0700 and `/var/mnt` read-only, so no host path works for both a root writer and the UID 65534 node-exporter. The `homelab:local_path_pvc_*` rules join on `volumename` so orphaned directories from deleted PVs are ignored, and capacity is the claim's requested size because local-path enforces no quota. `local_path_pvc_exporter_last_run_timestamp_seconds` per node is the staleness signal; no alert consumes it today. It advances once per interval plus walk time, so a staleness check must tolerate more than an hour between walks. The primary-node walk is one single-threaded `du` of about four CPU-seconds; the container's one-core limit keeps it from being CFS-throttled. The hourly cadence is deliberate: per-claim usage feeds dashboards and Control Panel Pulse but no alert, Pulse's time-to-full fit already reads hourly samples, and node-exporter filesystem alerts cover disk-full on the shared filesystem.
- `nodeExporter` is enabled primarily to surface host hardware signals such as the utility node Raspberry Pi low-voltage alarm on the power dashboard.
- The `monitoring` namespace carries privileged PodSecurity labels because node-exporter requires host mounts and host networking.
- Host-disk latency and broader hardware tuning are still mostly out of scope for these dashboards unless a panel explicitly uses those series.
- `Public Edge Overview` reflects the current exposure-control exporter surface. It does not infer per-share identity beyond the totals exported today.

## Verification

```bash

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
