# Rangoonpulse Documentation

This index routes to current operating guidance. Read `AGENTS.md` and `README.md` first, then open only the docs and project-local skill that own the task.

Docs describe present desired state, active constraints, and reusable recovery procedures. Completed plans, superseded designs, and incident chronology belong in Git history.

## Repository And Configuration

- [`architecture.md`](./architecture.md): source-of-truth map and cross-cutting touch points
- [`knowledge-base-conventions.md`](./knowledge-base-conventions.md): current-only documentation policy and checks
- [`shared-cluster-settings.md`](./shared-cluster-settings.md): Flux substitutions and shared constants
- [`dependency-updates-renovate-and-flux-image-automation.md`](./dependency-updates-renovate-and-flux-image-automation.md): Renovate and image-promotion ownership
- [`service-onboarding.md`](./service-onboarding.md): required app/operator integrations and live completion evidence
- [`cpu-headroom-validation.md`](./cpu-headroom-validation.md): Git/CI and live preflight, rollout/job reserves, and runtime snapshots
- [`kubernetes-upgrade.md`](./kubernetes-upgrade.md): Talos Kubernetes upgrades, recovery data, bootstrap manifests, and verification

## Networking, DNS, And Access

- [`networking.md`](./networking.md): three access paths, DNS ownership, and topology
- [`lan-access.md`](./lan-access.md): private LAN/Tailscale path and LAN-device proxies
- [`mac-mini-edge.md`](./mac-mini-edge.md): Mac mini OpenClaw/Hermes edge and SSH VIP
- [`iris-operations.md`](./iris-operations.md): native launchd telemetry, readiness, and independent cluster sentinel
- [`adguard-dns-stack-overview.md`](./adguard-dns-stack-overview.md): dual AdGuard architecture and rollout safety
- [`dns-reliability.md`](./dns-reliability.md): cluster DNS separation and Flux timeout diagnosis
- [`public-edge-and-exposure-control.md`](./public-edge-and-exposure-control.md): permanent-public and temporary-share routing
- [`share-host-authentication.md`](./share-host-authentication.md): share-host authentication trust boundary
- [`travel-center.md`](./travel-center.md): remote-readiness probes and limitations
- [`router-dns-rebind-private-a-records.md`](./router-dns-rebind-private-a-records.md): private DNS and rebind protection
- [`transmission-optional-vpn.md`](./transmission-optional-vpn.md): direct/VPN runtime routing contract

## Storage, Stateful Services, And Recovery

- [`talos-kubelet-image-garbage-collection.md`](./talos-kubelet-image-garbage-collection.md): current CRI image-retention policy and `/var` accounting
- [`talos-userspace-oom-control-plane-cgroups.md`](./talos-userspace-oom-control-plane-cgroups.md): Talos userspace OOM and API recovery
- [`media-postgres.md`](./media-postgres.md): shared TimescaleDB consumers and local-storage tradeoff
- [`book-library-storage.md`](./book-library-storage.md): shared ebook/audiobook claims, app-state separation, and data-preserving changes
- [`uptime-kuma.md`](./uptime-kuma.md): Uptime Kuma local SQLite and recovery
- [`interview-prep.md`](./interview-prep.md): ITVP persistence and image promotion
- [`retirement.md`](./retirement.md): Retirement SQLite and Litestream protection
- [`seventyfivesoft.md`](./seventyfivesoft.md): 75 Soft SQLite and Litestream protection
- [`vaultwarden.md`](./vaultwarden.md): Vaultwarden app/PostgreSQL storage and recovery
- [`prometheus-storage.md`](./prometheus-storage.md): Prometheus TSDB storage and recovery
- [`storage-cleanup.md`](./storage-cleanup.md): destructive storage cleanup safety
- [`data-protection.md`](./data-protection.md): repository-defined data-protection coverage and gaps
- [`truenas-networking-and-csi.md`](./truenas-networking-and-csi.md): TrueNAS routing and CSI recovery

## Monitoring And Operations Surfaces

- [`resource-advisor.md`](./resource-advisor.md): current Resource Advisor contract
- [`controlpanel-pulse.md`](./controlpanel-pulse.md): cockpit node, power, PVC, and pod-placement telemetry
- [`flux-reconciliation-alerts.md`](./flux-reconciliation-alerts.md): Flux readiness alerts and source, image-publication, rollback, and capacity triage
- [`homelab-operations-dashboards.md`](./homelab-operations-dashboards.md): Grafana operations dashboard inventory
- [`dashboards-dynacat.md`](./dashboards-dynacat.md): Dynacat configuration and widget constraints
- [`gitops-change-timeline-dashboard.md`](./gitops-change-timeline-dashboard.md): Flux change timeline
- [`dns-access-path-dashboard.md`](./dns-access-path-dashboard.md): DNS and ingress observability
- [`node-capacity-dashboard.md`](./node-capacity-dashboard.md): node fit and capacity
- [`power-estimation-dashboard.md`](./power-estimation-dashboard.md): estimated power and tariff inputs
- [`metrics-server-operational-metrics.md`](./metrics-server-operational-metrics.md): live Kubernetes Metrics API
- [`flux-web-ui.md`](./flux-web-ui.md): Flux Operator UI and controller-manifest caveat
- [`cronjob-deadman-alerts.md`](./cronjob-deadman-alerts.md): scheduled-job staleness and failure alerts

## Secrets

- [`secrets-inventory.md`](./secrets-inventory.md): SOPS-managed Secret names and consumers
- [`secrets-management.md`](./secrets-management.md): SOPS, Flux, control-panel editing, and key lifecycle
- [`github-credentials.md`](./github-credentials.md): credential locations, operation-specific permissions, reuse, and rotation
- [`grafana-admin-credentials.md`](./grafana-admin-credentials.md): encrypted bootstrap and persisted admin-password rotation

## Service Contracts

- [`study-services-livesync-anki-bookorbit.md`](./study-services-livesync-anki-bookorbit.md): Obsidian LiveSync, Anki, BookOrbit, and shared book storage
- [`reactive-resume.md`](./reactive-resume.md): Reactive Resume and printer sidecar
- [`bentopdf.md`](./bentopdf.md): private browser PDF tools, HPA, and operator integrations
- [`romm.md`](./romm.md): ROM library, shared PostgreSQL provisioning, and expandable NAS storage
- [`shelfmark.md`](./shelfmark.md): Shelfmark storage and share wiring
- [`subarr.md`](./subarr.md): Subarr SQLite/media state and incomplete share wiring
- [`tracerr.md`](./tracerr.md): Tracerr/Tracearr naming, database, Redis, and secrets
- [`isponsorblocktv.md`](./isponsorblocktv.md): headless device setup and networking
- [`live-tv-services.md`](./live-tv-services.md): active live-TV services and dormant ErsatzTV source
- [`static-site-deployment.md`](./static-site-deployment.md): self-built static-site promotion and public-edge ownership

## Commands

- [`ops-command-cheatsheet.md`](./ops-command-cheatsheet.md): durable day-two commands

## Project-Local Skills

Use the smallest matching skill under `.agents/skills/`:

- `rangoonpulse-shared-worktree`
- `rangoonpulse-service-deploy`
- `rangoonpulse-upgrade`
- `rangoonpulse-cluster-conventions`
- `rangoonpulse-access-and-edge`
- `rangoonpulse-adguard-dns`
- `rangoonpulse-resource-advisor`

## Maintenance Rule

When implementation changes, update or delete the owning docs in the same change. Do not add a historical record. Preserve only the minimum rationale required to explain a current constraint, and use Git history for everything else.
