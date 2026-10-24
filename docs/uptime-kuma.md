---
title: Uptime Kuma Storage and Recovery
summary: Current utility-node deployment, local SQLite storage constraint, and WAL-safe recovery procedure.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Uptime Kuma Storage and Recovery

## Current State

- source: `apps/uptime-kuma/`
- node: `${UTILITY_NODE_NAME}`
- data PVC: `uptime-kuma-data-local`
- storage class: `local-path`
- database: SQLite

SQLite is intentionally node-local. Uptime Kuma's write and WAL behavior is not suitable for the latency and locking characteristics of the NAS-backed NFS path used elsewhere.

The tradeoff is explicit: routine database operations stay responsive, but the workload is node-affined and the repository defines no automated backup for this PVC.

## Recovery

Do not move the node selector or replace the PVC as a normal rollout.

For a manual backup or migration:

1. stop Uptime Kuma so SQLite has no writer
2. preserve `kuma.db` and any `kuma.db-wal`/`kuma.db-shm` companions
3. restore into disposable storage
4. run SQLite integrity checks
5. start one Uptime Kuma writer and verify monitors, history, and notifications

Copying only `kuma.db` while the application is running can omit committed WAL data.

## Verification

```bash
flux get kustomization uptime-kuma -n flux-system
kubectl get pod,pvc -n default | grep uptime-kuma
kubectl get pod -n default -l app.kubernetes.io/name=uptime-kuma -o wide
kubectl logs -n default deploy/uptime-kuma --since=30m
curl -Ik https://uptime.khzaw.dev/
```
