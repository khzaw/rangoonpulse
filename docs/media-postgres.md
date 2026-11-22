---
title: Media PostgreSQL
summary: Current shared TimescaleDB consumers, local storage, tuning rationale, secrets, and backup gap.
status: active
owner: homelab
last_reviewed: 2026-11-22
---

# Media PostgreSQL

`media-postgres` is a shared PostgreSQL 16 plus TimescaleDB service for:

- Tracerr: `tracearr`
- Reactive Resume: `reactive_resume`
- Speedtest Tracker: `speedtest_tracker`
- BookOrbit: `bookorbit`
- RomM: `romm`, provisioned by its own pre-install/pre-upgrade hook; see [RomM](./romm.md)
- Miniflux: `miniflux`, provisioned by its own pre-install/pre-upgrade hook; see [Miniflux](./miniflux.md)
- Gatus: `gatus`, provisioned by its own pre-install/pre-upgrade hook; see [Gatus](./gatus.md)

Monthly homelab power costs (Kubernetes nodes plus Iris from enrollment) reuse the existing maintenance database `postgres`,
adding only `power_estimation.monthly_cost`. A post-install/post-upgrade hook
provisions limited writer/reader roles without changing the server Deployment.
The weekly collector, read-only Grafana datasource, and backup limits
are covered in [power estimation](./power-estimation-dashboard.md#durable-monthly-homelab-totals).

Immich uses its own PostgreSQL and is not part of this service.

## Runtime

- source: `apps/media-postgres/`
- storage: 20Gi `local-path`
- memory request: 1536Mi
- memory limit: 8Gi
- `max_connections=100`
- `max_locks_per_transaction=2048`
- Timescale telemetry disabled

Local storage is intentional for PostgreSQL durability, latency, WAL, and Timescale chunk workloads. The cost is primary-node affinity and a shared failure domain.

The elevated lock table is required by Tracearr hypertables with many chunks. The memory ceiling supports large backfills and continuous-aggregate refreshes.

## TimescaleDB Scope

Only `tracearr` has the TimescaleDB extension. The image installs it in `postgres` and `template1` on first boot. The init script removes it from both before it creates any application database. Every database created later, including those from app-owned hooks, therefore starts without it. Do not install the extension anywhere else. Each database that holds an unused copy runs its own TimescaleDB scheduler process. That copy also pins a library version that later images must keep shipping.

### Extension Updates

Image upgrades replace the server library and can raise the PostgreSQL minor version, but `tracearr` keeps loading the library that matches its own extension version. An old extension can break on a newer PostgreSQL minor. For example, TimescaleDB versions without upstream fix [timescale/timescaledb#11015](https://github.com/timescale/timescaledb/pull/11015) fail every scheduler-run job on PostgreSQL 16.16 with SQLSTATE 24000 `cannot drop portal "" while it is being set up`. After every `timescale/timescaledb` image rollout, update the extension to the image's version:

1. Back up `tracearr` with `pg_dump -Fc` inside the pod. Verify the file with `pg_restore --list` and match its SHA-256 after download. The update has no downgrade path.
2. Scale `deploy/tracerr` to zero and wait until `tracearr` has no client backends.
3. Run `ALTER EXTENSION timescaledb UPDATE` as the only command of a fresh `psql -X` session. The loader restarts the database's job scheduler. Do not restart media-postgres.
4. Scale Tracerr back up.
5. Failed jobs keep their retry backoff. Send them through the scheduler with `SELECT alter_job(<job_id>, next_start => now())`, then confirm that `timescaledb_information.job_stats` reports success and `job_errors` has no new rows. A foreground `CALL run_job` does not prove the fix because it can succeed while scheduled runs fail.

### Job Health Alert

The hourly `tracearr-timescaledb-health` CronJob in `apps/media-postgres/timescaledb-health/` runs `check.sql` in a read-only session as the `tracearr` role. That role owns the database and its jobs. The check fails in three cases:

- The installed extension differs from the image's library.
- A scheduled job has gone longer than three schedule intervals, and at least two hours, without a success.
- A due job has not started for an hour.

The telemetry reporter is ignored. A failed scheduled run raises `HomelabCronJobTracearrTimescaleUnhealthy` through Discord and Telegram; see [CronJob alerts](./cronjob-deadman-alerts.md). The failed pod's log names each problem. The extension check fires after every image rollout until the update above is done. To confirm a fix, run the check on demand with `kubectl create job -n default --from=cronjob/tracearr-timescaledb-health tracearr-timescaledb-health-manual-$(date +%s)`. The alert itself clears only after the next scheduled run succeeds.

## Secrets

All database credentials are SOPS-managed:

- `media-postgres-secret`
- `power-ledger-db`, limited ledger writer/reader passwords and snapshot push token; the monitoring copy contains only the Grafana reader password
- `tracerr-db-secret`
- `reactive-resume-db-secret`
- `speedtest-tracker-secret`
- `bookorbit-secret`
- `romm-secret`, consumed by RomM and its database-provisioning hook
- `miniflux-secret`, consumed by Miniflux and its database-provisioning hook
- `gatus-secret`, consumed by Gatus and its database-provisioning hook

Initialization creates roles and databases on first boot only. Keep init configuration and Secret values aligned when rebuilding storage.

RomM's hook creates or updates its role/database against both existing and newly initialized servers. Its credentials are not injected into the shared database release, so installing RomM does not roll media-postgres. One API worker, one scan worker, and a 30-connection role limit bound its share of the 100-connection budget.

Miniflux uses the same app-owned hook pattern without changing this release.
Its five-connection runtime pool and eight-connection role limit bound its share
of the existing connection budget.

Gatus also provisions its own restricted role without rolling the shared database.
A 16-connection role limit bounds its ten concurrent endpoint evaluations and dashboard queries.

## Backup Status

The repository defines no automated dump, physical backup, snapshot, or offsite copy for media-postgres. A shared database increases the blast radius of storage loss; do not treat local-path persistence as backup.

## Verification

```bash
flux get kustomization media-postgres -n flux-system
kubectl get hr,pod,pvc -n default | grep media-postgres
kubectl logs -n default deploy/media-postgres --since=30m
kubectl exec -n default deploy/media-postgres -- psql -X -U postgres -d tracearr \
  -c "select default_version, installed_version from pg_available_extensions where name = 'timescaledb'" \
  -c "select job_id, last_run_status, last_successful_finish from timescaledb_information.job_stats order by job_id"
```

`installed_version` must equal `default_version`. Every job must show a recent success, except the telemetry reporter, which never runs while telemetry is off.
