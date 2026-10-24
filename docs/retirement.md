---
title: Retirement
summary: Current private access, image promotion, local SQLite, Litestream NAS replica, and restore contract.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Retirement

Longview is the private retirement calculator at `retirement.khzaw.dev`.

## Access

The hostname uses the private ingress path for LAN and Tailscale clients. Retirement has no public-edge route or exposure-control entry.

## Runtime

- source/image: private `khzaw/retirement` and `ghcr.io/khzaw/retirement`
- GitOps: `apps/retirement/` and `flux/kustomizations/retirement.yaml`
- placement: primary node
- port/health: `8080` and `/health`
- promotion: private immutable tags through Flux image automation

## Persistence And Protection

- live database: `/data/longview.sqlite` on 1Gi `local-path`
- SQLite mode: WAL
- rollout: one replica with `Recreate`
- replica: Litestream (version pinned in the HelmRelease) to `/backup/longview` on a separate 1Gi `truenas-nfs` PVC
- sync interval: five seconds
- snapshots: daily with 90-day retention
- startup: restore latest replica with quick integrity check only when the live database is absent
- monitoring: sync, compaction-integrity, and missing-metrics alerts

The local database avoids NFS locking/WAL problems. The NAS replica protects against primary-node disk loss, but it is not offsite backup.

## Restore

1. stop the workload
2. preserve current `/data`
3. run Litestream (version pinned in the HelmRelease) with the data, backup, and config mounts
4. restore to a new file with full integrity checking
5. inspect the database before replacing `longview.sqlite`
6. remove stale WAL/SHM companions only after a verified restore
7. start one writer and verify the application

```bash
litestream restore -integrity-check full \
  -o /data/longview-restored.sqlite \
  file:///backup/longview
```

Add `-timestamp <RFC3339>` for point-in-time recovery.

## Promotion And Verification

```bash
make deploy-retirement
flux get kustomization retirement -n flux-system
kubectl get pod,pvc -n default | grep retirement
curl -I https://retirement.khzaw.dev/health
```
