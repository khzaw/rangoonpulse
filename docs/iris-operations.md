---
title: Iris native macOS operations
summary: Native launchd supervision, Darwin telemetry, gateway checks, and an independent sentinel.
status: active
owner: homelab
last_reviewed: 2026-11-11
---

# Iris native macOS operations

Iris is the Apple Silicon Mac mini identified by `IRIS_MAC_MINI_IP` in
`flux/cluster-settings.yaml`. OpenClaw and Hermes run as native macOS processes.
The [dedicated SSH/HTTPS VIP](./mac-mini-edge.md) routes to those host services.
Hardware is an Apple M4 (4 performance + 6 efficiency CPU cores),
24 GB RAM. An independent unprivileged `macmon` sampler feeds software-reported
system watts through its existing node exporter into the
[power/cost pipeline](./power-estimation-dashboard.md). No Kubernetes membership or
additional network listener is needed. Grafana includes Iris as a separate host and in combined homelab totals;
Kubernetes-only power, readiness, and capacity remain separate.

## Operating surfaces

- Grafana: <https://grafana.khzaw.dev/d/iris-overview> (Darwin-specific metrics, OpenClaw readiness,
  Hermes gateway/dashboard APIs, component readiness, active agents and platform connections).
  Header buttons link to Iris Gateway, [Hermes / Athena](https://athena.khzaw.dev), and Gatus.
- Dynacat: Home → Ops → Iris / Hermes (Athena) / Iris Overview; Health → Iris Gateway /
  Iris API Readiness / Hermes Gateway / Hermes Dashboard / Hermes Readiness.
- Gatus monitors are Git-owned in `apps/gatus/helmrelease.yaml`. The gateway,
  cached readiness relays, dashboards, and HTTPS edges remain separate checks.
  Change their endpoints and JSON conditions in Git; see [Gatus](./gatus.md).
- Prometheus blackbox probes the direct SSH listener on `10.0.0.66:22` and the
  Hermes gateway relay, dashboard health, combined readiness relay, and HTTPS edge.
  HTTP probes require status 200 and JSON `ok: true`. Targets are declared in
  `infrastructure/monitoring/helmrelease-blackbox-exporter.yaml`.
- `Iris.*` critical and warning alerts reuse the existing Telegram/Discord Alertmanager route.
  Host metrics unavailable: 3m; agent health failure: 3m; APFS Data free space:
  below 10% for 10m / below 5% for 5m; native telemetry stale/missing: 3m after a 180s stale threshold.
  Host unavailable means exporter/network/power loss, not a definitive diagnosis of which one.
  `IrisOpenClawUnhealthy` covers only OpenClaw's launchd gateway, native readiness and
  blackbox health/readiness checks. `IrisHermesUnhealthy` covers only Hermes's launchd
  gateway/dashboard, native gateway/dashboard/status/component readiness and Hermes
  blackbox targets. Each rule aggregates failing checks into one stable alert with
  `host="iris"` and its `agent` label; target, launchd and scrape labels cannot create
  extra incidents. A failure moving between checks does not reset the 3m pending timer.
  After firing, the alert stays open until no check has failed for 3m
  (`keep_firing_for`), so brief recovery during an upgrade does not emit a resolution.
  Alertmanager groups the distinct alert names separately and sends one service's
  recovery independently of the other. Existing 30s notification grouping wait,
  5m group update interval and 4h reminders for prolonged outages still apply.
  Missing telemetry remains covered by `IrisWatchdogStale` and `IrisHostUnavailable`.

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
The Hermes gateway uses the user's launchd domain, while other jobs use the GUI domain:
inspect the caller's `launchctl list`, not GUI-only service paths. Derive the UID with
`id -u` rather than assuming a numeric account ID. The metric label is `launchd_service` to avoid
Prometheus's discovery-owned `service` label (which otherwise renames the metric label to `exported_service`).

## Native installation and supervision

Versioned implementation: [`native/iris/`](../native/iris/). Homebrew supplies `node_exporter`,
`macmon` and the existing Node installation; no npm packages or containers are needed.

| launchd label | Function |
| --- | --- |
| `ai.openclaw.gateway` | OpenClaw gateway; managed outside the telemetry installer |
| `ai.hermes.gateway` | Hermes gateway; managed outside the telemetry installer |
| `dev.khzaw.hermes.dashboard` | Hermes dashboard; managed outside the telemetry installer |
| `dev.khzaw.iris.node-exporter` | Darwin exporter, LAN `10.0.0.66:9100`, textfile collector |
| `dev.khzaw.iris.watchdog` | OpenClaw/Hermes API readiness relays, launchd/component metrics, independent cluster checks/notifications |
| `dev.khzaw.iris.power` | Independent `macmon pipe` sampler and atomic power/freshness textfile output |

All three managed jobs have `RunAtLoad`, `KeepAlive`, and a 10-second restart throttle. They are login
**LaunchAgents**, consistent with the existing agents. They survive crashes but require the host
GUI login session after reboot. These jobs do not provide pre-login LaunchDaemon supervision.
Unattended startup requires separate verification of login, FileVault, sleep, and power-recovery settings;
those host settings are outside the repository's installation contract.

Metrics are private LAN listeners only: no new Ingress, DNS records, share route, or public exposure.
Do not run `brew services start node_exporter` alongside the managed job (port/ownership conflict).

Install/update only the power collector without touching the exporter, watchdog,
private credentials or notification destinations. Install Homebrew `macmon` on
Iris (not on a separate deployment workstation):

```sh
ssh iris@iris.khzaw.dev 'HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew install macmon'
node --test native/iris/power.test.mjs
node native/iris/deploy.mjs --only power iris@iris.khzaw.dev
```

When running directly on Iris, SSH is unnecessary; install the same versioned
files and select only the power job:

```sh
cp native/iris/{power,install}.mjs ~/.local/share/rangoonpulse/iris/
node ~/.local/share/rangoonpulse/iris/install.mjs --only power
```

The power job starts without Kubernetes, DNS or network access. It samples roughly
every ten seconds, bounds input and the wait for valid samples, and removes old
output before startup. Child exit, a stalled sampler or write failure removes
power output and exits nonzero for launchd recovery. Shutdown terminates and waits
for its child. Neither power failures nor its deployment restart the independent
watchdog/sentinel. Prometheus requires a sample age of at most 90 seconds even if
the exporter can still serve an old file. Missing periods stay missing; there is
no durable sample queue or replay. Normal scrapes resume after reconnection.

For a complete native telemetry deployment after monitoring GitOps has reconciled:

```sh
ssh iris@iris.khzaw.dev 'HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew install node_exporter macmon'
node --test native/iris/watchdog.test.mjs
KUBECONFIG="$PWD/kubeconfig" node native/iris/deploy.mjs
ssh iris@iris.khzaw.dev '/opt/homebrew/bin/node ~/.local/share/rangoonpulse/iris/smoke.mjs'
```

The deployer reads live cluster settings and existing receiver credentials, copies source/config
over SSH, validates plists, and replaces **only the three managed jobs**. No credentials appear in argv,
Git, or console output. Existing OpenClaw/Hermes configs and processes are never rewritten.

Paths on Iris:

- `~/.local/share/rangoonpulse/iris/`: installed versioned source.
- `~/.config/rangoonpulse/iris/{config,notifications,kubernetes}.json`: private config, mode 0600.
- `~/.local/state/rangoonpulse/iris/alerts.json`: persisted debounce/delivery state, mode 0600.
- `~/.local/state/rangoonpulse/iris/textfile/iris.prom`: atomically replaced watchdog metrics.
- `~/.local/state/rangoonpulse/iris/textfile/iris-power.prom`: independent system watts and valid-sample receipt timestamp.
- `~/Library/LaunchAgents/dev.khzaw.iris.*.plist`: telemetry supervision definitions.
- `~/Library/Logs/rangoonpulse/`: telemetry job stdout/stderr. Successful cycles are quiet;
  inspect/rotate logs during prolonged notification failures (no system log-rotation rule installed).

```sh
ssh iris@iris.khzaw.dev 'launchctl print gui/$(id -u)/dev.khzaw.iris.watchdog'
ssh iris@iris.khzaw.dev 'launchctl print gui/$(id -u)/dev.khzaw.iris.node-exporter'
ssh iris@iris.khzaw.dev 'launchctl print gui/$(id -u)/dev.khzaw.iris.power'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/openclaw'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/hermes'
ssh iris@iris.khzaw.dev 'curl -fsS http://10.0.0.66:9101/healthz/hermes-gateway'
```

## Agent cluster access

Native agents use the same tailnet-authenticated kubeconfig and Git-managed RBAC
profiles as agents on Linux VMs or VPS hosts. See [agent access](./agent-access.md)
for enrollment, permission checks, and recovery boundaries. This requires no
macOS-specific credential renewal job and does not change native process supervision.

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
  this generated Secret, reconcile `monitoring`, then rerun the deployer. Keep the watchdog on
  this health-only identity rather than an operator kubeconfig.
  API CA replacement also requires redeployment.

`smoke.mjs` sends clearly marked **TEST FIRING / TEST RESOLVED** messages to both destinations,
using synthetic debounce/recovery state and the real independent-DNS delivery path. It does not
stop the cluster or alter the live watchdog's state. Test a real failure only in an approved maintenance
window; never power down production simply to prove alerting.

Failure boundaries: Iris can notify about cluster loss while the Mac, router, LAN, internet and
notification providers remain up. It cannot report its own power loss during a simultaneous cluster
outage, nor total site power/WAN loss. Cluster-side alerts cover Iris loss while the cluster is alive.
An external dead-man's-switch would be needed for whole-site failure coverage; none is implied here.

## Maintenance / onboarding exceptions

Homebrew/native updates remain manual (`brew outdated node_exporter node macmon`, review upstream release
notes, upgrade, rerun deployer, verify plists/metrics and notification smoke test). Dynacat Releases
includes OpenClaw, Hermes and node_exporter. Consult each application's update policy separately.

Kubernetes chart/image update rows, HPA, resource-advisor/Tuning apply policy, pod requests/limits,
and disabled share plumbing are **N/A** for native host jobs: there is no pod, chart, HPA or share
service to register. Do not invent Kubernetes inventory rows or publicly expose exporter/readiness
ports. Prometheus/Grafana/blackbox integrations use the existing monitoring workloads.

## Validation

`node --test native/iris/*.test.mjs` covers power parsing, real child/atomic-file
lifecycle, stalled samples, crash cleanup, deployment isolation and plist contracts.
`node --test native/iris/watchdog.test.mjs` covers debounce/recovery, independent notification
retries, stale readiness, endpoint response validation, cross-domain launchd listings and Hermes
readiness failures despite running processes (missing APIs, malformed status, stale heartbeat,
disconnected platforms or unhealthy components).
For alert and power regression tests, run
`uv run --no-project --with PyYAML==6.0.3 python scripts/test_power_estimation_promql.py`.
It renders the power and Iris rule groups together, preserves their evaluation
ordering, and runs the native alert fixtures with `promtool`.
The fixtures include real discovery's `service="iris-node"` label, healthy telemetry,
missing host/watchdog data, stopped agents, low/critical APFS space, Hermes component failures
despite healthy processes/HTTP APIs, and independent Athena HTTPS-path failure.

Verify launchd restart behavior for the three managed telemetry jobs, process/readiness samples, both cluster probes, private scrape targets, Darwin/APFS dashboard metrics, and actual Dynacat/Gatus entries. Confirm the restricted identity can read readiness but cannot list nodes or Secrets. Check native credential/state files are mode 0600.

The installer retries launchd's asynchronous `bootout`/`bootstrap` race for up to ten seconds. A transient code 5 after successful unload is not by itself a reason to add sudo or alter existing agent jobs.
