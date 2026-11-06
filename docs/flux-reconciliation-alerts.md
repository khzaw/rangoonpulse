---
title: Flux Reconciliation Alerts
summary: PrometheusRule alerts on Flux objects that are not ready, stuck reconciling, or suspended for too long, sourced from Flux Operator metrics and routed to Discord/Telegram through the existing AlertmanagerConfig.
status: active
owner: homelab
last_reviewed: 2026-11-06
---

# Flux Reconciliation Alerts

A failed Helm upgrade can roll back and keep the old app healthy while desired state remains stalled. These alerts track sustained Flux object state through Flux Operator metrics and the existing Discord/Telegram Alertmanager route.

## Why Not `Provider`/`Alert` From notification-controller

Flux's notification-controller can post events to Alertmanager directly, but it is
event-shaped: it fires on each reconcile failure and relies on Alertmanager's resolve
timeout to clear. The metric approach gives a stateful "has been broken for N minutes"
signal, self-resolves when the object becomes Ready, and gets a dead-man's-switch for
free (`FluxOperatorMetricsAbsent`). It also avoids a second copy of the Discord webhook
secret in `flux-system`.

## GitOps Objects

- ServiceMonitor: `infrastructure/monitoring/servicemonitor-flux-operator.yaml` (scrapes `flux-system/flux-operator` port `http` → container `http-metrics` 8080, every 60s)
- PrometheusRule: `infrastructure/monitoring/prometheusrule-flux-reconciliation.yaml` (name `flux-reconciliation`, namespace `monitoring`, label `release: kube-prometheus-stack`)
- AlertmanagerConfig route: `infrastructure/monitoring/alertmanagerconfig-homelab.yaml` (`severity=warning` + `alertname=~"Flux.*"` → `critical-multi`)
- Wired in: `infrastructure/monitoring/kustomization.yaml`

The `flux-system/allow-scraping` NetworkPolicy already permits ingress to 8080 from any
namespace, so no policy change was needed.

## Source Metric

`flux_resource_info` is a gauge exported by the Flux Operator (`ghcr.io/controlplaneio-fluxcd/flux-operator`)
with one series per Flux object:

```
flux_resource_info{
  kind="HelmRelease", exported_namespace="default", name="jackett",
  ready="False", suspended="False", reason="RollbackSucceeded",
  revision="5.1.0", source_name="bjw-s-charts", ...
} 1
```

Kinds covered: `GitRepository`, `HelmRepository`, `HelmChart`, `HelmRelease`,
`Kustomization`, `ImageRepository`, `ImagePolicy`, `ImageUpdateAutomation`.

Label note: `exported_namespace` is the Flux object's namespace. The plain `namespace`
label on the source metric is the scrape target (`flux-system`); the alert expressions
drop it. The Flux warning route groups by `alertname`, `exported_namespace`, `kind`,
and `name`, so each object has its own notification and recovery state. Discord titles
include the namespace/name. Both receivers render each alert's own summary,
description, and status, including resolved members of a still-firing group.
Telegram uses HTML mode with escaped annotation text.

## Alert Families

Rule group `homelab-flux-reconciliation.rules`, interval `2m`, all `severity: warning`.

| Alert | Condition | `for` | Typical cause |
|---|---|---|---|
| `FluxResourceNotReady` | `ready="False"`, not suspended | 15m | Helm upgrade failed and rolled back; Kustomization build/apply error; source fetch failure |
| `FluxChartVersionUnavailable` | Existing HelmChart `InvalidChartReference` from a healthy HTTP source | 26h | Requested chart is still unavailable after the daily index refresh window |
| `FluxResourceReconcileStuck` | `ready="Unknown"`, not suspended | 30m | Helm upgrade or health check hanging past timeout; controller not progressing |
| `FluxResourceSuspendedTooLong` | `suspended="True"` | 3d | `flux suspend` for debugging and forgotten |
| `FluxOperatorMetricsAbsent` | `absent(flux_resource_info)` | 15m | flux-operator pod down or ServiceMonitor selector drift; the other Flux resource alerts are blind |

`for` windows are deliberately longer than a normal reconcile. A HelmRelease with
`timeout: 10m` legitimately sits in `Unknown` during an upgrade, and a transient
`False` between retries should not page.

### Daily Chart Index Refreshes

HTTP HelmRepository indexes retain their 24h polling interval to limit fetch and
processing work. A chart version update can reach Git before that cached index
contains the version. Flux retries automatically and resumes the upgrade after
the repository refreshes; this does not require an operator reconcile.

An existing HelmChart with `InvalidChartReference` from a healthy, active HTTP
HelmRepository gets a 26h grace period, covering one daily index refresh plus
margin. The recording rule `homelab:flux_chart_index_wait:info` identifies this
state from the existing Flux metrics. It then produces one
`FluxChartVersionUnavailable` notification if the reference remains invalid.
The generic 15m rule excludes that chart and its matching generated HelmRelease
while the release reports `SourceNotReady`. Matching uses the generated chart
name `<release namespace>-<release name>` in `flux-system`, where this repository
keeps its chart sources. A different release using the same repository is not
suppressed. Custom chart references that do not match this convention keep the
normal release alert.

Both the chart and release must have previous revisions to defer the release
alert. First installations without a previous release, failed upgrades/rollbacks,
source download failures, OCI references, and failures without matching chart or
repository telemetry retain the normal 15m threshold. This grace period deliberately delays notification for
a genuinely invalid chart reference too; it does not prove that the previous
workload is healthy. Workload and endpoint alerts continue independently.

`FluxSourceGitRepositoryReconcileErrors` uses a 5m error-counter lookback with a
10m pending period. A recovered isolated error ages out before it can notify;
continuing failures still alert. Inspect logs to distinguish DNS/network failures
from SSH authentication or repository-access failures.

## Triage

```bash
flux get hr -A --status-selector ready=false
flux get kustomizations -A --status-selector ready=false
flux get sources all -A --status-selector ready=false
flux get hr <name> -n <ns>                  # shows the stalled message
kubectl describe hr <name> -n <ns>          # full conditions
flux reconcile hr <name> -n <ns> --force    # retry after fixing the cause
```

The Flux Operator web UI at `fluxui.khzaw.dev` shows the same state graphically.

If `FluxOperatorMetricsAbsent` fires, check the pod and the scrape target:

```bash
kubectl get pods -n flux-system -l app.kubernetes.io/name=flux-operator
kubectl get --raw /api/v1/namespaces/flux-system/services/flux-operator:8080/proxy/metrics | grep -c '^flux_resource_info'
```

and confirm `monitoring/flux-operator` appears as `up` under Prometheus → Status → Targets.

## Missing Images And Exhausted Retries

Check kubelet events and the exact desired image when Helm reports a deadline or rate-limiter timeout. An upstream application release does not prove that its container image exists. Jackett's Renovate hint tracks LinuxServer packaging releases, which follow multiarch image publication; see [dependency update policy](./dependency-updates-renovate-and-flux-image-automation.md).

After fixing the cause and verifying the tag and required architecture, reset exhausted remediation:

```bash
crane manifest lscr.io/linuxserver/jackett:<desired-tag>
flux reconcile hr jackett -n default --reset --timeout=7m
kubectl rollout status deployment/jackett -n default
```

Publishing a missing image later does not itself reset exhausted Helm retries. Verify the desired image, current Helm readiness, HTTPS behavior, and alert recovery.

## CPU Reservation And Rollout Failures

Check scheduler `Insufficient cpu` events and reservations before tuning API rate limits. Low measured CPU usage does not imply free scheduler capacity. Placement can prevent spare utility-node capacity from helping the primary node.

Use current retained history for sizing, preserve interactive limits, and include replacement overlap in the capacity preflight. Reset exhausted Helm retries only after the underlying sizing or scheduling change reconciles. [Resource Advisor headroom](./resource-advisor.md#node-capacity-and-headroom) and [Git/CI validation](./cpu-headroom-validation.md) reserve per-node rollout/job space; independent PRs cannot spend unmerged downsizes.

## Verification

Render monitoring, evaluate the loaded expressions, inspect scrape targets and per-object Alertmanager routing, and check that recovered objects clear in both Prometheus and Alertmanager. A healthy old pod is not proof that the desired release deployed.

`scripts/test_flux_alerts_promql.py` runs the actual rules through promtool with
daily-refresh, dependency-matching, first-install, rollback, missing-telemetry,
and transient/persistent Git-error fixtures. CI runs it alongside the other
monitoring PromQL tests.

See [CronJob alerts](./cronjob-deadman-alerts.md), [DNS reliability](./dns-reliability.md), and [Flux UI](./flux-web-ui.md) for the other failure boundaries.
