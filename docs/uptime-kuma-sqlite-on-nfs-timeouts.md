# Uptime Kuma SQLite on NFS: Slow Login and DB Pool Timeouts

## Incident Signature

Uptime Kuma became slow enough that login requests could time out, while monitors
also started failing in bursts.

Observed symptoms from `default/uptime-kuma`:

- UI login stalls or times out
- repeated `Knex: Timeout acquiring a connection`
- many monitor checks reaching the 48s timeout together

## Root Cause

Uptime Kuma stores its default database as SQLite under `/app/data`.
When `/app/data` was backed by `truenas-nfs`, SQLite WAL and lock activity sat on
an NFS mount from TrueNAS (`10.0.0.210`).

That caused database connection acquisition timeouts under routine monitor load.

## Current Decision

Keep Uptime Kuma on the Raspberry Pi node (`talos-uua-g6r`) but move persistence
to node-local storage:

- PVC: `default/uptime-kuma-data-local`
- StorageClass: `local-path`
- mount path: `/app/data`

This keeps the app lightweight while removing SQLite/NFS latency from the
critical path.

## GitOps Files

- `apps/uptime-kuma/pvc.yaml`
- `apps/uptime-kuma/helmrelease.yaml`
- `apps/uptime-kuma/kustomization.yaml`
- `flux/kustomizations/uptime-kuma.yaml`

## Migration Notes

Because the old PVC is NFS-backed and the new PVC is `local-path`, migrate with
Uptime Kuma stopped so `kuma.db`, `kuma.db-wal`, and `kuma.db-shm` stay
consistent.

Do not reconcile the HelmRelease change before copying data from the old claim
(`default/uptime-kuma`) into the new local claim (`default/uptime-kuma-data-local`),
or Uptime Kuma will boot against an empty SQLite database.

Recommended order:

1. Create and populate `uptime-kuma-data-local` on `talos-uua-g6r`.
2. Stop Uptime Kuma.
3. Perform a final copy of the SQLite files.
4. Reconcile the GitOps change so the app starts on the local PVC.

After the local copy is verified and the app is healthy, the old NFS PVC can be
removed manually if desired:

```bash
kubectl delete pvc -n default uptime-kuma
```
