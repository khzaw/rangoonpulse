---
title: CronJob Dead-Man's-Switch Alerts
summary: PrometheusRule alerts that page on silent CronJob failure (staleness, failed runs, deletion, forgotten suspend) and the Alertmanager route that lets the warning-severity family reach Discord/Telegram.
status: active
owner: homelab
last_reviewed: 2026-07-03
---

# CronJob Dead-Man's-Switch Alerts

Silent CronJob failure must page through the existing Alertmanager -> Discord/Telegram
path. This is implemented as one PrometheusRule plus one AlertmanagerConfig route; no new
services and no new secrets.

## GitOps Objects

- PrometheusRule: `infrastructure/monitoring/prometheusrule-cronjob-deadman.yaml` (name `cronjob-deadman`, namespace `monitoring`, label `release: kube-prometheus-stack`)
- AlertmanagerConfig route: `infrastructure/monitoring/alertmanagerconfig-homelab.yaml`
- Wired in: `infrastructure/monitoring/kustomization.yaml`

## Monitored CronJobs

| CronJob | Namespace | Schedule (Asia/Singapore) | Staleness threshold |
|---|---|---|---|
| `resource-advisor-report` | `monitoring` | `30 2 * * *` (daily) | 30h (108000s) |
| `resource-advisor-apply-pr` | `monitoring` | `30 3 * * 1` (weekly Mon) | 8d (691200s) |
| `truenas-management-plane-refresh` | `democratic-csi` | `0 4 * * 1` (weekly Mon) | 8d (691200s) |

All three use `concurrencyPolicy: Forbid`, `ttlSecondsAfterFinished: 21600` (6h), and job
history limits of 2-3.

## Alert Families

The rule group `homelab-cronjob-deadman.rules` (interval `2m`) defines four alert families.
All alerts carry `severity: warning` and both `summary` and `description` annotations.

### HomelabCronJobStale

One rule per CronJob (same `alertname`, per-job threshold). Fires when the time since
`kube_cronjob_status_last_successful_time` exceeds the threshold, with a `for: 15m` buffer.

| CronJob | Threshold | Rationale vs schedule |
|---|---|---|
| `resource-advisor-report` | 30h | Daily schedule; 30h is just over one missed run plus margin. |
| `resource-advisor-apply-pr` | 8d | Weekly schedule; 8d is just over one missed week. |
| `truenas-management-plane-refresh` | 8d | Weekly schedule; 8d is just over one missed week. |

Expression shape (per job):

```
(
  time()
  - max by (namespace, cronjob) (
      kube_cronjob_status_last_successful_time{namespace="<ns>", cronjob="<name>"}
    )
) > <threshold-seconds>
unless on (namespace, cronjob)
  (kube_cronjob_spec_suspend{namespace="<ns>", cronjob="<name>"} == 1)
```

The `unless ... suspend == 1` clause excludes intentionally suspended jobs from staleness
(see SuspendedTooLong below for the backstop).

### HomelabCronJobRunFailed

Single rule. Fires when any tracked Job has `kube_job_status_failed > 0`, `for: 5m`.

```
max by (namespace, job_name) (
  kube_job_status_failed{
    namespace=~"monitoring|democratic-csi",
    job_name=~"(resource-advisor-report|resource-advisor-apply-pr|truenas-management-plane-refresh)-.*"
  }
) > 0
```

The `-.*` job_name suffix matches both scheduled runs (`<cronjob>-<timestamp>`) and manual
runs triggered from controlpanel (`<cronjob>-manual-<suffix>`), so both are covered.

Failed Job objects age out via `ttlSecondsAfterFinished: 21600` (6h) and the CronJob
history limits, so this alert self-resolves once the failed Job is reaped. The Stale alert
is the backstop: if a job keeps failing on schedule, it will eventually cross its staleness
threshold.

### HomelabCronJobMissing

One rule per CronJob. Fires on `absent(kube_cronjob_created{...})`, `for: 1h`. The 1h hold
tolerates kube-state-metrics restarts and short scrape gaps. Guards against silent
deletion or rename of a CronJob object.

### HomelabCronJobSuspendedTooLong

Single rule. Fires when `kube_cronjob_spec_suspend == 1` for any tracked CronJob,
`for: 7d`.

```
kube_cronjob_spec_suspend{
  namespace=~"monitoring|democratic-csi",
  cronjob=~"resource-advisor-report|resource-advisor-apply-pr|truenas-management-plane-refresh"
} == 1
```

This is the backstop for the suspend exclusion in HomelabCronJobStale: a job toggled to
suspended in controlpanel and forgotten will not go stale, but will trip this after 7 days.

## Alertmanager Routing

The existing route tree in `alertmanagerconfig-homelab.yaml` null-routes `severity=warning`
unless `alertname=~TrueNAS.*`. Without an explicit matcher, every alert in this family
(`severity: warning`) would be silently dropped.

A route placed before the final `receiver: "null"` entry sends the family to
`critical-multi` (Discord + Telegram):

```yaml
- receiver: critical-multi
  matchers:
    - name: severity
      matchType: "="
      value: warning
    - name: alertname
      matchType: "=~"
      value: HomelabCronJob.*
```

The `alertname=~HomelabCronJob.*` matcher scopes the override to this family only; other
warning-severity alerts continue to be null-routed as before.

## Controlpanel Interaction

- Manual runs: jobs triggered from `controlpanel.khzaw.dev` (Managed CronJobs view) are
  named `<cronjob>-manual-<suffix>` with label `cronjob-name: <cronjob>`. HomelabCronJobRunFailed
  matches the `-.*` job_name suffix, so manual runs that fail are paged alongside scheduled
  ones. HomelabCronJobStale keys on the CronJob object's `last_successful_time`, so a
  successful manual run also clears pending staleness.
- Suspend: toggling suspend in controlpanel sets `kube_cronjob_spec_suspend=1`, which the
  Stale rule explicitly excludes via `unless`. A suspended job will never page as stale;
  HomelabCronJobSuspendedTooLong is the only signal that catches a forgotten suspend.
- Re-run: a stale or failed job can be re-triggered from the controlpanel Managed CronJobs
  view, or with `kubectl create job --from=cronjob/<name> -n <ns>`.

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get prometheusrule -n monitoring cronjob-deadman -o yaml
kubectl get alertmanagerconfig -n monitoring homelab-alerting -o yaml

# Confirm the rule group and alert names loaded into Prometheus.
# (/api/v1/rules is not a PromQL query; use a short-lived port-forward + curl.)
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 19090:9090 &
curl -s 'http://localhost:19090/api/v1/rules' | \
  grep -o 'HomelabCronJob[A-Za-z]*' | sort -u
kill %1

# Confirm kube-state-metrics is exposing the source series for all three CronJobs.
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'kube_cronjob_status_last_successful_time'

# Seconds since last success per CronJob (should be well under the Stale threshold).
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'time() - max by (namespace, cronjob)(kube_cronjob_status_last_successful_time)'

# Confirm the suspend exclusion series exists (should be 0 for active jobs).
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'kube_cronjob_spec_suspend'
```
