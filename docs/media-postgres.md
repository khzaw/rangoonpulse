# media-postgres (Shared TimescaleDB)

## Purpose
`media-postgres` is a shared in-cluster Postgres 16 + TimescaleDB instance used by:
- Tracerr (`tracearr` DB)
- Jellystat (`jellystat` DB)

Immich uses its own Postgres and is intentionally not consolidated here.

## Deployment
- GitOps: `apps/media-postgres/`
- HelmRelease: `apps/media-postgres/helmrelease.yaml`

## Storage
Data is stored on `local-path` (node-local).

Rationale:
- Postgres durability/fsync semantics and latency are typically more reliable on local disks than NFS.
- TimescaleDB write patterns (hypertables, background jobs, WAL churn) are especially sensitive to storage latency.

## Secrets (Not In Git)
Required Secret:
- `default/media-postgres-secret` with key `POSTGRES_PASSWORD` (superuser password)

This release also reads per-app DB passwords from existing Secrets:
- `default/jellystat-db-secret` (`POSTGRES_PASSWORD`)
- `default/tracerr-db-secret` (`POSTGRES_PASSWORD`)

The init script creates roles/DBs on first boot only.

