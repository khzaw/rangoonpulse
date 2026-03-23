# Homelab Ideas Backlog

This file tracks ideas explicitly rated `good` or better that are still active, plus a short record of ideas that have already landed so the backlog stays current.

## Recently Implemented / Largely Delivered

1. `implemented (was really good)` - Public Exposure Control Plane (Blog + Temporary Shares)
- Delivered as `apps/exposure-control` + `infrastructure/public-edge`.
- `controlpanel.khzaw.dev` now handles temporary public shares, expiry, Access-by-default, audit history, disable-all, and the permanent-public blog path.

2. `implemented (was really good)` - Capacity-Aware Resource Advisor v2
- Delivered and surpassed as the current phased resource-advisor flow.
- Node-fit simulation, advisory posture, live preflight, weekly apply PRs, and cockpit integration are already in place.

3. `implemented in lean form (was good)` - Self-Service Ops Portal / Lean Ops Command Center
- `controlpanel.khzaw.dev` is now the combined operator cockpit for exposure control, Transmission routing, travel readiness, image/chart updates, and tuning.
- Remaining gap: generic restart/reconcile/runbook actions are still backlog rather than done.

4. `implemented (was good)` - Prometheus Persistent Storage
- Prometheus now persists TSDB on `local-path` with `retention: 14d`, `retentionSize: 8GB`, and `walCompression: true`.

## Active Backlog

1. `really good` - Jellyfin-Aware Load Shedding
- This replaces the older, vaguer `Media-Aware Dynamic Throttling` idea with one concrete plan.
- Goal: detect real Jellyfin playback/transcode pressure, temporarily shed lower-priority primary-node work, and restore automatically once playback is back to idle.
- Reuse what already exists:
  - `apps/exposure-control` already owns runtime write actions, audit logging, and the operator UI.
  - `apps/transmission/transmission-vpn-control.yaml` already shows the right GitOps-safe pattern for runtime-owned overlays.
  - Glance already uses Jellyfin's `Sessions` API, so session-based detection fits the current repo.
  - Prometheus already has primary-node pressure signals through `homelab:node_host_cpu_utilization:ratio` and `homelab:node_host_memory_utilization:ratio`.
- Implementation plan:
  1. Define the policy surface first.
  - Add a dedicated config file under `apps/exposure-control/` for thresholds, cooldowns, priorities, and per-service actions.
  - Start with only workloads that materially affect the primary node: `transmission`, `sabnzbd`, and `bazarr`.
  - Keep Pi-hosted apps out of phase 1 unless they are shown to create meaningful downstream churn on the primary node.
  - Treat `sonarr` and `radarr` as hard-tier optional targets, not first-pass ones.
  2. Add runtime-safe control surfaces for the target services.
  - Mirror the existing Transmission control model: Git-managed control ConfigMap plus runtime-owned state ConfigMap, consumed by optional `valuesFrom` overlays in each target HelmRelease.
  - Keep the control loop out of direct `kubectl scale` patches on Flux-managed workloads so GitOps does not fight the runtime controller.
  - Use the overlays only for reversible actions such as `replicas: 0` or other chart-native pause/downscale toggles.
  3. Detect real media pressure instead of guessing.
  - Poll Jellyfin's cluster-local `Sessions` endpoint with a dedicated API key and classify:
    - active streams,
    - active transcodes,
    - paused vs playing sessions.
  - Query Prometheus for primary-node host CPU and memory utilization so one light session does not trigger unnecessary shedding.
  - Compute four states with hysteresis: `idle`, `observe`, `soft-shed`, and `hard-shed`.
  - Enter shed only after sustained pressure; restore only after sustained idle/low-pressure cooldown.
  4. Actuate in small, policy-driven steps.
  - `soft-shed`: pause or scale down `transmission` and `sabnzbd`.
  - `hard-shed`: additionally pause or scale down `bazarr`, then optionally `sonarr` and `radarr` if the soft tier is insufficient.
  - Avoid actions that restart Jellyfin itself or churn stateful infrastructure.
  - Add manual override states in the cockpit such as `auto`, `forced-off`, and `hold-current` to avoid surprise behavior during debugging.
  5. Make the control loop observable.
  - Extend the cockpit with a load-shedding panel that shows current mode, why it entered that mode, which workloads are currently shed, and when restore is expected.
  - Append every transition to the existing audit log.
  - Export Prometheus metrics for active streams, active transcodes, current shed level, action counts, and last transition time.
  - Add focused alerts only after the loop is stable, for example "stuck in hard-shed too long" or "detection failing while Jellyfin is active".
  6. Roll it out in phases instead of flipping straight to automation.
  - Phase 0: advisory-only mode in the cockpit with no write actions.
  - Phase 1: enable only the `soft-shed` tier for `transmission` and `sabnzbd`.
  - Phase 2: add `bazarr` if the first tier materially improves Jellyfin headroom.
  - Phase 3: decide whether `sonarr`/`radarr` are worth touching based on real operating data rather than intuition.
- Expected implementation touch points:
  - `apps/exposure-control/server.js`
  - `apps/exposure-control/app.js`
  - `apps/exposure-control/index.html`
  - `apps/exposure-control/helmrelease.yaml`
  - `apps/exposure-control/rbac.yaml`
  - new service control ConfigMaps plus `valuesFrom` runtime overlays in the target app HelmReleases
  - monitoring objects for metrics and alerts once the loop is real

2. `really good` - Away Mode / Quiet Hours Control Plane
- Travel Center already exists, but there is still no expiring "away" or "quiet hours" posture change.
- Build on the current control panel actions: disable all temporary public shares, switch Transmission to a safer default mode, and optionally pause selected background workloads with auto-restore.

3. `good` - Operator Cockpit Safe Actions Expansion
- The operator cockpit foundation already exists.
- Remaining scope: safe restart, Flux reconcile, and guided diagnostics actions with audit trail and tight RBAC.

4. `good` - Database Consolidation (BookLore MariaDB)
- Evaluate whether the current BookLore release supports Postgres cleanly enough to move from `booklore-mariadb` to `media-postgres`.
- Goal remains to reclaim standalone MariaDB overhead without creating a higher-risk migration than the saved RAM is worth.

5. `good` - ARM Node Utilization (Remaining Headroom Work)
- This is no longer a greenfield idea: `autobrr`, `prowlarr`, `jackett`, `flaresolverr`, `profilarr`, `glance`, and `uptime-kuma` are already on the utility node.
- Remaining candidates worth auditing for the Pi are `bazarr`, `sabnzbd`, and possibly `transmission` once image, storage, and throughput tradeoffs are verified.

6. `good` - Monitoring Completion: Remaining Rules + Notification Delivery
- Some alerting has landed already, especially around DNS reliability and exposure-control.
- Remaining work is to finish the missing PrometheusRules for homelab-specific failure modes and wire a real delivery path.
- Current blocker: `alertmanager` is still disabled, so existing alerts are mostly dashboard-visible rather than operator-delivered.

7. `good` - Public Edge IaC / Smoke-Check Polish
- Exposure control, blog public routing, metrics, and basic monitoring are in place.
- Remaining gaps:
  - move more of the Cloudflare Access/WAF/cache policy into reproducible IaC,
  - add scheduled smoke checks for the share-toggle flow and the permanent-public blog path.

8. `really good` - Unified Static Sites Origin (Multi-Host, One Runtime)
- Consolidate `blog` + `mmcal` (and future static sites) onto a single lightweight `static-sites` app behind the existing Cloudflare Tunnel route model.
- Serve multiple hostnames from one runtime using host-based vhosts/docroots (`/srv/sites/<hostname>`), while keeping existing `public-edge` CNAME + tunnel patterns.
- Avoid "all sites roll together" risk by adding per-site release tooling:
  - each site builds/publishes its own static artifact (OCI/image),
  - GitOps stores one pinned version per site,
  - a fetch/reload component updates only the changed site content and hot-reloads the static server.
- Result: lower baseline resource usage and faster onboarding of new static sites, without sacrificing independent site rollback/deploy control.

## Deferred / Not Included

- Items marked as not needed or not for now are intentionally excluded from this list.
