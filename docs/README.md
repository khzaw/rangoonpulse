# Docs Index - rangoonpulse

Use this file as the docs entrypoint for new agent sessions and for any task that changes cluster behavior. Read it after `AGENTS.md` and the root `README.md`, then open the focused docs for the area you are touching.

## Required Session-Start Reading

On every new session in `/Users/khz/Code/rangoonpulse`, read:

1. [`AGENTS.md`](../AGENTS.md)
2. [`README.md`](../README.md)
3. [`docs/README.md`](./README.md)

Then pick the smallest focused set of docs below before planning or editing.

## Knowledge Base

- [`docs/architecture.md`](./architecture.md) for the top-level repo and knowledge map
- [`docs/knowledge-base-conventions.md`](./knowledge-base-conventions.md) for doc-vs-skill boundaries, front matter conventions, and local checks

## Project-Local Skills

Use the smallest matching repo-local skill when the task clearly fits:

- `rangoonpulse-service-deploy` for adding, exposing, renaming, or materially changing a service
- `rangoonpulse-upgrade` for image or chart bumps
- `rangoonpulse-cluster-conventions` for shared cluster settings, placement, storage, ingress/TLS, secrets, and default manifest conventions
- `rangoonpulse-access-and-edge` for Tailscale, public-edge, share hosts, exposure-control, Transmission VPN routing, and access-path exceptions
- `rangoonpulse-adguard-dns` for dual AdGuard and LAN DNS changes
- `rangoonpulse-resource-advisor` for tuning automation and service auto-tuning integration

## Task Routing

### Repository-wide configuration

- [`docs/architecture.md`](./architecture.md) for a top-level map of domains and cross-cutting touch points.
- [`docs/knowledge-base-conventions.md`](./knowledge-base-conventions.md) for the repository knowledge structure and maintenance rules.
- [`docs/shared-cluster-settings.md`](./shared-cluster-settings.md) when touching base domain, timezone, node names, node IPs,
  ingress VIPs, LAN-service IPs, or Flux post-build substitutions.
- [`docs/dependency-updates-renovate-and-flux-image-automation.md`](./dependency-updates-renovate-and-flux-image-automation.md)
  for service update PR automation and the static-site image automation split.

### Networking, ingress, DNS, and access

- [`docs/networking-current-state-and-simplification.md`](./networking-current-state-and-simplification.md) for the current cluster access model.
- [`docs/lan-access-current-state-and-lean-plan.md`](./lan-access-current-state-and-lean-plan.md) for LAN and Tailscale ingress access.
- [`docs/iris-dedicated-vip.md`](./iris-dedicated-vip.md) for the dedicated `iris.khzaw.dev` SSH+HTTPS exception.
- [`docs/adguard-dns-stack-overview.md`](./adguard-dns-stack-overview.md) for LAN DNS architecture and router integration.
- [`docs/dns-reliability-flux-gitrepository-timeouts.md`](./dns-reliability-flux-gitrepository-timeouts.md) for CoreDNS, Flux, and Talos node DNS hardening.
- [`docs/public-edge-phase1-bootstrap.md`](./public-edge-phase1-bootstrap.md) and [`docs/public-exposure-control-panel-plan.md`](./public-exposure-control-panel-plan.md) for Cloudflare Tunnel and share-host exposure.
- [`docs/exposure-control-phase2-phase3-mvp.md`](./exposure-control-phase2-phase3-mvp.md) for the implemented exposure-control backend/UI behavior and security hardening path.
- [`docs/cloudflare-access-share-hosts-email-otp-plan.md`](./cloudflare-access-share-hosts-email-otp-plan.md) when public share-host auth changes.
- [`docs/travel-center.md`](./travel-center.md) when changing the control panel's travel readiness and remote-life workflow.
- [`docs/router-dns-rebind-private-a-records.md`](./router-dns-rebind-private-a-records.md) when private `A` records or router DNS behavior are involved.
- [`docs/transmission-optional-vpn.md`](./transmission-optional-vpn.md) when touching Transmission routing or Gluetun control.

### Cluster incidents and recovery

- [`docs/arm64-node-canal-flexvol-exec-format-error.md`](./arm64-node-canal-flexvol-exec-format-error.md) for the historical ARM64 Canal crashloop incident and recovery steps.

### Storage, stateful services, and recovery

- [`docs/media-postgres.md`](./media-postgres.md) for shared TimescaleDB placement and constraints.
- [`docs/calibre-storage-migration-to-truenas-nfs.md`](./calibre-storage-migration-to-truenas-nfs.md) for ebook storage patterns.
- [`docs/uptime-kuma-sqlite-on-nfs-timeouts.md`](./uptime-kuma-sqlite-on-nfs-timeouts.md) for the node-local Uptime Kuma decision.
- [`docs/vaultwarden-db-timeouts-and-postgres-reset.md`](./vaultwarden-db-timeouts-and-postgres-reset.md) for Vaultwarden state and recovery gotchas.
- [`docs/prometheus-tsdb-local-path-migration.md`](./prometheus-tsdb-local-path-migration.md) for Prometheus persistence expectations.
- [`docs/storage-sunset-cleanup.md`](./storage-sunset-cleanup.md) for retired storage paths and cleanup.
- [`docs/backup-plan.md`](./backup-plan.md) for backup scope and recovery priorities.
- [`docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`](./truenas-tailscale-accept-routes-caused-democratic-csi-outage.md) when NFS or democratic-csi behaves unexpectedly.

### Monitoring, dashboards, and resource tuning

- [`docs/resource-advisor-phase1-phase2.md`](./resource-advisor-phase1-phase2.md) for the tuning workflow and apply-PR model.
- [`docs/homelab-operations-dashboards.md`](./homelab-operations-dashboards.md) for the Grafana operations dashboards.
- [`docs/dashboards-homepage-glance.md`](./dashboards-homepage-glance.md) for the Glance dashboard, monitors, and widget-specific gotchas.
- [`docs/gitops-change-timeline-dashboard.md`](./gitops-change-timeline-dashboard.md) for rollout/change timeline interpretation.
- [`docs/dns-access-path-dashboard.md`](./dns-access-path-dashboard.md) for DNS and ingress path troubleshooting.
- [`docs/node-capacity-dashboard.md`](./node-capacity-dashboard.md) for node fit and capacity views.
- [`docs/power-estimation-dashboard.md`](./power-estimation-dashboard.md) for estimated node power and cost data.
- [`docs/metrics-server-operational-metrics.md`](./metrics-server-operational-metrics.md) when working with the Metrics API or `kubectl top`.
- [`docs/kube-state-metrics-oomkills.md`](./kube-state-metrics-oomkills.md) for the known kube-state-metrics sizing issue.

### Secrets and auth

- [`docs/secrets-inventory.md`](./secrets-inventory.md) for service-to-secret mapping.
- [`docs/secrets-management-current-state-options-and-plan.md`](./secrets-management-current-state-options-and-plan.md) for the SOPS and age operating model.
- [`docs/cloudflare-access-share-hosts-email-otp-plan.md`](./cloudflare-access-share-hosts-email-otp-plan.md) for share-host auth behavior.

### Operations and commands

- [`docs/ops-command-cheatsheet.md`](./ops-command-cheatsheet.md) for day-2 command snippets and common triage flows.

### Service-specific guides

- [`docs/study-services-livesync-anki-booklore.md`](./study-services-livesync-anki-booklore.md)
- [`docs/reactive-resume.md`](./reactive-resume.md)
- [`docs/shelfmark.md`](./shelfmark.md)
- [`docs/tracerr.md`](./tracerr.md)
- [`docs/isponsorblocktv.md`](./isponsorblocktv.md)
- [`docs/tv-channels-tunarr-ersatztv.md`](./tv-channels-tunarr-ersatztv.md)
- [`docs/blog-static-site-gitops-deployment-plan.md`](./blog-static-site-gitops-deployment-plan.md)

### Historical analysis and migration context

- [`docs/pangolin-fit-analysis.md`](./pangolin-fit-analysis.md)
- [`docs/networking-simplified-migration-todo.md`](./networking-simplified-migration-todo.md)

## Minimum Reading Standard

- Single-service change: read the startup trio plus at least one focused doc for that service or domain.
- Cross-cutting change: read at least one focused doc for each affected domain.
- Incident/debugging work: start with the most relevant incident or gotcha doc before proposing fixes.
- Review work: read the focused docs that define the expected behavior before evaluating correctness.

## Maintenance Rule

- If you change a stable operating convention, update this index and the focused doc that owns that convention in the same change.
- If you discover a recurring incident pattern or operational gotcha, add a focused doc and link it here and from `AGENTS.md`.
