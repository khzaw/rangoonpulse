---
title: Gatus Service Monitoring
summary: Git-managed availability checks, shared PostgreSQL history, private access, and operator integrations.
status: active
owner: homelab
last_reviewed: 2026-11-10
---

# Gatus Service Monitoring

Gatus runs at **https://gatus.khzaw.dev** through the normal private LAN/Tailscale
ingress. `apps/gatus/helmrelease.yaml` owns its deployment and inline monitor
configuration; changes to checks belong in Git. The grouped status page links to
Dynacat, the Control Panel, and Grafana.

## Checks

The 26 checks poll every 60 seconds. They retain the service HTTPS paths,
accepted status ranges, TLS verification, redirect following, and 48-second
service / 10-second native-service timeouts. These are HTTP availability checks,
not ICMP probes, so no raw-socket capability is needed.

- Downloads: SABnzbd and Transmission.
- Infrastructure: both independent AdGuard instances, Grafana, router, and Speedtest Tracker.
- Media and library: Audiobookshelf, BookOrbit, Immich, Jellyfin, Seerr, and Tracerr.
- Media automation: Bazarr, Prowlarr, Radarr, and Sonarr.
- OpenClaw & Hermes: Iris gateway, API readiness, and HTTPS edge; Hermes gateway,
  readiness, dashboard, and HTTPS edge.
- Personal apps: Actual Budget and Vaultwarden.

Login/dashboard paths intentionally test the actual application page. In
particular, Speedtest uses `/admin/login`, which also exercises its session and
database path. Do not replace these with shallow health endpoints without
considering the lost coverage. Native gateway, readiness, dashboard, and edge
checks test distinct boundaries and must remain separate. The three JSON checks
require `ok: true` as well as HTTP 200.

Gatus records each failed evaluation immediately. No Gatus notification provider
is configured; existing Prometheus/Alertmanager native-host alerts retain their
own persistence thresholds and receiver configuration. TLS chain, hostname, and
validity checks are enabled. Certificate renewal monitoring remains owned by
cert-manager and the existing monitoring stack; domain-registration expiry is
not an availability condition.

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
  upstream's approximately 32-day aggregate uptime window. At a one-minute
  interval, detailed results cover about one day. Write-through caching reduces
  dashboard reads. History is persistent but shares PostgreSQL's failure domain
  and [backup gap](./media-postgres.md#backup-status).

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

The Control Panel discovers Gatus in Updates and Tuning. Exposure Control uses
the `gatus` catalog ID and `share-gatus.khzaw.dev` route. That share starts
disabled; its DNS alias and Tunnel route do not make the canonical hostname
public. Share enable/expiry/authentication remains owned by Exposure Control.

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

After changing checks, verify the expected URL set and several one-minute
evaluations. Check the configured Dynacat summary and Health entry, fresh
Control Panel image/chart and Secrets rows, a fresh advisor report, the disabled
share gate, valid canonical DNS/TLS, and Prometheus's Gatus scrape target.

Upstream: [Gatus configuration and API](https://github.com/TwiN/gatus#configuration).
