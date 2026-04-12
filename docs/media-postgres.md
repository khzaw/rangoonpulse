# media-postgres (Shared TimescaleDB)

## Purpose
`media-postgres` is a shared in-cluster Postgres 16 + TimescaleDB instance used by:
- Tracerr (`tracearr` DB)
- Reactive Resume (`reactive_resume` DB)
- Speedtest Tracker (`speedtest_tracker` DB)

Immich uses its own Postgres and is intentionally not consolidated here.

## Deployment
- GitOps: `apps/media-postgres/`
- HelmRelease: `apps/media-postgres/helmrelease.yaml`

## Runtime tuning
- `timescaledb.telemetry_level=off`
- `max_locks_per_transaction=2048`
- resources: `requests.memory=2Gi`, `limits.memory=4Gi`

The higher lock budget is intentional. `tracearr.library_snapshots` is a Timescale hypertable with thousands of chunks, and overview/retention queries can exhaust the default lock table and fail with `out of shared memory` unless Postgres is sized for that fan-out.

The higher memory ceiling is also intentional. Large Tracearr backfills and continuous aggregate refreshes can spike memory usage high enough to OOM a 2Gi Timescale pod.

## Storage
Data is stored on `local-path` (node-local).

Rationale:
- Postgres durability/fsync semantics and latency are typically more reliable on local disks than NFS.
- TimescaleDB write patterns (hypertables, background jobs, WAL churn) are especially sensitive to storage latency.

## Secrets (Not In Git)
Required Secret:
- `default/media-postgres-secret` with key `POSTGRES_PASSWORD` (superuser password)

This release also reads per-app DB passwords from existing Secrets:
- `default/tracerr-db-secret` (`POSTGRES_PASSWORD`)
- `default/reactive-resume-db-secret` (`POSTGRES_PASSWORD`)
- `default/speedtest-tracker-secret` (`POSTGRES_PASSWORD`)

The init script creates roles/DBs on first boot only.
