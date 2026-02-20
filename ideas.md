# Homelab Ideas Backlog

This file tracks ideas explicitly rated `good` or better.

## Selected Ideas

1. `really good` - Public Exposure Control Plane (Blog + Temporary Shares)
- Add a dynamic control panel at `controlpanel.khzaw.dev` to toggle temporary public exposure for approved services with optional expiry.
- Keep `blog.khzaw.dev` permanently public behind Cloudflare edge cache/WAF (HN-spike resilient), while all other services remain private-by-default.
- Implement via Cloudflare Tunnel + `PublicExposure` control object + controller/API/UI flow, with audit logs and safe defaults (`expiresAt`, Access auth, allowlist).
- Use dedicated temporary share hostnames (for example `share-<app>.khzaw.dev`) to avoid DNS contention with existing private canonical hostnames.

2. `really good` - Capacity-Aware Resource Advisor v2
- Extend resource advisor with node-fit simulation, headroom checks, and tradeoff recommendations (downsize some workloads to safely upsize others).

3. `good` - Self-Service Ops Portal (Lean)
- Internal ops portal for safe actions (restart app, Flux reconcile, quick diagnostics) with audit trail and scoped RBAC.

4. `good` - Media-Aware Dynamic Throttling
- Detect active Jellyfin load/transcoding and temporarily throttle non-critical workloads, then restore automatically.

5. `good` - Lean Ops Command Center v2
- Runbook-driven operational UI on top of self-service actions, with guided diagnostics and incident context.

6. `okay` - GitOps App Bootstrapper
- CLI/script scaffolding for new apps (`apps/<name>`, Flux kustomization, ingress/TLS/external-dns, baseline resources, and PVC policy).

7. `really good` - Backup Implementation (CronJobs + TrueNAS Snapshots + Offsite)
- Implement backup plan from `docs/backup-plan.md`. Priority: Vaultwarden `pg_dump` CronJob writing to TrueNAS NFS backup dataset, then Immich Postgres dump.
- Enable TrueNAS snapshot schedules on NFS-backed datasets (zero cluster overhead).
- For offsite: `restic` to Backblaze B2, nightly CronJob pushing Tier 1 dumps.
- Critical gap: `local-path` databases (Vaultwarden Postgres, Immich Postgres, Grafana, Obsidian LiveSync) have no redundancy today. NVMe failure = total loss.

8. `good` - Prometheus Persistent Storage
- Replace `storageSpec.emptyDir` with a PVC (`truenas-nfs` or `local-path`, ~10Gi).
- Current `emptyDir` means pod restart wipes 14 days of metrics, breaking resource advisor data maturity gates.

9. `good` - Database Consolidation (BookLore MariaDB)
- Evaluate whether BookLore supports Postgres. If so, migrate from dedicated `booklore-mariadb` to `media-postgres` (shared TimescaleDB).
- Saves ~200-300MB RAM from eliminating a standalone MariaDB instance.

10. `good` - ARM Node Utilization (Move Lightweight Apps to Pi)
- Audit which primary-node apps publish multi-arch images and move eligible lightweight services to `talos-uua-g6r`.
- Candidates: Bazarr, Prowlarr, Autobrr, SABnzbd/Transmission (network-bound, not CPU-bound).
- Goal: free 500MB-1GB RAM on primary node for Jellyfin transcoding headroom.

11. `good` - Alerting Gaps (PrometheusRules)
- Add PrometheusRules for: PVC usage near capacity (especially 2Gi Vaultwarden local-path), node CPU/memory pressure, pod restart loops (OOMKill/CrashLoopBackOff), cert-manager certificate expiry, NFS mount failures (democratic-csi health).

12. `good` - Alert Notification Channel
- Deploy a lightweight push notification receiver (ntfy or Gotify) and configure Alertmanager webhook receiver.
- Current PrometheusRules fire but have no delivery channel — alerts are effectively write-only.

## Deferred / Not Included

- Items marked as not needed or not for now are intentionally excluded from this list.
