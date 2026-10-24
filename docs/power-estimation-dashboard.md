---
title: Node Power Estimation Dashboard
summary: Current operating guidance for Node Power Estimation Dashboard.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Node Power Estimation Dashboard

This cluster exposes an estimated node power model in Grafana plus a live
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

- `prometheus-node-exporter` scrapes the Raspberry Pi utility node hardware sensors.
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
- Cost records `homelab:node_estimated_cost_sgd_per_hour` every **2 minutes**,
  multiplying estimated watts / 1000 by the tariff applicable at that evaluation.
  Grafana integrates samples with `sum_over_time(...) * 120 / 3600`, so a range
  crossing quarters preserves each sampled tariff rather than repricing history.
- Cost history starts at deployment of this recording rule. It is **not backfilled**;
  missing samples are not extrapolated and retention limits still apply. Very short
  ranges have 2-minute sampling granularity. Energy panels retain their existing
  average-watts calculation, so energy and cost coverage can differ across gaps.
- If the rule evaluation interval changes, change Grafana's `120`-second multiplier too.
- Current verified tariff: `0.3116 SGD/kWh` (`31.16` cents/kWh, GST inclusive),
  effective **1 October–31 December 2026**. SP's matching pre-GST rate is `28.59`
  cents/kWh. The previous Q3 rate remains in the source history.

## Automatic Quarterly Tariffs

- Source of truth: `infrastructure/monitoring/power-tariffs.json`, recording
  GST-inclusive SGD/kWh, inclusive quarter dates, and the official source URL.
- `.github/workflows/power-tariff.yaml` checks the
  [SP Group tariff page](https://www.spgroup.com.sg/our-services/utilities/tariff-information)
  daily at **08:17 Asia/Singapore**, or on manual workflow dispatch. No new cluster
  workload is needed. The two existing nodes add two cost series and one expiry series.
- `scripts/update_power_tariff.py` parses the visible electricity tariff card only,
  excludes embedded script payloads and gas rates, cross-checks 9% GST, calendar
  quarter dates and the quarter heading, and rejects implausible/stale publications.
  A GST change or publication-format change deliberately fails closed for review.
- Future quarters can be committed ahead of time. Generated PromQL switches at
  **Singapore midnight** on the effective date, without an activation-time deployment.
  The most recent known rate remains available after expiry. `SingaporePowerTariffStale`
  warns after one hour; absent tariff/expiry series warn after 15 minutes. Grafana
  shows a dynamic tariff title and a red expired status instead of a hardcoded quarter.
- The workflow publishes **only** the JSON history and generated rule file on
  `automation/power-tariff`, opening a review-required PR. Existing-quarter corrections
  and missing quarters require manual repair rather than silent history rewrites.
- `TARIFF_UPDATE_TOKEN` is a GitHub Actions secret reusing the existing Resource Advisor
  contents/PR-write credential; PAT-created PRs trigger normal CI (unlike GITHUB_TOKEN).
  Git commits use the authenticated account's configured identity, without author overrides.
  Rotate this Actions copy alongside Resource Advisor and Dynacat.
- **Auto-merge is initially disabled.** After approving a real automated tariff PR and
  checking its rollout, set repository variable `POWER_TARIFF_AUTO_MERGE=true` if desired.
  It only requests auto-merge for a new consecutive quarter with a rate change of at
  most 15%. Repository auto-merge must also be enabled and required CI/branch rules
  must be configured; the workflow refuses auto-merge unless `validate` is a required
  master-branch check. This workflow does not change repository protection settings.
  Larger changes remain review-required. Never use an admin bypass to merge them.
- Failed workflow runs open/update a single GitHub issue, in addition to GitHub Actions
  failure notifications. A passing check resolves that issue, not any pending PR.
  GitHub scheduling is best-effort; the cluster-side expiry alert independently catches
  missed runs, approval delays, and failed deployment.

### Checks and Recovery

```bash
python3 -m unittest discover -s scripts/tests -p 'test_power_tariff*.py'
uv run --no-project --with PyYAML==6.0.3 python scripts/test_power_tariff_promql.py # requires promtool
python3 scripts/update_power_tariff.py --check   # offline generated-file check
python3 scripts/update_power_tariff.py           # fetch official page and update locally
```

Review the effective quarter, GST-inclusive rate, and source before merging. If SP
changes the page or GST, update the parser and fixture tests; never guess a rate.
For a corrected known quarter, manually edit the history after official verification
and run `python3 scripts/update_power_tariff.py --render`. Corrections affect future
recorded samples only, not already recorded historical costs. Keep consecutive
quarters in the history. Flux deploys merged rules through the existing monitoring
Kustomization; review the tariff/expiry metrics, alerts, and dashboard after rollout.

## Verification

```bash

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get prometheusrule -n monitoring node-power-estimation -o yaml
kubectl get configmap -n monitoring grafana-dashboard-node-power-estimation -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'homelab:node_estimated_power_watts'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'homelab:node_rpi_low_voltage_alarm'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'homelab:singapore_household_tariff_sgd_per_kwh'
```

Grafana dashboard title: `Node Power Estimation`.
