# Vaultwarden DB Timeouts: Reset and Dedicated Postgres

## Incident Signature

Vaultwarden became intermittently unresponsive with repeated DB pool errors:

- `Timeout waiting for database connection`
- auth guard failures (`Error getting DB`)
- API endpoints returning `401` / `503` during spikes

Observed in app logs from `default/vaultwarden`.

## Root Cause

Vaultwarden was using the default SQLite backend on `/data`, and `/data` was backed by NFS (`truenas-nfs`).
SQLite over network filesystems can produce lock latency/contention behavior under concurrent access, which surfaces as connection pool timeouts at the app layer.

## Reset + Rebuild Decision

Because this deployment was brand new (no data worth preserving), we performed a full reset and switched to:

- Vaultwarden app data on local storage (`local-path` PVC)
- Dedicated Postgres service (`vaultwarden-postgres`) on local storage (`local-path` PVC)

This removes SQLite/NFS locking behavior from the critical path.

## GitOps Implementation

### New components

- `apps/vaultwarden-postgres/helmrelease.yaml`
- `apps/vaultwarden-postgres/kustomization.yaml`
- `flux/kustomizations/vaultwarden-postgres.yaml`
- `infrastructure/secrets/default/vaultwarden-db-secret.yaml` (SOPS encrypted)

### Vaultwarden changes

- `apps/vaultwarden/helmrelease.yaml`
  - uses `DATABASE_URL` from `vaultwarden-db-secret`
  - tuned DB env:
    - `DATABASE_MAX_CONNS=20`
    - `DATABASE_TIMEOUT=30`
  - moved `/data` to `existingClaim: vaultwarden-data-local`

- `apps/vaultwarden/pvc.yaml`
  - creates `vaultwarden-data-local` (`local-path`, 2Gi)

- `apps/vaultwarden/kustomization.yaml`
  - includes `pvc.yaml`

### Flux dependency order

- `flux/kustomizations/vaultwarden-postgres.yaml`
  - depends on `local-path-provisioner`

- `flux/kustomizations/vaultwarden.yaml`
  - depends on:
    - `local-path-provisioner`
    - `vaultwarden-postgres`
    - `ingress-nginx`

- `flux/kustomization.yaml`
  - includes `vaultwarden-postgres` before `vaultwarden`

## Cleanup of Old State

After the new stack is healthy, remove old SQLite-on-NFS PVC:

```bash
kubectl delete pvc -n default vaultwarden
```

If the provisioner reclaim policy is `Delete`, backing storage artifacts are removed by the CSI workflow.

## Validation Commands

```bash
flux get kustomizations | rg 'vaultwarden|vaultwarden-postgres|secrets'
flux get hr -n default | rg 'vaultwarden|vaultwarden-postgres'
kubectl get pods -n default | rg 'vaultwarden'
```

Endpoint checks:

```bash
curl -k -I https://passwords.khzaw.dev
```

## HA Notes (Reasonable Scope)

For this homelab, current resilient baseline is:

- single Vaultwarden pod + single dedicated Postgres pod
- both on local storage (stable latency)
- bounded but higher resources than previous config

Running 2 Vaultwarden pods requires strict shared state assumptions and careful DB/session behavior; this was intentionally skipped in favor of DB stability first.
