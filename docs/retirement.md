---
title: Retirement
summary: Private retirement-planning dashboard deployment, image promotion, and access boundary.
---

# Retirement

Longview is a private retirement calculator and portfolio-projection web app at `https://retirement.khzaw.dev`.

## Access boundary

- `retirement.khzaw.dev` follows the normal private ingress path and resolves to the shared ingress VIP for LAN and Tailscale clients.
- It has no Cloudflare Tunnel route, public-edge alias, or Exposure Control share entry.
- Remote access therefore requires the tailnet subnet route to `10.0.0.231`.

## Runtime

- Source and image: private `github.com/khzaw/retirement` / `ghcr.io/khzaw/retirement`
- Workload: one Node-based `app-template` replica pinned to `${PRIMARY_NODE_NAME}`
- Port and health: `8080` / `/health`
- GitOps: `apps/retirement/` and `flux/kustomizations/retirement.yaml`
- Image promotion: private timestamped commit tags selected by `ImagePolicy/retirement`

The container serves the client-side application plus a small Effect-based API. The
API owns the SQLite connection, workspace migrations, optimistic revision checks,
portable JSON exports, and the same-origin `/api/yahoo-finance/` quote proxy. Browsers
never access the database or Yahoo Finance directly.

## Persistence and backups

- Live database: `/data/longview.sqlite` on a `1Gi` `local-path` PVC.
- SQLite mode: WAL, with one application replica and a `Recreate` rollout strategy.
- Backup replica: Litestream `0.5.13` writes LTX snapshots and changes to
  `/backup/longview` on a separate `1Gi` `truenas-nfs` PVC.
- Recovery point: changed pages are normally replicated within five seconds.
- History: daily snapshots with 90-day retention and six-hour replica validation.
- Startup recovery: an init container restores the latest backup, with a quick
  integrity check, only when the live database does not exist.
- Shutdown: Litestream receives up to 30 seconds for its final sync.
- Monitoring: Prometheus scrapes Litestream and alerts on sync failures,
  compaction-integrity failures, or missing backup metrics.

The local PVC keeps SQLite locking and WAL I/O off NFS. The NAS replica protects
against loss of the Kubernetes node disk. It is not an offsite backup; encrypted
offsite replication remains a separate homelab backup-plan item.

### Manual restore or point-in-time recovery

1. Scale the Retirement workload to zero so nothing can write to SQLite.
2. Preserve the current `/data` contents before replacing them.
3. Start a temporary Litestream `0.5.13` pod with both Retirement claims and the
   Litestream ConfigMap mounted.
4. Restore to a new file first:

   ```bash
   litestream restore \
     -integrity-check full \
     -o /data/longview-restored.sqlite \
     file:///backup/longview
   ```

   Add `-timestamp <RFC3339 timestamp>` for point-in-time recovery.
5. Inspect the restored database, replace `longview.sqlite` only after verification,
   remove stale `-wal` and `-shm` files, then scale the workload back to one.

Do not copy only `longview.sqlite` while the app is running. Use Litestream or the
portable `/api/export` download so WAL-backed changes are included consistently.

## Deploy latest image now

Use the Retirement card at `https://controlpanel.khzaw.dev/#deploy`, or run:

```bash
make deploy-retirement
```

The target reconciles the private image repository, policy, per-site image writer, Git source, and Retirement app Kustomization.
