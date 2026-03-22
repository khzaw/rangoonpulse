# Node Power Estimation Dashboard

This cluster now exposes an estimated node power model in Grafana plus a live
Raspberry Pi low-voltage signal for the utility node.

## Why Estimate-Only

- There is no smart-plug/UPS wall-power telemetry source in this setup.
- Node exporter is enabled so Grafana can surface the Raspberry Pi utility node's
  low-voltage alarm before workloads fail.
- The wattage model still uses existing cluster metrics only, so runtime overhead
  remains low and the power/cost figures are still estimates.
- Energy and cost panels are still estimates because the underlying watt values are estimated.

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

- `cpu_utilization_ratio` prefers whole-host kubelet resource metrics when available:
  - `node_cpu_usage_seconds_total` (kubelet `/metrics/resource`, 5m rate)
  - divided by `machine_cpu_cores`
- fallback if host-level resource metrics are absent:
  - `container_cpu_usage_seconds_total` (kubelet/cAdvisor, 5m rate)
  - divided by `machine_cpu_cores`
- `idle_watts` and `max_watts` are fixed constants per node.

Current defaults:

- `talos-7nf-osf`: idle `20W`, max `75W`
- `talos-uua-g6r`: idle `4W`, max `12W`

## Live Utility-Node Power Health

- `prometheus-node-exporter` now scrapes the Raspberry Pi utility node hardware sensors.
- The dashboard adds a live low-voltage alarm sourced from the Pi `rpi_volt` hwmon device.
- A current alarm means the node is presently below its low-voltage threshold.
- The dashboard also shows whether a low-voltage condition appeared anywhere inside the
  selected Grafana time range.
- This low-voltage panel is real hardware telemetry; only the wattage and energy panels
  remain estimated.

## Tuning Constants

When hardware changes (PSU, disks, CPU platform, added node), update constants in:

- `infrastructure/monitoring/prometheusrule-power-estimation.yaml`

Also add explicit constants for every new node, or that node will not appear in
estimated power results.

## Energy And Cost Panels

- Energy stats use the active Grafana time range, not a fixed `24h` window.
- The dashboard computes selected-range energy as average estimated watts over the
  chosen period, converted to `kWh`.
- Estimated cost multiplies that energy by the Singapore regulated household tariff
  series `homelab:singapore_household_tariff_sgd_per_kwh`.
- Current tariff pinned in GitOps:
  - `0.2911 SGD/kWh` (`29.11` cents/kWh, with GST)
  - effective `1 January 2026` to `31 March 2026`
  - source: EMA regulated tariff page and SP Group Q1 2026 tariff release
- Review and update this tariff every quarter.

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get prometheusrule -n monitoring node-power-estimation -o yaml
kubectl get configmap -n monitoring grafana-dashboard-node-power-estimation -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:node_estimated_power_watts'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:node_rpi_low_voltage_alarm'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:singapore_household_tariff_sgd_per_kwh'
```

Grafana dashboard title: `Node Power Estimation`.
