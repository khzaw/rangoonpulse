# Node Power Estimation Dashboard

This cluster now exposes an estimated node power model in Grafana without adding
new exporters.

## Why Estimate-Only

- There is no smart-plug/UPS wall-power telemetry source in this setup.
- Node exporter remains disabled by policy in monitoring.
- The model uses existing Prometheus metrics only, so runtime overhead is minimal.

## GitOps Objects

- Rules: `infrastructure/monitoring/prometheusrule-power-estimation.yaml`
- Dashboard: `infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml`
- Included by: `infrastructure/monitoring/kustomization.yaml`

## Model

Per-node estimate:

```
estimated_watts = idle_watts + (max_watts - idle_watts) * cpu_utilization_ratio
```

Where:

- `cpu_utilization_ratio` comes from:
  - `container_cpu_usage_seconds_total` (kubelet/cAdvisor, 5m rate)
  - divided by `machine_cpu_cores`
- `idle_watts` and `max_watts` are fixed constants per node.

Current defaults:

- `talos-7nf-osf`: idle `20W`, max `75W`
- `talos-uua-g6r`: idle `4W`, max `12W`

## Tuning Constants

When hardware changes (PSU, disks, CPU platform, added node), update constants in:

- `infrastructure/monitoring/prometheusrule-power-estimation.yaml`

Also add explicit constants for every new node, or that node will not appear in
estimated power results.

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get prometheusrule -n monitoring node-power-estimation -o yaml
kubectl get configmap -n monitoring grafana-dashboard-node-power-estimation -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:node_estimated_power_watts'
```

Grafana dashboard title: `Node Power Estimation`.
