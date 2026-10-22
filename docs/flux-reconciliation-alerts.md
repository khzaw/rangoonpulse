---
title: Flux Reconciliation Alerts
summary: PrometheusRule alerts on Flux objects that are not ready, stuck reconciling, or suspended for too long, sourced from Flux Operator metrics and routed to Discord/Telegram through the existing AlertmanagerConfig.
status: active
owner: homelab
last_reviewed: 2026-10-22
---

# Flux Reconciliation Alerts

A HelmRelease whose upgrade fails and rolls back keeps serving the previous release, so
the app looks healthy while GitOps is silently stuck. Before this existed, `jackett`
sat in `Stalled=True` / `RollbackSucceeded` with no notification. These alerts close
that gap using the Flux Operator's metrics and the Alertmanager path that already
reaches Discord and Telegram. No new controller, no new secret.

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
| `FluxResourceReconcileStuck` | `ready="Unknown"`, not suspended | 30m | Helm upgrade or health check hanging past timeout; controller not progressing |
| `FluxResourceSuspendedTooLong` | `suspended="True"` | 3d | `flux suspend` for debugging and forgotten |
| `FluxOperatorMetricsAbsent` | `absent(flux_resource_info)` | 15m | flux-operator pod down or ServiceMonitor selector drift; the other three alerts are blind |

`for` windows are deliberately longer than a normal reconcile. A HelmRelease with
`timeout: 10m` legitimately sits in `Unknown` during an upgrade, and a transient
`False` between retries should not page.

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

## Jackett Missing-Image Rollback (2026-09-18)

Jackett's desired image `lscr.io/linuxserver/jackett:0.24.2605` reached Git before LinuxServer
published it. All four Helm upgrade attempts on September 17 timed out, ending at
12:42 UTC, and rollback kept `0.24.2595` serving. Helm's final error mentioned a client
rate-limiter deadline; the node's kubelet logs exposed the actual failure:
`lscr.io/linuxserver/jackett:0.24.2605: not found` / `ImagePullBackOff`.
NFS mounts succeeded, and the chart version had not changed.

The upstream application release appeared at 05:55 UTC, but the
[LinuxServer build release](https://github.com/linuxserver/docker-jackett/releases/tag/v0.24.2605-ls31)
did not appear until 13:52 UTC. Publishing the missing image later does not reset
Flux's exhausted remediation attempts; the resource stays stalled until reset or changed.

Recovery was to verify the desired tag and `linux/arm64` manifest exist, then reset
the release's failure counter through Flux:

```bash
crane manifest lscr.io/linuxserver/jackett:0.24.2605
flux reconcile hr jackett -n default --reset --timeout=7m
kubectl rollout status deployment/jackett -n default
```

The image pulled in 22 seconds and Helm revision 80 succeeded with `Ready=True`.
The HTTPS login page returned 200 with valid TLS; both Prometheus and Alertmanager
cleared the alert after the operator scrape and rule evaluation. The alert rule remains enabled.

Prevention: the existing Renovate custom manager now tracks `linuxserver/docker-jackett`
GitHub releases and extracts `0.24.2605` from `v0.24.2605-ls31`. LinuxServer's
[packaging pipeline](https://github.com/linuxserver/docker-jackett/blob/145d952bcbf9ad1139b9276f73a9b692dee45673/Jenkinsfile#L965)
pushes the multi-architecture images and semver aliases before creating the GitHub
release. This avoids both the upstream-publication race and the excessive Docker tag
enumeration that originally required the custom manager. See the
[dependency-update policy](./dependency-updates-renovate-and-flux-image-automation.md).

## CPU Reservation Exhaustion (2026-10-22)

Immich and Grafana upgrades had been failing since October 16. Blog, Subarr,
Bazarr, and blackbox-exporter subsequently hit the same unschedulable-pod pattern.
The primary node reserved 5943m of its 5950m allocatable CPU, despite using about
18% CPU. Scheduler events confirmed `Insufficient cpu`; the utility node was
excluded by workload placement. Helm's deadline/rate-limiter errors were a symptom
of waiting for pods, not evidence that the Kubernetes API needed higher rate limits.

Manual request-only sizing used the retained 14-day CPU history. Jellyfin now
reserves 400m (observed p95 247m), Immich ML/server/Postgres 100m/100m/75m,
media-postgres 125m (p99 94m), Bazarr 50m (p95 23m), Audiobookshelf 25m, and
BookOrbit 50m. This releases 1016m of steady-state reservations. Memory and CPU
limits remain unchanged so interactive work can still burst. Existing Recreate
rollouts release old reservations first; Immich's rolling replacement needs
additional headroom while old and new pods overlap.

Recover exhausted Helm retries with `flux reconcile hr <name> -n <namespace>
--reset` after the request changes reconcile. Verify deployment readiness and
application endpoints, then wait for both Prometheus and Alertmanager to clear.
Healthy old pods alone do not prove the desired release has deployed.

The old receiver grouped every Flux failure together and used only
`CommonAnnotations`. With multiple services, no common summary or description
existed, producing generic `FluxResourceNotReady` messages. Group membership
changes triggered updates on the five-minute group interval, independently of
the four-hour repeat interval. Object grouping and per-alert rendering fix that
loss of context without disabling failure alerts.

Recovery verification: 217 of 219 inspected Flux objects expose a Ready condition;
all 217, including all 58 HelmReleases, returned Ready=True. The two OCI
HelmRepository objects do not expose readiness conditions. Primary-node CPU reservations fell to 4939m
of 5950m (83%), leaving 1011m free with the blog running. Immich deployed v3.3.3,
Bazarr deployed v1.6.2-ls369, and monitoring deployed chart 92.11.0. The seven
checked application/health endpoints returned HTTPS 200. Alertmanager loaded the
per-object route and templates; Discord and Telegram recorded notification
deliveries with zero failures during recovery. Template rendering also verified
mixed firing/resolved alerts and escaped Telegram annotation text.
Both Prometheus and Alertmanager subsequently reported zero active Flux alerts.
Resource Advisor now enforces a [per-node rollout/job CPU reserve](./resource-advisor-phase1-phase2.md#node-constraint-awareness)
for request increases, including independent-PR ordering and stale-report guards.

## Verification Performed

- `kubectl kustomize infrastructure/monitoring` builds.
- `kubectl apply --dry-run=client` passes for all three objects.
- All four expressions were evaluated against the live Prometheus query API and parsed.
- The live Alertmanager route tree was inspected to confirm warning alerts need an explicit `alertname` route (they fall to `null` otherwise), matching the existing `TrueNAS.*` and `HomelabCronJob.*` routes.

## Related

- [`docs/cronjob-deadman-alerts.md`](./cronjob-deadman-alerts.md) for the CronJob alert family that uses the same routing pattern.
- [`docs/dns-reliability-flux-gitrepository-timeouts.md`](./dns-reliability-flux-gitrepository-timeouts.md) for the earlier source-controller DNS alerts (`FluxSourceGitRepositoryReconcileErrors`), which remain and are complementary: they catch transient fetch errors, this doc catches sustained not-ready state.
- [`docs/flux-web-ui.md`](./flux-web-ui.md) for the operator UI.
