# AGENTS.md - rangoonpulse

## Project Overview
Homelab Kubernetes infrastructure-as-code repository using Flux CD GitOps.

This file documents how this cluster is operated today so a new LLM session can
continue work without re-discovery.

## Cluster Profile
- Kubernetes: Talos Linux cluster (primary `amd64` node + smaller `arm64` utility node)
- GitOps: Flux CD v2 (`Kustomization` + `HelmRelease`)
- Primary ingress: ingress-nginx with MetalLB
- DNS/TLS: Cloudflare + external-dns + cert-manager (Let's Encrypt)
- DNS automation model: external-dns (Cloudflare); tofu/terraform controller path is not active
- LAN recursive DNS/filtering: AdGuard Home (`Service/adguard-dns`, `10.0.0.233:53`) with secondary resolver
  (`Service/adguard-secondary-dns`, `10.0.0.234:53`)
- Remote access: Tailscale operator + combined subnet router / exit node (`Connector`)
- Storage mix: `local-path`, TrueNAS NFS classes (`truenas-*`), democratic-csi present
- Operational metrics: `metrics-server` in `kube-system` (`kubectl top`, HPA inputs)
- Timezone standard: `Asia/Singapore`

## Repository Structure
- `apps/`: user-facing applications (mostly `namespace: default`)
- `core/`: core components (for example ingress-nginx base install/patch)
- `infrastructure/`: infra components and non-app services
- `flux/`: Helm repositories + Flux Kustomizations
- `flux/cluster-settings.yaml`: source of truth for shared non-secret cluster constants used by Flux substitutions
- `skills/`: project-specific agent skills and session bootstraps
- `talos/`: Talos machine configuration
- `docs/`: architectural notes, migration docs, backup planning

## Non-Negotiable Working Rules
- Use GitOps. Do not rely on direct `kubectl apply` for permanent changes.
- `kubectl apply --dry-run=client` is fine for validation.
- Prefer `HelmRelease` changes over raw manifests.
- Do not introduce a separate `values.yaml` when an app can be fully configured inline in `helmrelease.yaml`.
- Keep ingress, DNS annotation, and TLS settings aligned for every externally accessed app.
- Do not commit plaintext passwords/API keys in manifests.
- Prefer `flux/cluster-settings.yaml` for cluster-wide non-secret constants instead of redeclaring the same domain,
  node name, IP, VIP, or timezone value across many manifests.
- When using Flux post-build substitutions, escape runtime-literal placeholders as `$${VAR}` so Flux renders literal
  `${VAR}` into the applied manifest.

## Documentation Hygiene (For Agents)
- If you change conventions (networking/access model, DNS/hostnames, storage classes, secrets patterns, app charts),
  update `AGENTS.md` and the most relevant doc(s) under `docs/`.
- If you find a new operational gotcha or incident pattern, add a short focused doc in `docs/` and link it from
  `AGENTS.md` ("Useful Reference Docs").
- Keep docs actionable: file paths, k8s object names, and concrete commands beat long narratives.
- Don’t churn docs for small tweaks; update docs only when it improves future ops/debugging.

## Session Bootstrap (For Agents)
- On every new session in this repo, read `README.md` and `docs/README.md` after this file before planning or editing.
- Use the project skill `rangoonpulse-session-bootstrap` when the agent skill catalog exposes it; treat that bootstrap as mandatory for every new session and session takeover.
- After reading `docs/README.md`, open the focused doc(s) for the task's domain before making recommendations or edits.
- Do not brute-force every file in `docs/`; use the docs index to pick the relevant subset.
- When adding, deploying, exposing, or materially changing a service, use the project skill `rangoonpulse-service-deploy` when the agent skill catalog exposes it.

## Service Change Touch Points
- When adding, moving, renaming, or materially changing a service, update all relevant operators surfaces in the same
  change:
  - Glance links/monitors in `apps/glance/helmrelease.yaml`
  - control panel catalog in `apps/exposure-control/services.json` if the service should be share-managed
  - resource advisor mapping/allowlist in `infrastructure/resource-advisor/advisor.py`,
    `infrastructure/resource-advisor/cronjob-apply-pr.yaml`, and related docs if the service is auto-tuned
  - ingress/DNS/TLS exposure annotations if external access changes
  - `AGENTS.md`, `README.md`, and the most relevant `docs/*.md` references
- Do not leave stale paths or service names behind after refactors.

## Current Access Model (Important)
The cluster uses a simplified unified path:
- LAN path: user -> `10.0.0.231` (MetalLB ingress IP)
- Remote path: user on Tailscale -> routed to `10.0.0.231` via subnet router
- Travel full-tunnel path: user on Tailscale -> internet egress via the same home Connector acting as an exit node
- Public internet pilot path: Cloudflare Tunnel via `infrastructure/public-edge/` (dedicated share hostnames only)

Implemented via:
- `infrastructure/tailscale-subnet-router/connector.yaml`
  - acts as both subnet router and exit node
  - advertises routes:
    - `10.0.0.197/32` (Talos node / Kubernetes API)
    - `10.0.0.38/32` (utility node)
    - `10.0.0.231/32` (ingress)
    - `10.0.0.210/32` (NAS)
    - `10.0.0.1/32` (router)
  - remote clients can use the same Connector as a Tailscale exit node while still reaching the homelab over the advertised `/32` routes
- `infrastructure/lan-gateway/` for NAS/router hostname access through ingress
  - `nas.khzaw.dev` -> service/endpoints -> `10.0.0.210:80`
  - `router.khzaw.dev` -> service/endpoints -> `10.0.0.1:80`
  - TLS terminates at ingress with cert-manager

Notes:
- Old Tailscale ingress-proxy/DNS indirection was removed in favor of subnet routing.
- `lan-access` Flux kustomization points to `./infrastructure/lan-gateway`.
  - If NFS-backed PVCs suddenly fail (democratic-csi probe timeout / pods stuck `ContainerCreating`), first check
    the TrueNAS Tailscale app has **"Accept Routes" disabled** to avoid asymmetric routing. See:
  - `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`
- Temporary public exposure (lean MVP + security hardening):
  - backend + UI: `apps/exposure-control/`
  - control panel host: `controlpanel.khzaw.dev`
  - `controlpanel.khzaw.dev` is now the combined operator cockpit for exposure control, Transmission VPN, image updates,
    Travel readiness, and the resource-advisor tuning view
  - backend split remains unchanged:
    - `apps/exposure-control/` owns operator write actions and the cockpit shell
    - `infrastructure/resource-advisor/` remains a separate backend/exporter and data source for tuning
  - `tuning.khzaw.dev` has been retired as a public hostname
  - raw tuning artifacts are exposed through the cockpit:
    - `https://controlpanel.khzaw.dev/api/tuning/latest.json`
    - `https://controlpanel.khzaw.dev/api/tuning/latest.md`
    - `https://controlpanel.khzaw.dev/api/tuning/metrics`
  - `resource-advisor` still serves `/api/ui.json`, `/latest.json`, `/latest.md`, and `/metrics` on its cluster-local Service
  - share hosts route through Cloudflare Tunnel -> `exposure-control` backend
  - default temporary exposure expiry: `1h` (UI presets include `15m`, `30m`, `1h`, `2h`, `6h`, `12h`, `24h`)
  - UI auth default: `none`; backend/API default auth mode: `cloudflare-access` (configurable per enable action)
  - rate limiting, Prometheus metrics at `/metrics`, emergency disable-all
  - image update tracker is best-effort:
    - stable semver tags use version comparison
    - non-semver numeric families (for example `24-alpine`, `25.07`, `4.0.16.2944-ls304`) use same-family tag comparison
    - floating or non-sortable tags (for example `latest`, `next`, `stable-alpine`, `pg16`) fall back to remote digest comparison for the current tag
  - image update tracker exclusions are configured by `IMAGE_UPDATE_EXCLUDED_WORKLOADS` in
    `apps/exposure-control/helmrelease.yaml` (current exclusions: `blog`, `mmcal`, `rangoon-mapper`)
- Transmission optional VPN toggle:
  - control/API host: `controlpanel.khzaw.dev`
  - Gluetun WebUI host: `torrent-vpn.khzaw.dev`
  - GitOps control config: `apps/transmission/transmission-vpn-control.yaml`
  - runtime state: `ConfigMap/default/transmission-vpn-state` (runtime-owned; do not reconcile with Flux)
  - credentials: `infrastructure/secrets/default/transmission-vpn-secret.yaml`
  - Gluetun control auth secret: `infrastructure/secrets/default/transmission-gluetun-control-secret.yaml`
  - current scaffold: `gluetun` + custom WireGuard placeholder values
  - actual VPN routing requires either a real WireGuard-capable VPN subscription or your own WireGuard endpoint; `direct` mode needs neither
  - default seed mode is `direct`; switch via control panel or `POST /api/transmission-vpn`
  - `gluetun-webui` runs as a sidecar in the Transmission pod and talks to Gluetun on `127.0.0.1:8000`
  - control panel changes whether the `gluetun` container exists; the WebUI start/stop button only affects the running VPN process when VPN mode is active
- Permanent public: `blog.khzaw.dev` routes directly through Cloudflare Tunnel to `blog.default.svc.cluster.local:8080` (bypasses exposure-control)
  - DNS ownership for `blog.khzaw.dev` is `infrastructure/public-edge/share-hosts-cname.yaml` (`Service/blog-cname`).
  - Do not add `external-dns.alpha.kubernetes.io/hostname: blog.khzaw.dev` on the blog Ingress, or it will publish a private `A` record (`10.0.0.231`).
- Calibre manage explicit port access:
  - `https://calibre-manage.khzaw.dev/content` stays on shared ingress class `nginx`.
  - `https://calibre-manage.khzaw.dev:9090/content` is served by dedicated ingress class `nginx-calibre`.
  - `core/ingress-nginx/calibre-controller.yaml` defines `Service/ingress-nginx-calibre-controller` (port `9090`) sharing VIP `10.0.0.231` via MetalLB `allow-shared-ip`.
  - `apps/calibre/ingress.yaml` includes `Ingress/calibre-content-9090`, which is content-path-only and intentionally has no `external-dns` or `cert-manager` annotation.

## Nodes (Current)
- Primary node: `talos-7nf-osf` (`amd64`, `10.0.0.197`)
- Utility node (Raspberry Pi): `talos-uua-g6r` (`arm64`, `10.0.0.38`)
- Current node health: both nodes are functional and schedulable.

## Scheduling / Node Placement (Important)
- Default policy: pin userland workloads to the primary node (`talos-7nf-osf`).
  - For `bjw-s-charts/app-template` (common v4), use:
    - `values.defaultPodOptionsStrategy: merge`
    - `values.defaultPodOptions.nodeSelector.kubernetes.io/hostname: talos-7nf-osf`
- Allowed on the Raspberry Pi (`talos-uua-g6r`) today:
  - `infrastructure/public-edge` (`cloudflared`)
  - `apps/exposure-control`
  - `apps/glance` (dashboard)
  - `apps/profilarr`
  - `apps/adguard`
  - `apps/chartsdb`
  - `apps/uptime-kuma`
  - `apps/speedtest`
  - `apps/actualbudget`
  - `apps/reactive-resume`
  - `apps/anki-server`
  - `apps/autobrr`
  - `apps/prowlarr`
  - `apps/jackett`
  - `apps/flaresolverr`
- Remember: `local-path` PVs are node-affined. Moving an app between nodes usually implies wiping/recreating the PVC
  (or migrating storage to NFS).

## Ingress and DNS Pattern
For public or tailnet-only app hostnames, use:
- ingress class: `nginx`
- annotation: `external-dns.alpha.kubernetes.io/hostname`
- annotation: `cert-manager.io/cluster-issuer: letsencrypt-prod`
- annotation: `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
- TLS section with matching hosts

Exception (`calibre-manage` explicit port):
- Use ingress class `nginx-calibre` in `apps/calibre/ingress.yaml` (`Ingress/calibre-content-9090`) for `:9090/content`.
- Do not add `external-dns` or `cert-manager` annotations on the `nginx-calibre` Ingress; it reuses hostname DNS + TLS secret managed by the primary `nginx` Ingress.

Important external-dns behavior:
- external-dns is configured to ignore `spec.rules[].host` and `spec.tls[].hosts` on Ingress resources.
  You must declare hostnames via the `external-dns.alpha.kubernetes.io/hostname` annotation or DNS will not be created.
- external-dns also watches Services (`--source=service`), which enables clean CNAME aliases via `ExternalName`
  Services (example: `infrastructure/monitoring/monitoring-cname.yaml`).

## LAN DNS (AdGuard)
- Primary deployment: `apps/adguard/helmrelease.yaml`
- Secondary deployment: `apps/adguard/helmrelease-secondary.yaml`
- DNS endpoints for router/clients:
  - `Service/adguard-dns` (`LoadBalancer` `10.0.0.233`, TCP/UDP `53`) on the Raspberry Pi node
  - `Service/adguard-secondary-dns` (`LoadBalancer` `10.0.0.234`, TCP/UDP `53`) on the primary node
- Both DNS Services use `externalTrafficPolicy: Local` to preserve client source IP in AdGuard query logs.
- Router DHCP is the active DHCP authority in the current model.
- AdGuard built-in DHCP is kept disabled (enforced at startup) in this Kubernetes deployment model.
- Do not use Kubernetes `ClusterIP` addresses in LAN DNS settings.
- AdGuard web UI is exposed at `https://adguard.khzaw.dev` through ingress (`Service/adguard-main`).
- Secondary AdGuard web UI is exposed at `https://adguard2.khzaw.dev` through ingress (`Service/adguard-secondary-main`).
- Post-install wizard note: AdGuard may switch web UI to port `80`; keep `service.main.ports.http.port` aligned with runtime.
- Mount the AdGuard PVC at a neutral path (current: `/adguard-data`), not split `conf/` and `work/` behind `subPath` mounts.
  If the PVC is not a real mount, startup should fail fast rather than silently writing state into container overlay storage.
- Do not make two live AdGuard instances share one writable data directory. Keep PVCs separate; seed secondary config from primary
  if you need matching behavior, or move the desired settings into GitOps.
- Runtime DNS tuning is enforced at container startup in both `apps/adguard/helmrelease.yaml` and
  `apps/adguard/helmrelease-secondary.yaml` (including `upstream_mode: fastest_addr`) to avoid drift after UI/wizard
  changes.
- Detailed architecture + router setup: `docs/adguard-dns-stack-overview.md`

## Cluster DNS Reliability (Flux Path)
- GitOps component: `infrastructure/dns-reliability/` via Flux Kustomization `dns-reliability`.
- Purpose: harden CoreDNS external forward behavior and alert on DNS/Flux source-controller degradation.
- Includes:
  - `kube-system/ConfigMap coredns` hardening for external upstream forwarding
  - `monitoring/PodMonitor flux-controllers`
  - `monitoring/PrometheusRule dns-reliability`
- Incident and implementation details: `docs/dns-reliability-flux-gitrepository-timeouts.md`

## App Deployment Conventions
- Standard app layout:
  - `apps/<name>/helmrelease.yaml`
  - `apps/<name>/kustomization.yaml`
  - `flux/kustomizations/<name>.yaml`
  - add entry in `flux/kustomization.yaml`
- Most apps use `bjw-s-charts/app-template` chart.
- For ordinary userland workloads, prefer the `restricted` PodSecurity baseline:
  - pod `runAsNonRoot: true`
  - pod `seccompProfile.type: RuntimeDefault`
  - container `allowPrivilegeEscalation: false`
  - container `capabilities.drop: ["ALL"]`
  - use `fsGroup` only when the app needs writable PVC access
- Do not force this baseline blindly onto networking/storage/system daemons (for example CNI, CSI, kube-proxy, MetalLB speaker, Tailscale router) without verifying capability needs first.
- `apps/flaresolverr/helmrelease.yaml` currently tracks the forked image
  `alexfozor/flaresolverr:pr-1300` and remains pinned to the Raspberry Pi node (`talos-uua-g6r`).
- Keep resources explicit (requests and limits) for homelab capacity control.
- Validate manifests before pushing.

## Static Sites (`blog` and `mmcal`)
- Source-of-truth repos:
  - `github.com/khzaw/blog`
  - `github.com/khzaw/mmcal`
- Cluster deployment manifests:
  - `apps/blog/helmrelease.yaml`
  - `apps/mmcal/helmrelease.yaml`
- Flux image automation cadence for these sites:
  - `infrastructure/image-automation/blog-image-repository.yaml`: `interval: 6h`
  - `infrastructure/image-automation/mmcal-image-repository.yaml`: `interval: 6h`
  - `infrastructure/image-automation/image-update-automation.yaml`: `interval: 6h`
- Manual immediate rollout commands from this repo:
  - `make deploy-blog`
  - `make deploy-mmcal`
- Deployment strategy:
  - both `blog` and `mmcal` use `strategy: Recreate` to avoid mixed-version static asset sets during rollout.
- Cache behavior expectation:
  - Cloudflare should bypass cache on update-critical HTML/routes.
  - Cloudflare should cache hashed/static assets (css/js/fonts/images) aggressively.
- Publish workflows in source repos can purge Cloudflare update-critical URLs when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` secrets are set.

## Storage Conventions and Current Decisions
- Default StorageClass intent: `truenas-nfs` (NFS-backed default), not `local-path`.
- `truenas-hdd-config` has been retired. Use `truenas-nfs` for app/config PVCs that need expansion support.
- Immich:
  - photos/library on NFS PVC `immich-library` (`truenas-hdd-media`, RWX, 500Gi, expandable)
  - Postgres on `local-path` for low-latency/stability
- media-postgres (shared TimescaleDB):
  - Postgres/Timescale on `local-path` (node-local) for reliability; see `docs/media-postgres.md`
- Vaultwarden:
  - app data on `local-path` (`vaultwarden-data-local`, 2Gi)
  - dedicated Postgres (`vaultwarden-postgres`) on `local-path` (5Gi)
- Grafana:
  - persistent storage enabled on `local-path` (currently 1Gi PVC)
- Prometheus:
  - TSDB on node-local storage (`local-path`, `12Gi`) pinned to `talos-7nf-osf`
  - guardrails: `retention: 14d`, `retentionSize: 8GB`, `walCompression: true`
- Uptime Kuma:
  - data on node-local storage (`local-path`, 1Gi, pinned to `talos-uua-g6r`)
- Obsidian LiveSync:
  - CouchDB data on `local-path` (`obsidian-livesync-local`, 5Gi, node-affined)
- Anki server:
  - sync data on NFS (`truenas-nfs`, 5Gi, expandable)
- BookLore:
  - app data and MariaDB config/state on NFS (`truenas-nfs`, expandable)
  - mounts existing Calibre books data read-only for evaluation (`calibre-books-nfs`)
- Shelfmark:
  - config on `app-configs-pvc-nfs` (subPath `shelfmark`)
  - shares `calibre-books-nfs` for ebook delivery
  - shares BookLore `bookdrop` via PVC `booklore` (subPath `bookdrop`)
  - shares Audiobookshelf media via PVC `books` (subPath `audiobooks`)
- Tunarr:
  - config/state on NFS (`truenas-nfs`, mounted at `/root/.local/share/tunarr`)
- ErsatzTV:
  - config/state on NFS (`truenas-nfs`, mounted at `/config`)
  - media is mounted read-only from existing PVC claim `media`
- PVC object names in Kubernetes are dynamically generated by the provisioner and are not controlled by desired claim name.
- democratic-csi:
  - controller runs `hostNetwork: true` so the driver can reliably reach the TrueNAS API on `10.0.0.210`
  - refs: `infrastructure/storage/democratic-csi/hr-hdd.yaml`, `infrastructure/storage/democratic-csi/hr-nvme.yaml`

## Secrets and Credentials
- Runtime state: native Kubernetes Secrets.
- GitOps state: **SOPS + age** encrypted secret manifests under `infrastructure/secrets/**`, decrypted by Flux.
  - Flux decryption key Secret: `flux-system/sops-age`
  - SOPS rules: `.sops.yaml`
- Expected usage pattern in manifests:
  - `env` or chart values referencing `secretKeyRef`
  - no inline plaintext credentials
- Dashboard widget API keys are stored in `homepage-widget-secrets` and consumed by Glance via `envFrom`.
- Secret inventory (service -> secret mapping): `docs/secrets-inventory.md`
- Background/plan doc: `docs/secrets-management-current-state-options-and-plan.md`

## Dashboard (Glance)
- Glance:
  - `apps/glance/helmrelease.yaml` embeds `glance.yml` via ConfigMap and uses `envFrom: homepage-widget-secrets`
    so widgets can reference `${SONARR_API_KEY}`, `${JELLYFIN_API_KEY}`, etc.
  - Hostnames: `https://rangoonpulse.khzaw.dev` and `https://glance.khzaw.dev` (alias via `ExternalName` Service)
  - Operator entry link should point to `https://controlpanel.khzaw.dev` (`Operator Cockpit`).
  - Keep a separate health monitor for the resource-advisor backend even though the tuning UI is surfaced in the cockpit.
  - When writing Glance `custom-api` templates inside HelmRelease YAML, wrap the template in `{{\` ... \`}}`
    so Helm doesn't interpret Glance's `{{ ... }}`.

## Uptime Kuma Status Page Gotcha
- If Glance shows `Status Page Not Found` for slug `rangoonpulse`, create + publish a Status Page in
  Uptime Kuma with that slug (UI: `Status Pages` -> `New Status Page` -> `Slug` -> `Publish`).

## Monitoring/Grafana Notes
- Monitoring stack: `infrastructure/monitoring/helmrelease.yaml`
- Real-time operational metrics: `infrastructure/metrics-server/helmrelease.yaml`
  - namespace: `kube-system`
  - purpose: enable `kubectl top` and provide Metrics API for future HPA experiments
  - current Talos compatibility setting: `--kubelet-insecure-tls`
- Grafana hostnames:
  - primary: `grafana.khzaw.dev`
  - alias: `monitoring.khzaw.dev` (CNAME via `infrastructure/monitoring/monitoring-cname.yaml`)
- Current critical settings:
  - `nodeExporter.enabled: false` (correct key for chart line in use)
  - `kube-state-metrics` currently needs `128Mi` request / `256Mi` limit on this cluster; `128Mi` limit caused `OOMKilled` restart loops
  - whole-host node CPU/RAM comes from kubelet `/metrics/resource` via
    `infrastructure/monitoring/servicemonitor-kubelet-resource.yaml`
  - custom ops dashboards:
    - `infrastructure/monitoring/grafana-dashboard-homelab-control-room.yaml`
    - `infrastructure/monitoring/grafana-dashboard-storage-risk-overview.yaml`
    - `infrastructure/monitoring/grafana-dashboard-public-edge-overview.yaml`
    - `infrastructure/monitoring/grafana-dashboard-efficiency-and-placement.yaml`
    - `infrastructure/monitoring/grafana-dashboard-stateful-services-risk.yaml`
  - shared ops recording rules: `infrastructure/monitoring/prometheusrule-homelab-ops-dashboards.yaml`
  - node capacity overview dashboard + rules:
    - dashboard import: `infrastructure/monitoring/grafana-dashboard-node-capacity-overview.yaml`
    - recording rules: `infrastructure/monitoring/prometheusrule-node-capacity-overview.yaml`
  - node power tracking is estimate-only (no smart-plug telemetry):
    - recording rules: `infrastructure/monitoring/prometheusrule-power-estimation.yaml`
    - dashboard import: `infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml`
    - model = preferred whole-host CPU utilization from kubelet `/metrics/resource` (fallback: container CPU utilization)
      + fixed per-node idle/max watts (tune constants in the rule file)
    - estimated cost uses Singapore household regulated tariff series `homelab:singapore_household_tariff_sgd_per_kwh`;
      review/update quarterly against EMA/SP Group
  - Prometheus retention policy tuned for advisor window:
    - `retention: 14d`
    - `retentionSize: 8GB`
    - `walCompression: true`
    - `storageSpec.volumeClaimTemplate` on `local-path` (`12Gi`) pinned to `talos-7nf-osf`
  - one-time migration note: moving from `emptyDir` to PVC resets historical TSDB data on first rollout
  - Grafana persistence enabled
  - Grafana `defaultDashboardsTimezone: browser`
- If Grafana auth/state seems wrong, first verify PVC mount and user records before assuming full data loss.

## Naming and Migration Notes
- Jellyseerr -> Seerr migration is in progress.
- Path is `apps/seerr`, image is Seerr (`ghcr.io/seerr-team/seerr`), but some legacy Kubernetes object names still use `jellyseerr` for continuity.
- Do not rename release/object names casually when PVC/state continuity matters.

## Resource Tuning Guidance
- This is a primary-node homelab with mixed workloads (media + photos + utilities) plus a smaller ARM utility node.
- Keep requests realistic and limits bounded to reduce OOM/restart loops.
- Jellyfin can have occasional higher transcode load (rare 3-4 streams); avoid over-allocation across the rest of the stack.
- When tuning, prefer incremental adjustments and check restart counts/events after reconciliation.

## Resource Advisor Automation (Important)
- GitOps path: `infrastructure/resource-advisor/` via Flux Kustomization `resource-advisor`.
- Runtime model is Kubernetes CronJobs in namespace `monitoring`:
  - `resource-advisor-report`:
    - daily run at `02:30` (`Asia/Singapore`)
    - report-only mode
    - writes `latest.json` and `latest.md` to ConfigMap `resource-advisor-latest`
  - `resource-advisor-apply-pr`:
    - weekly run at `03:30` Monday (`Asia/Singapore`)
    - apply-PR mode with data-maturity guards, hard node-fit blocking, and advisory cluster posture ordering
    - persists `apply-plan.json`, `apply-plan.md`, and `applyLastRunAt` into the same runtime ConfigMap
    - creates one unique `tune/...` branch per selected service from latest `master`
    - opens one apply PR per selected service when eligible changes exist, so multiple service PRs can be emitted in the same run
- Report PR flow is disabled by design.
- Apply PR flow rules:
  - commit only HelmRelease resource changes
  - apply PR commits use the explicit GitHub API identity from `GITHUB_COMMIT_AUTHOR_NAME` / `GITHUB_COMMIT_AUTHOR_EMAIL`
  - do not commit generated report/apply artifacts into repository
  - include decision rationale, constraints, and skipped reasons in PR description
  - apply planner uses live pod request footprint + current pod placement for node-fit simulation and blocks only on allocatable node capacity; advisory CPU/memory request ceilings remain informational and influence ordering only
  - `controlpanel.khzaw.dev` now renders the combined tuning view for operators, using `resource-advisor` JSON from the
    separate exporter backend
  - the operator UI separates:
    - live preflight = current report + live cluster footprint
    - last real apply run = persisted apply artifact from the weekly CronJob
  - the exporter also publishes next-up candidates, selected/skipped reason counts, and the next scheduled apply time
  - the public `tuning.khzaw.dev` hostname has been removed; use cockpit proxies for raw report endpoints when needed
  - default auto-apply allowlist is derived from `APP_TEMPLATE_RELEASE_FILE_MAP` in
    `infrastructure/resource-advisor/advisor.py`; only override with `APPLY_ALLOWLIST` when intentionally narrowing or
    widening the default scope
  - current auto-apply scope includes:
    - `adguard`, `adguard-secondary`, `anki-server`, `audiobookshelf`, `autobrr`, `bazarr`, `booklore`, `booklore-mariadb`,
      `calibre`, `calibre-web-automated`, `chartsdb`, `ersatztv`, `exposure-control`, `flaresolverr`, `glance`,
      `isponsorblock-tv`, `profilarr`, `shelfmark`, `tracerr`, `jellyfin`, `jellyseerr`, `nodecast-tv`,
      `obsidian-livesync`, `prowlarr`, `jackett`, `radarr`, `reactive-resume`, `sabnzbd`, `sonarr`, `speedtest`, `transmission`, `tunarr`,
      `uptime-kuma`, `vaultwarden`
  - excluded from auto-apply by policy (analyzed only): `actualbudget`, `immich`, `immich-postgres`, `media-postgres`,
    `vaultwarden-postgres`, `blog`, `mmcal`
  - do not chase raw averages; deadband is enforced by default:
    - `DEADBAND_PERCENT=10`
    - `DEADBAND_CPU_M=25`
    - `DEADBAND_MEM_MI=64`
- Required secret for apply PR creation:
  - `monitoring/resource-advisor-github` with key `token`
  - token scopes: repo contents write + pull requests write
- Troubleshooting sequence:
  - `flux get kustomizations`
  - `kubectl get cronjobs -n monitoring | rg resource-advisor`
  - `kubectl auth can-i get cronjobs.batch -n monitoring --as=system:serviceaccount:monitoring:resource-advisor`
  - `kubectl get jobs -n monitoring | rg resource-advisor`
  - `kubectl logs -n monitoring job/<job-name>`
  - `kubectl get configmap resource-advisor-latest -n monitoring -o yaml`
  - Note: `resource-advisor-latest` is runtime-owned state and should not be reconciled by Flux. The CronJobs
    create/update it directly.

## Validation and Operations Commands
```bash
# Validate manifest structure
kubectl apply --dry-run=client -f <file>

# Flux health and rollout status
flux get kustomizations
flux get hr -A
flux reconcile kustomization <name> --with-source

# Troubleshooting
kubectl get pods -A
kubectl describe hr -n <ns> <name>
kubectl get events -n <ns> --sort-by=.lastTimestamp
kubectl top nodes
kubectl top pods -A

# Talos node checks
talosctl -n 10.0.0.197 dashboard

# Sunset storage cleanup (dry-run)
scripts/storage-sunset-cleanup.sh
```

## Commit Message Convention
Use:
- `<service>: <message>`

Examples:
- `tailscale-operator: bump chart to latest stable`
- `monitoring: fix nodeExporter disable key`
- `homepage: reorganize groups and widgets`

## Useful Reference Docs
- `docs/README.md`
- `docs/shared-cluster-settings.md`
- `docs/resource-advisor-phase1-phase2.md`
- `docs/networking-current-state-and-simplification.md`
- `docs/pangolin-fit-analysis.md`
- `docs/networking-simplified-migration-todo.md`
- `docs/lan-access-current-state-and-lean-plan.md`
- `docs/secrets-management-current-state-options-and-plan.md`
- `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`
- `docs/arm64-node-canal-flexvol-exec-format-error.md`
- `docs/router-dns-rebind-private-a-records.md`
- `docs/adguard-dns-stack-overview.md`
- `docs/dns-reliability-flux-gitrepository-timeouts.md`
- `docs/vaultwarden-db-timeouts-and-postgres-reset.md`
- `docs/homelab-operations-dashboards.md`
- `docs/gitops-change-timeline-dashboard.md`
- `docs/dns-access-path-dashboard.md`
- `docs/uptime-kuma-sqlite-on-nfs-timeouts.md`
- `docs/prometheus-tsdb-local-path-migration.md`
- `docs/kube-state-metrics-oomkills.md`
- `docs/dashboards-homepage-glance.md`
- `docs/metrics-server-operational-metrics.md`
- `docs/study-services-livesync-anki-booklore.md`
- `docs/shelfmark.md`
- `docs/tv-channels-tunarr-ersatztv.md`
- `docs/tracerr.md`
- `docs/isponsorblocktv.md`
- `docs/media-postgres.md`
- `docs/calibre-storage-migration-to-truenas-nfs.md`
- `docs/storage-sunset-cleanup.md`
- `docs/backup-plan.md`
- `docs/blog-static-site-gitops-deployment-plan.md`
- `docs/public-exposure-control-panel-plan.md`
- `docs/travel-center.md`
- `docs/public-edge-phase1-bootstrap.md`
- `docs/ops-command-cheatsheet.md`
- `docs/power-estimation-dashboard.md`
- `docs/node-capacity-dashboard.md`
- `docs/exposure-control-phase2-phase3-mvp.md`
- `docs/cloudflare-access-share-hosts-email-otp-plan.md`
- `docs/transmission-optional-vpn.md`
- `docs/reactive-resume.md`
