---
title: Gatus Service Monitoring
summary: Git-managed availability checks, 60s-tier Prometheus alerts, shared PostgreSQL history, private access, and operator integrations.
status: active
owner: homelab
last_reviewed: 2026-11-27
---

# Gatus Service Monitoring

Gatus runs at **https://gatus.khzaw.dev** through the normal private LAN/Tailscale
ingress. `apps/gatus/helmrelease.yaml` owns its deployment and inline monitor
configuration; changes to checks belong in Git. The grouped status page links to
Dynacat, the Control Panel, and Grafana.

## Checks

The 70 checks comprise 61 HTTP, three DNS, and six TCP checks. The inline
configuration is the authoritative endpoint inventory. Coverage spans all current
application backends, the six permanent-public Tunnel hostnames, DNS resolution,
selected data services, and native-host access.

- App checks use private HTTPS health/login/dashboard paths, retaining ingress,
  DNS, and TLS coverage. Internal services without a canonical hostname use their
  cluster-local health endpoints. Public-site checks traverse Cloudflare and
  include the blog apex and Erica Knight WWW redirect as distinct edge routes.
- The **OpenClaw & Hermes** group keeps gateway, cached readiness, dashboard,
  and HTTPS edge checks separate. All seven HTTP checks require JSON `ok: true`
  and HTTP 200; an additional TCP check covers Iris SSH.
- **DNS** queries both AdGuard VIPs independently and the CoreDNS Service. Each
  resolver must return `${INGRESS_VIP}` for `gatus.${BASE_DOMAIN}` with `NOERROR`.
  The AdGuard web checks remain separate from DNS functionality.
- **Data services** checks the shared, Immich, and Vaultwarden PostgreSQL
  listeners and requires an actual `PONG` response from Immich Valkey, whose
  kubelet probes only check TCP. Immich's machine-learning `/ping` check
  requires `pong`.
- **Infrastructure** includes TrueNAS's HTTPS UI and its independent NFS TCP
  listener. **Operations** includes Dynacat, Control Panel, Flux UI, Resource
  Advisor, Prometheus readiness, and Alertmanager readiness.

Check intervals follow blast radius:

| Interval | Checks | Reason |
|---|---|---|
| 60 seconds | **DNS** and **Data services** groups, TrueNAS NFS (8) | Shared dependencies whose failure explains many other red checks; Grafana's DNS panels use these results. The only tier that sends [alerts](#alerts) |
| 2 minutes | **Operations** and **Public sites** groups (12) | Several checks per private-ingress or Cloudflare Tunnel path localize a path-wide failure before app checks catch up; includes Prometheus and Alertmanager readiness |
| 5 minutes | Every other check (50) | Individual app backends, infrastructure web UIs, and native-host checks |

Add new checks to the 5-minute tier unless they cover a shared dependency or an
access path. Each evaluation is a write transaction in the shared PostgreSQL that
also reads that endpoint's retained result history, so a shorter interval costs
database load as well as Gatus CPU. Each 60s endpoint also carries
`extra-labels: {tier: '60s'}`, which selects it for alerting. Moving an endpoint
into or out of the 60s tier must add or remove that label in the same change.

Keep known endpoint semantics when changing targets:

- Anki and Jackett use `/health`. Anki's root `404` is expected; Jackett's web
  login redirects through a cookie test that a stateless client can fail.
- LiveSync uses CouchDB's unauthenticated `/_up` response. Health endpoints with
  a structured status field assert its healthy value instead of accepting any
  HTTP 200 JSON body.
- Transmission VPN UI checks its diagnostics API and response shape. Direct
  mode is valid, so a disabled VPN is not a failed UI check.
- Speedtest uses `/admin/login`, exercising page rendering, sessions, and the
  database. Preserve the existing final login/dashboard paths for other apps.
- Gatus's own health is monitored externally by Dynacat and by the
  `GatusMetricsAbsent` and `GatusResultsStale` alerts. A self-check inside Gatus
  cannot report when Gatus itself is down.

The existing service HTTP checks retain their 48-second timeouts. New HTTP
checks use ten seconds; native HTTP and TCP checks use ten and five seconds
respectively. No ICMP/raw-socket capability, application credentials, or new
workload is needed for these checks.

A PostgreSQL or NFS TCP check proves listener reachability, not successful
queries, authenticated sessions, mounted-file operations, or data integrity.
Gatus depends on the cluster and shared PostgreSQL for its own operation;
independent Iris monitoring and the existing Prometheus alerts remain necessary
for failures that take Gatus's runtime or storage down.

Gatus records each failed evaluation immediately, so a failure appears within
the check's interval plus its timeout. Gatus has no notification provider:
60s-tier failures notify through Prometheus and Alertmanager (see
[Alerts](#alerts)), and the 2m and 5m tiers are dashboard-only. Native-host
Prometheus alerts keep their own thresholds and routes. TLS chain, hostname, and
validity checks are enabled. Certificate renewal monitoring remains owned by
cert-manager and the existing monitoring stack; domain-registration expiry is
not an availability condition.

## Alerts

`infrastructure/monitoring/prometheusrule-gatus.yaml` alerts on the 60s tier.
Gatus v5 exports each endpoint's `extra-labels` on its result metrics, so the
rules select `tier="60s"` rather than group names or keys. Renaming an endpoint
or group needs no rule change; changing an interval does (see above). Gatus
metrics carry neither the interval nor the failing condition.

| Alert | Condition | Notifies after |
|---|---|---|
| `GatusEndpointFailing` | `max_over_time(gatus_results_endpoint_success{tier="60s"}[3m])` is 0 for an endpoint, held `for: 1m` | Four consecutive failed scrapes, about 4m after the first; needs at least three consecutive failed evaluations |
| `GatusResultsStale` | The endpoint's `gatus_results_total` has not increased over 10m, held `for: 5m` | About 15m without a new result while scrapes still succeed |
| `GatusMetricsAbsent` | No `gatus_results_endpoint_success{tier="60s"}` series, held `for: 15m` | Gatus down or failing its scrape, `monitoring/ServiceMonitor/gatus` drift, or the tier label removed |

`GatusEndpointFailing` uses a window rather than the latest gauge with a long
`for`. One successful scrape in the window keeps it quiet, so one to three
failed scrapes never notify, and the first success resolves it. The rule
aggregates by `key`, `group`, `name`, and `type`, dropping the scrape target's
pod and instance labels. Across a Gatus restart, pre-restart samples stay in the
window: a failed first result after the restart cannot notify, and an outage
that spans the restart keeps firing. A failed scrape does not reset the hold.
An endpoint that alternates between success and failure never notifies; the
dashboard shows it.

The deadman alerts cover the two ways the failure alert can go blind. If
evaluations stop, for example with all ten concurrency slots blocked, the
success gauge keeps its last value and only the result counter shows it. If
Gatus is down, its scrape fails, or the label is dropped, the series disappear
and only `absent()` shows it. A normal Recreate rollout finishes well inside 15m.

All three are `severity: warning`. A dedicated `Gatus.*` route in
`infrastructure/monitoring/alertmanagerconfig-homelab.yaml` sends them to
`critical-multi` (Discord and Telegram), grouped by `alertname` and Gatus
`group`, with the shared 30s wait, 5m group interval, and 4h repeat. A DNS outage
produces one `GatusEndpointFailing` notification listing each failing resolver.
The stale and absent alerts have no `group` label, so each arrives as a single
notification. Alerts carry `key`, `group`, `type`, and `gatus_endpoint`. The
last is Gatus's `name`, renamed because the shared Discord title renders `name`
as a Flux object.

### Triage

The alert links `https://gatus.khzaw.dev/endpoints/<key>`, which shows the
failing condition and error. Check the dependency directly from there. For
`GatusResultsStale` or `GatusMetricsAbsent`, check the pod, its recent
evaluations, and the `monitoring/gatus` scrape target:

```sh
kubectl get pods -n default -l app.kubernetes.io/name=gatus
kubectl logs -n default deployment/gatus --since=30m | grep -E 'key=<key>|ERROR' | tail
kubectl rollout restart deployment/gatus -n default  # only if evaluations are stuck
```

### Planned maintenance

Gatus maintenance windows only pause Gatus's own notification providers, and
none are configured. They do not stop the metrics these alerts read. Silence in
Alertmanager instead, scoped to the affected group or endpoint, with an expiry:

```sh
kubectl exec -n monitoring alertmanager-kube-prometheus-stack-alertmanager-0 -c alertmanager -- \
  amtool --alertmanager.url=http://localhost:9093 silence add \
  alertname=GatusEndpointFailing 'group="Data services"' \
  --duration=2h --author=<operator> --comment='<planned work>'
```

Match `key=<key>` to silence one endpoint. Use `silence query` to list and
`silence expire <id>` to end a silence early. Silencing the deadman alerts hides
a broken monitor, so do that only for Gatus's own maintenance.

## Runtime and storage

- One replica on `${UTILITY_NODE_NAME}`, with a Recreate rollout. No HPA:
  additional replicas would duplicate polling and database schema ownership.
- Requests: 25m CPU / 64Mi memory. Limits: 300m CPU / 256Mi memory.
- Non-root UID/GID 65532, read-only root filesystem, RuntimeDefault seccomp,
  dropped capabilities, and no service-account token.
- Read-only ConfigMap at `/config/config.yaml`; config checksum changes roll the pod.
- `/health` startup, readiness, and liveness probes.
- History reuses `media-postgres` in an isolated `gatus` database. No app PVC or
  additional database server is needed. A pre-install/pre-upgrade hook provisions
  the restricted role/database without restarting the shared server. Its role
  has a 16-connection limit; Gatus evaluates at most ten endpoints concurrently.
- The database retains 1,440 detailed results and 100 events per endpoint, plus
  upstream's approximately 32-day aggregate uptime window. Detailed results
  cover about one day for 60-second checks, two days for 2-minute checks, and
  five days for 5-minute checks; uptime and response-time views use the
  aggregates. Write-through caching reduces dashboard reads. History is
  persistent but shares PostgreSQL's failure domain and
  [backup gap](./media-postgres.md#backup-status).

Resource Advisor reports `default/Deployment/gatus`, container `main`, and can
propose changes to its mapped app-template resources after the usual maturity
and safety gates. There is no autoscaler competing for requests. Renovate owns
both the pinned Gatus image and app-template chart versions.

## Operator integrations and credentials

Dynacat has the canonical bookmark, a cluster-local `/health` monitor, the Gatus
release watcher, and an UP/DOWN/PENDING summary. The summary requests only the
latest result per endpoint; it does not label a newly started check healthy
before it has produced a result. Prometheus scrapes `/metrics` through
`monitoring/ServiceMonitor/gatus` for availability, duration, and result history.

The Control Panel discovers Gatus in Updates and Tuning. Gatus is private-only
and has no temporary share; see the
[private-only list](./public-edge-and-exposure-control.md#temporary-shares).

`default/gatus-secret` is SOPS-managed under `infrastructure/secrets/default/`:

- `POSTGRES_PASSWORD`: restricted role password used by the provisioning hook.
- `DATABASE_URL`: matching connection URL used only by Gatus.

Rotate both keys together, reconcile secrets, then reconcile the Gatus
HelmRelease so the hook updates the role and the runtime reloads its environment.
The hook also consumes `media-postgres-secret`; the app never receives the
administrator credential. The private status page has no application login or
additional administrator credential.

cert-manager owns `default/Certificate/gatus-tls` and its `gatus-tls` Secret,
issued by `letsencrypt-prod` for `gatus.khzaw.dev`. This is managed TLS material,
separate from the editable SOPS credential inventory. The Secrets page inventories
Git-managed credentials; inspect generated TLS metadata through cert-manager's
Kubernetes objects instead.

## Verification

```sh
flux get kustomization gatus -n flux-system
kubectl get helmrelease gatus -n default
kubectl rollout status deployment/gatus -n default --timeout=180s
curl -fsS https://gatus.khzaw.dev/health
curl -fsS 'https://gatus.khzaw.dev/api/v1/endpoints/statuses?page=1&pageSize=1' |
  jq '{total:length,failures:[.[] | select(.results[-1].success != true) | {name,results}]}'
```

After changing checks, verify the expected URL set and each changed check's
results across at least two of its intervals. Check the configured Dynacat
summary and Health entry, fresh Control Panel image/chart and Secrets rows, a
fresh advisor report, the disabled share gate, valid canonical DNS/TLS, and
Prometheus's Gatus scrape target.

After changing the 60s tier or the alert rules, run
`scripts/test_gatus_alerts_promql.py` (CI runs it with promtool). Then confirm
that the live selection matches the tier (DNS 3, Data services 4,
Infrastructure 1) and that `GatusEndpointFailing` returns nothing while every
check is healthy:

```sh
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 \
  'count by (group) (gatus_results_endpoint_success{tier="60s"})'
```

Upstream: [Gatus configuration and API](https://github.com/TwiN/gatus#configuration).
