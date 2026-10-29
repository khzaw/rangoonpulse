---
title: Node Power Estimation Dashboard
summary: Current operating guidance for Node Power Estimation Dashboard.
status: active
owner: homelab
last_reviewed: 2026-10-29
---

# Node Power Estimation Dashboard

Grafana estimates electricity usage for the two Kubernetes nodes and Iris, the external
M4 Mac mini running native OpenClaw and Hermes. Kubernetes watts use CPU models;
Iris uses software-reported system power from `macmon` through its existing Darwin
node exporter. Iris remains outside Kubernetes. The utility node also exposes a real
Raspberry Pi low-voltage signal.

## Why Estimate-Only

- There is no smart-plug/UPS wall-power telemetry source in this setup.
- Node exporter is enabled so Grafana can surface the Raspberry Pi utility node's
  low-voltage alarm before workloads fail.
- Kubernetes wattage models reuse existing kubelet metrics. Iris has an independent,
  unprivileged native `macmon` sampler, reusing the existing node-exporter textfile
  collector and scrape target without another listener or Kubernetes workload.
- Energy and cost panels are still estimates because the underlying watt values are estimated.

## GitOps Objects

- Rules: `infrastructure/monitoring/prometheusrule-power-estimation.yaml`
- Dashboard: `infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml`
- Included by: `infrastructure/monitoring/kustomization.yaml`

## Model

Kubernetes-node estimate:

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
- `idle_watts` and `max_watts` are fixed constants per host.

Current defaults:

- `talos-7nf-osf`: idle `20W`, max `75W`
- `talos-uua-g6r`: idle `4W`, max `12W`

### Iris software-reported system power

`dev.khzaw.iris.power` samples `macmon pipe --interval 10000` and atomically
writes `iris_system_power_watts` and `iris_power_sample_timestamp_seconds` to
`iris-power.prom` in the existing textfile directory. The timestamp advances only
on a valid, finite positive `sys_power` sample. No idle allowance is added.

The recording rules normalize this to `node="iris"`, with no scrape labels, and
require a successful current exporter scrape plus a non-future sample at most
90 seconds old. Missing, stale or invalid samples contribute no Iris watts or
cost, not zero, idle power, or a CPU-model fallback. `IrisPowerSampleUnavailable`
warns when the exporter is healthy but power samples remain unavailable.

This is software-reported system power, not calibrated AC wall consumption or
per-agent/cloud inference cost. The sensor replaces only Iris's input from the
recording-rule rollout onward. Mixed historical ranges can include the previous
4 W / 65 W CPU interpolation before that boundary; no samples or saved costs are
backfilled or repriced. See [native supervision](./iris-operations.md#native-installation-and-supervision)
for installation, fail-closed restart behavior and login-session recovery.

The canonical metric names and two-minute cadence remain unchanged.
`homelab:cluster_estimated_power_watts` and the Control Room cluster panel remain
Kubernetes-only. `homelab:estimated_power_watts` includes all modeled hosts.
Grafana's host selector and per-host series include Iris; selecting All includes it.
Pulse keeps the node cards/top-strip cluster reading Kubernetes-only and uses the
combined homelab series in its power/cost section. These totals cover only the
explicitly modeled hosts, not TrueNAS, networking, or the whole household.

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

Also add explicit constants for every new monitored host, or it will not appear in
estimated power results. External hosts need their own metric source; do not invent
`kube_node_info` or add them to scheduler/capacity inventory.

## Energy And Cost Panels

- Energy stats use the active Grafana time range, not a fixed `24h` window.
- The dashboard integrates recorded watts as `sum_over_time(...) * 120 / 3600000`
  to obtain `kWh`. Missing samples and pre-enrollment time are not extrapolated.
- Cost records `homelab:node_estimated_cost_sgd_per_hour` every **2 minutes**,
  multiplying estimated watts / 1000 by the tariff applicable at that evaluation.
  Grafana integrates samples with `sum_over_time(...) * 120 / 3600`, so a range
  crossing quarters preserves each sampled tariff rather than repricing history.
- Cost history starts at deployment of this recording rule. It is **not backfilled**;
  missing samples are not extrapolated and retention limits still apply. Very short
  ranges have 2-minute sampling granularity. Energy uses the same recorded-sample
  integration, so neither energy nor cost fabricates usage across missing periods.
- If the rule evaluation interval changes, change Grafana's `120`-second multipliers
  for both energy and cost, plus the ledger collector.
- Iris enrollment is **28 October 2026 at 16:30 SGT**, shared as
  `IRIS_POWER_COST_START_SECONDS` in `flux/cluster-settings.yaml`. Its power/cost rules
  are gated at that time. The ledger includes Iris samples and expects its coverage
  only from enrollment, never retroactively. Preserve this timestamp after rollout.
- Current verified tariff: `0.3116 SGD/kWh` (`31.16` cents/kWh, GST inclusive),
  effective **1 October–31 December 2026**. SP's matching pre-GST rate is `28.59`
  cents/kWh. The previous Q3 rate remains in the source history.

## Automatic Quarterly Tariffs

- Source of truth: `infrastructure/monitoring/power-tariffs.json`, recording
  GST-inclusive SGD/kWh, inclusive quarter dates, and the official source URL.
- `.github/workflows/power-tariff.yaml` checks the
  [SP Group tariff page](https://www.spgroup.com.sg/our-services/utilities/tariff-information)
  daily at **08:17 Asia/Singapore**, or on manual workflow dispatch. No new cluster
  workload is needed. Each modeled host adds one cost series; tariff expiry is shared.
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
uv run --no-project --with PyYAML==6.0.3 python scripts/test_power_estimation_promql.py
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

## Durable Monthly Homelab Totals

Monthly history is **one row per month for all modeled homelab hosts**, not per-host
or daily rows. Earlier saved totals remain cluster-only; Iris contributes only from
its enrollment, without rewriting old costs, checkpoints, or coverage. It lives in
`postgres.power_estimation.monthly_cost` on the **existing**
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
  `POWER_LEDGER_NODES` selects the two Kubernetes nodes plus Iris.
  `POWER_LEDGER_EXPECTED_NODES=2` retains the existing-node baseline; the SQL adds
  one expected series only for the interval at/after `POWER_LEDGER_IRIS_START_SECONDS`,
  sourced from the shared enrollment timestamp. No per-host ledger records are kept.
  Another membership change needs an explicit effective-time policy, not just a count
  bump that would mark earlier intervals missing. Changing the recording interval
  also requires updating this collector.
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

SQL delivered inside Flux-substituted ConfigMaps must use named PL/pgSQL dollar
quotes such as `$ledger$`: anonymous `$$` delimiters collapse to `$` during Flux
substitution and cause `DO $` syntax errors. The initial manual run exposed this;
its transaction rolled back without advancing the checkpoint. Validate the
**Flux-rendered** script as well as the raw SQL.

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
