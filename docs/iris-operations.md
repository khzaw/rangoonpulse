---
title: Iris native macOS operations
summary: Native launchd supervision, Darwin host telemetry, gateway checks, and an independent cluster sentinel.
status: active
owner: khz
last_reviewed: 2026-10-25
---

# Iris native macOS operations

Iris is the existing Apple Silicon Mac mini at `10.0.0.66`, login user `iris`.
OpenClaw and Hermes remain **native macOS processes**, not Kubernetes workloads.
The [dedicated SSH/HTTPS VIP](./mac-mini-edge.md) remains unchanged.

## Operating surfaces

- Grafana: <https://grafana.khzaw.dev/d/iris-overview> (Darwin-specific metrics, OpenClaw readiness,
  Hermes gateway/dashboard APIs, component readiness, active agents and platform connections).
  Header buttons link to Iris Gateway, [Hermes / Athena](https://athena.khzaw.dev), and Uptime Kuma.
- Dynacat: Home → Ops → Iris / Hermes (Athena) / Iris Overview; Health → Iris Gateway /
  Iris API Readiness / Hermes Gateway / Hermes Dashboard / Hermes Readiness.
- Uptime Kuma desired monitors, on the existing published `rangoonpulse` page:

  | ID | Name | Type / URL | Success |
  | --- | --- | --- | --- |
  | 22 | Iris Gateway | HTTP keyword `http://10.0.0.66:18789/healthz` | HTTP 200 and `"ok":true` |
  | 23 | Iris API Readiness | HTTP `http://10.0.0.66:9101/healthz/openclaw` | HTTP 200 |
  | 24 | Iris HTTPS Edge | HTTP `https://iris.khzaw.dev/healthz` | HTTP 200 |

  Hermes monitors on that same page:

  | ID | Name | URL | Success |
  | --- | --- | --- | --- |
  | 26 | Hermes Gateway | `http://10.0.0.66:9101/healthz/hermes-gateway` | HTTP 200 and `"ok":true` |
  | 28 | Hermes Dashboard | `http://10.0.0.66:9119/api/health` | HTTP 200 |
  | 27 | Hermes Readiness | `http://10.0.0.66:9101/healthz/hermes` | HTTP 200 and `"ok":true` |
  | 29 | Hermes HTTPS Edge | `https://athena.khzaw.dev/api/health` | HTTP 200 |

  All use 60-second intervals, 10-second timeout, 2 retries, 60-second retry interval.
  Kuma monitors/status-page membership are runtime-owned; configure through the authenticated UI,
  not live SQLite edits. Existing Kuma has no notification destinations; notifications here are
  owned by Alertmanager and the native sentinel, not a second Kuma notification configuration.
- Prometheus blackbox additionally probes the direct SSH listener on `10.0.0.66:22`.
  Hermes blackbox targets cover all four Hermes paths above, requiring HTTP 200 and JSON `ok: true`.
- `Iris.*` critical and warning alerts reuse the existing Telegram/Discord Alertmanager route.
  Host metrics unavailable: 3m; agent process/readiness down: 3m; APFS Data free space:
  below 10% for 10m / below 5% for 5m; native telemetry stale/missing: 3m after a 180s stale threshold.
  Host unavailable means exporter/network/power loss, not a definitive diagnosis of which one.
  `IrisHermesUnhealthy` alerts after 3m of failed Hermes gateway/dashboard/status/component readiness
  or any Hermes blackbox target failure, through the same existing critical notification route.

OpenClaw `/readyz` rejects unattributed remote requests with HTTP 403. **Do not relax
`gateway.trustedProxies` to make monitoring work.** The native watchdog checks readiness over
loopback and exposes only a cached `{ "ok": true/false }` on LAN port 9101. Missing/stale samples
(90s) return HTTP 503. `/healthz` checks liveness, not agent/provider end-to-end success.
Hermes is checked through real application endpoints as well as launchd:

- Gateway `http://127.0.0.1:8642/health`: requires `status: "ok"` and `platform: "hermes-agent"`.
  The loopback-only listener stays private; `/healthz/hermes-gateway` relays only its cached boolean.
- Dashboard `http://127.0.0.1:9119/api/health`: requires `ok: true`. The public health API also
  works through `https://athena.khzaw.dev/api/health`; dashboard login remains enforced elsewhere.
- Dashboard `/api/status`: exports only allowlisted numeric/boolean metrics for gateway, dashboard,
  storage and platform component health, active agent count and connected/configured platform counts.
  `/healthz/hermes` requires both HTTP APIs, a running gateway, no stale heartbeat, `overall: "ok"`
  and all four components healthy. Missing/malformed responses fail closed; cached readiness expires
  after 90s. Raw status payloads, platform error strings and profile metadata are not re-exported.

These checks do not send inference requests or prove provider end-to-end success. Hermes's
dashboard port 9119 `/metrics` is a login HTML page, **not** a Prometheus exporter.
Hermes's gateway is in `user/501`, while other jobs use `gui/501`: inspect the caller's
`launchctl list`, not GUI-only service paths. The metric label is `launchd_service` to avoid
Prometheus's discovery-owned `service` label (which otherwise renames the metric label to `exported_service`).

## Native installation and supervision

Versioned implementation: [`native/iris/`](../native/iris/). Homebrew supplies `node_exporter`
and the existing Node installation; no npm packages or containers are needed.

| launchd label | Function |
| --- | --- |
| `ai.openclaw.gateway` | Existing OpenClaw gateway; unchanged |
| `ai.hermes.gateway` | Existing Hermes gateway; unchanged |
| `dev.khzaw.hermes.dashboard` | Existing Hermes dashboard; unchanged |
| `dev.khzaw.iris.node-exporter` | Darwin exporter, LAN `10.0.0.66:9100`, textfile collector |
| `dev.khzaw.iris.watchdog` | OpenClaw/Hermes API readiness relays, launchd/component metrics, independent cluster checks/notifications |

Both managed jobs have `RunAtLoad`, `KeepAlive`, and a 10-second restart throttle. They are login
**LaunchAgents**, consistent with the existing agents. They survive crashes but require the `iris`
GUI login session after reboot. These jobs do not provide pre-login LaunchDaemon supervision. An administrator must explicitly migrate/test startup if
unattended pre-login service is required. Existing AC sleep is disabled and autorestart enabled;
FileVault/login behavior is still an operator dependency.

Metrics are private LAN listeners only: no new Ingress, DNS records, share route, or public exposure.
Do not run `brew services start node_exporter` alongside the managed job (port/ownership conflict).

From this repo after monitoring GitOps has reconciled:

```sh
ssh iris@iris.khzaw.dev 'HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew install node_exporter'
node --test native/iris/watchdog.test.mjs
KUBECONFIG="$PWD/kubeconfig" node native/iris/deploy.mjs
ssh iris@iris.khzaw.dev '/opt/homebrew/bin/node ~/.local/share/rangoonpulse/iris/smoke.mjs'
```

The deployer reads live cluster settings and existing receiver credentials, copies source/config
over SSH, validates plists, and replaces **only the two managed jobs**. No credentials appear in argv,
Git, or console output. Existing OpenClaw/Hermes configs and processes are never rewritten.

Paths on Iris:

- `~/.local/share/rangoonpulse/iris/`: installed versioned source.
- `~/.config/rangoonpulse/iris/{config,notifications,kubernetes}.json`: private config, mode 0600.
- `~/.local/state/rangoonpulse/iris/alerts.json`: persisted debounce/delivery state, mode 0600.
- `~/.local/state/rangoonpulse/iris/textfile/iris.prom`: atomically replaced native metrics.
- `~/Library/LaunchAgents/dev.khzaw.iris.*.plist`: telemetry supervision definitions.
- `~/Library/Logs/rangoonpulse/`: telemetry job stdout/stderr. Successful cycles are quiet;
  inspect/rotate logs during prolonged notification failures (no system log-rotation rule installed).

```sh
ssh iris@iris.khzaw.dev 'launchctl print gui/501/dev.khzaw.iris.watchdog'
ssh iris@iris.khzaw.dev 'launchctl print gui/501/dev.khzaw.iris.node-exporter'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/openclaw'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/hermes'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/hermes-gateway'
```

## Outside-cluster sentinel and credentials

Every completed probe cycle is followed by a 30-second pause (no overlapping probes). Checks:

1. Real authenticated, CA-validated Kubernetes `https://10.0.0.197:6443/readyz`, requiring HTTP 200
   and body `ok`. An unauthenticated HTTP 401 is **not** cluster readiness.
2. HTTPS Grafana `/api/health` through shared ingress `10.0.0.231`, preserving the
   `grafana.khzaw.dev` TLS identity/SNI and requiring JSON `database: ok`.

Three consecutive failures fire; two successes recover; reminders every four hours. Delivery
is tracked separately for Telegram/Discord, retried after failures, and persisted across restarts.
Requests have an eight-second total deadline. Notifications go straight to the existing providers,
not through Kubernetes, Alertmanager, ingress, NAS, or cluster DNS. The native resolver explicitly
uses `1.1.1.1` / `8.8.8.8`, overriding Iris's normal Tailscale/router DNS for notification requests.

Credential ownership:

- Telegram bot token / Discord webhook: encrypted source remains
  `infrastructure/secrets/monitoring/alertmanager-receivers.yaml`; native files are an SSH-installed
  mode-0600 copy. **Rerun `deploy.mjs` after receiver rotation.** No new provider credential is minted.
- `monitoring/iris-watchdog-api-token`: Kubernetes service-account-token controller owns its `data`;
  Git owns only the Secret metadata, ServiceAccount, ClusterRole and binding. This external identity
  is intentionally non-expiring, permits only GET `/readyz` and `/livez` (plus Kubernetes's standard
  authenticated discovery defaults), and cannot read nodes, workloads, or Secrets. The generated
  value is not Git-managed plaintext or an editable SOPS credential. The current Control Panel
  Secrets API inventories only files beneath `infrastructure/secrets/**`; generated token metadata
  therefore lives in this document and `docs/secrets-inventory.md`, not a misleading editable UI row.
  To revoke, remove the ClusterRoleBinding immediately; to rotate a compromised token, delete only
  this generated Secret, reconcile `monitoring`, then rerun the deployer. Do not copy admin kubeconfig
  to Iris. API CA replacement also requires redeployment.

`smoke.mjs` sends clearly marked **TEST FIRING / TEST RESOLVED** messages to both destinations,
using synthetic debounce/recovery state and the real independent-DNS delivery path. It does not
stop the cluster or alter the live watchdog's state. Test a real failure only in an approved maintenance
window; never power down production simply to prove alerting.

Failure boundaries: Iris can notify about cluster loss while the Mac, router, LAN, internet and
notification providers remain up. It cannot report its own power loss during a simultaneous cluster
outage, nor total site power/WAN loss. Cluster-side alerts cover Iris loss while the cluster is alive.
An external dead-man's-switch would be needed for whole-site failure coverage; none is implied here.

## Maintenance / onboarding exceptions

Homebrew/native updates remain manual (`brew outdated node_exporter node`, review upstream release
notes, upgrade, rerun deployer, verify plists/metrics and notification smoke test). Dynacat Releases
includes OpenClaw, Hermes and node_exporter. Existing application upgrade policies are unchanged.

Kubernetes chart/image update rows, HPA, resource-advisor/Tuning apply policy, pod requests/limits,
and disabled share plumbing are **N/A** for native host jobs: there is no pod, chart, HPA or share
service to register. Do not invent Kubernetes inventory rows or publicly expose exporter/readiness
ports. Prometheus/Grafana/blackbox reuse existing workloads with unchanged resource reservations.

## Validation

`node --test native/iris/watchdog.test.mjs` covers debounce/recovery, independent notification
retries, stale readiness, endpoint response validation, cross-domain launchd listings and Hermes
readiness failures despite running processes (missing APIs, malformed status, stale heartbeat,
disconnected platforms or unhealthy components).
For alert regression tests, extract `PrometheusRule.spec` from
`infrastructure/monitoring/prometheusrule-iris.yaml` into `iris-rules.yaml` beside a temporary
copy of `native/iris/alerts.test.yaml`, then run `promtool test rules alerts.test.yaml` there.
The fixtures include real discovery's `service="iris-node"` label, healthy telemetry,
missing host/watchdog data, stopped agents, low/critical APFS space, Hermes component failures
despite healthy processes/HTTP APIs, and independent Athena HTTPS-path failure.

Verify launchd restart behavior for the two managed telemetry jobs, process/readiness samples, both cluster probes, private scrape targets, Darwin/APFS dashboard metrics, and actual Dynacat/Kuma entries. Confirm the restricted identity can read readiness but cannot list nodes or Secrets. Check native credential/state files are mode 0600.

The installer retries launchd's asynchronous `bootout`/`bootstrap` race for up to ten seconds. A transient code 5 after successful unload is not by itself a reason to add sudo or alter existing agent jobs.
