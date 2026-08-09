---
title: 75 Soft
summary: Private 75 Soft wellness journal deployment, SQLite persistence, backup, and tailnet access boundary.
---

# 75 Soft

75 Soft is a private, offline-first wellness journal at `https://seventyfivesoft.ericaknight.me`.

## Access boundary

- The hostname follows the normal private ingress path and resolves to the shared ingress VIP for LAN and Tailscale clients.
- It has no Cloudflare Tunnel route, public-edge alias, or Exposure Control share entry.
- Remote access requires the tailnet subnet route to `10.0.0.231`.
- The application has no account or authentication layer. Do not add an unauthenticated public route.

## Runtime

- Source: `github.com/seinhtettan/seventyfivesoft`
- Image: public `ghcr.io/seinhtettan/seventyfivesoft`
- Workload: one Node 22 `app-template` replica pinned to `${PRIMARY_NODE_NAME}`
- Port and health: `8080` / `/healthz`
- GitOps: `apps/seventyfivesoft/` and `flux/kustomizations/seventyfivesoft.yaml`
- Image pin: immutable `sha-<commit>` tag, updated manually after the upstream image workflow succeeds

The Node process serves the React PWA, synchronization API, and static assets. Browsers keep an IndexedDB working copy and synchronize records through `/api/sync` to the shared SQLite database.

## Persistence and backups

- Live database: `/data/seventyfivesoft.sqlite` on a `1Gi` `local-path` PVC.
- SQLite mode: WAL, with one application replica and a `Recreate` rollout strategy.
- Backup replica: Litestream `0.5.16` writes to `/backup/seventyfivesoft` on a separate `1Gi` `truenas-nfs` PVC.
- Recovery point: changed pages are normally replicated within five seconds.
- History: daily snapshots with 90-day retention and six-hour replica validation.
- Startup recovery: an init container restores the latest backup, with a quick integrity check, only when the live database does not exist.
- Shutdown: Litestream receives up to 30 seconds for its final sync.
- Monitoring: Prometheus scrapes Litestream and alerts on sync failures, compaction-integrity failures, or missing backup metrics.

The local PVC keeps SQLite locking and WAL I/O off NFS. The NAS replica protects against loss of the Kubernetes node disk, but it is not an offsite backup. The application's Settings export remains a useful portable backup.

Do not copy only the main SQLite file while the app is running. Use Litestream or stop the workload first so WAL-backed changes are included.

## Updating the image

The upstream workflow publishes `latest` and immutable `sha-<commit>` tags. Because Git SHAs are not sortable by release time, this deployment does not use the timestamp-based Flux image policy used by Kaung's self-built apps.

After a successful upstream image workflow:

1. Verify the `sha-<commit>` image exists for both amd64 and arm64.
2. Update `values.controllers.main.containers.main.image.tag` in `apps/seventyfivesoft/helmrelease.yaml`.
3. Validate, commit, push, and reconcile the `seventyfivesoft` Kustomization.
4. Verify the exact image tag, `/healthz`, Litestream metrics, and the private hostname.