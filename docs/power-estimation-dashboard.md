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

## Durable Monthly Cluster Totals

Monthly history is **one row per month for the whole cluster**, not per-node or daily
rows. It lives in `postgres.power_estimation.monthly_cost` on the **existing**
`media-postgres` server. No new database, server, exporter, or NAS copy is created.
The local-path PostgreSQL PVC survives pod and Talos reboots. Loss of its disk is
**not** covered by a separate backup, per the operator's explicit choice.

`default/power-cost-ledger` runs at **00:15 Singapore on Mondays and the first day
of each month** (`15 0 1 * 1`, standard cron day-of-month/day-of-week OR semantics).
A manual bootstrap run seeds the first partial month. The extra month-start run
finalizes the previous month without waiting for Monday. Grafana and Pulse show
recorded totals, not a continuously updating month-to-date projection.

The job reuses the already-cached TimescaleDB image's shell, BusyBox `wget`, and
`psql`: no dependency installs or additional steady-state service. Requests are
**10m CPU / 16Mi**, limits **100m CPU / 48Mi**, deadline five minutes, concurrency
Forbid, finished-job TTL six hours. No HPA applies to a bounded run-to-completion
job. This extends existing monitoring/DB services, so a new application hostname,
Dynacat bookmark, exposure/share route, and independent service monitor are N/A.
The existing Grafana and Pulse links remain the entry points. The raw CronJob is
intentional so the Control Panel's managed-job schedule/suspend editor supports it;
its Jobs view includes the collector. Renovate tracks the pinned image. Advisor
workload tuning targets persistent controllers, not this ephemeral collector;
its small explicit resources remain operator-owned.

### Exactly-once accumulation and coverage

- Fetch up to 13 days of **raw** `homelab:node_estimated_cost_sgd_per_hour` samples,
  not `query_range` resamples which can repeat a stale value. Two-minute sample
  values integrate as `SGD/hour * 120 / 3600`, matching Grafana's cost calculation.
- A five-minute settlement delay avoids advancing past unsettled evaluations.
- One transaction takes an advisory lock, splits samples by Singapore month,
  adds only timestamps at/after the previous checkpoint and before the new cutoff,
  and commits totals, sample counts, and checkpoint together. Repeated or concurrent
  runs cannot double-count. Earlier finalized rows are never repriced.
- The first month is partial; its unrecorded prefix is included in missing coverage.
  Counts track the expected two nodes without retaining per-node ledger records.
  Update `POWER_LEDGER_NODES` and `POWER_LEDGER_EXPECTED_NODES` if cluster membership
  changes. Changing the recording interval also requires updating this collector.
- Missing measurements, NaN observations, and outages beyond available retention
  remain missing, not fabricated zero consumption. Checkpoints can progress past a
  lost interval while retaining its partial-coverage status. API errors/warnings,
  malformed data, duplicate points, and constraint failures roll back without
  advancing. Prometheus retains **at most** 14 days/8GB; the size cap can shorten it.
  The weekly dead-man alert fires after eight days, leaving recovery time.

### Consumers and credentials

Grafana uses its built-in PostgreSQL datasource `power-cost-ledger`, a read-only
role and a one-connection pool. The existing Node Power Estimation dashboard adds
current-month recorded cost, monthly bars, and a totals/coverage table. These panels
ignore the short dashboard time picker and read the durable ledger.

After committing, the job exports a tiny JSON snapshot and POSTs it to the existing
Control Panel using a dedicated shared token. The backend validates/authenticates
it and stores **only token-free data** in runtime ConfigMap
`default/power-cost-ledger-snapshot`. This cache is not Flux desired state and is
reconstructible from PostgreSQL. Pulse's `GET /api/power-cost-ledger` reads that
snapshot (five-minute backend cache); **it never polls PostgreSQL**. A failed push
fails the job; retrying leaves totals unchanged and republishes the snapshot.

`default/power-ledger-db` holds `writer-password`, `reader-password`, and
`snapshot-token`. Only the post-install/post-upgrade DB hook consumes the existing
superuser credential; the normal collector has SELECT/INSERT/UPDATE on the one
ledger table, and Grafana has SELECT only. `monitoring/power-ledger-db` holds the
reader copy as `POWER_LEDGER_PASSWORD`. All are SOPS-managed. Rotate the reader in
both namespace copies, reconcile secrets, run the media-postgres provisioning hook
through a Helm reconcile/upgrade, and restart Grafana. Rotate the snapshot token
with a Control Panel restart and the next fresh job. Do not reset the ledger when
rotating credentials. Shared DB Deployment rendering is unchanged by the hook.

### Verification and recovery

```bash
python3 scripts/test_power_ledger_sql.py --psql-command 'kubectl exec -i -n default deploy/media-postgres -- psql -X -U postgres -d postgres'
kubectl create job -n default --from=cronjob/power-cost-ledger power-cost-ledger-manual-$(date +%s)
curl -fsS https://controlpanel.khzaw.dev/api/power-cost-ledger
```

The SQL regression test uses an isolated schema and rolls everything back. It
checks month splitting, retries, cutoff boundaries, coverage gaps, finalization,
and rejection of malformed/partial source responses. CI runs it in a disposable
PostgreSQL container, never against application data.

If collection is overdue, run it before Prometheus samples expire. If only the
Pulse cache is missing, rerunning republishes the entire ledger even when the
checkpoint has not advanced. Never reset the checkpoint alone or manually add
previously collected samples: that would double-count. Restarts require no data
repair; disk loss requires accepting loss of monthly history under the no-backup
policy. The table and its roles are reprovisioned idempotently by the DB hook,
but reprovisioning cannot recover lost historical values.

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
