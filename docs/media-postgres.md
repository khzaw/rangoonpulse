---
title: Media PostgreSQL
summary: Current shared TimescaleDB consumers, local storage, tuning rationale, secrets, and backup gap.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Media PostgreSQL

`media-postgres` is a shared PostgreSQL 16 plus TimescaleDB service for:

- Tracerr: `tracearr`
- Reactive Resume: `reactive_resume`
- Speedtest Tracker: `speedtest_tracker`
- BookOrbit: `bookorbit`
- RomM: `romm`, provisioned by its own pre-install/pre-upgrade hook; see [RomM](./romm.md)

Monthly cluster power costs reuse the existing maintenance database `postgres`,
adding only `power_estimation.monthly_cost`. A post-install/post-upgrade hook
provisions limited writer/reader roles without changing the server Deployment.
The weekly collector, read-only Grafana datasource, and explicit no-NAS-copy
policy are covered in [power estimation](./power-estimation-dashboard.md#durable-monthly-cluster-totals).

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

## Secrets

All database credentials are SOPS-managed:

- `media-postgres-secret`
- `power-ledger-db`, limited ledger writer/reader passwords and snapshot push token; the monitoring copy contains only the Grafana reader password
- `tracerr-db-secret`
- `reactive-resume-db-secret`
- `speedtest-tracker-secret`
- `bookorbit-secret`
- `romm-secret`, consumed by RomM and its database-provisioning hook

Initialization creates roles and databases on first boot only. Keep init configuration and Secret values aligned when rebuilding storage.

RomM's hook creates or updates its role/database against both existing and newly initialized servers. Its credentials are not injected into the shared database release, so installing RomM does not roll media-postgres. One API worker, one scan worker, and a 30-connection role limit bound its share of the 100-connection budget.

## Backup Status

The repository defines no automated dump, physical backup, snapshot, or offsite copy for media-postgres. A shared database increases the blast radius of storage loss; do not treat local-path persistence as backup.

## Verification

```bash
flux get kustomization media-postgres -n flux-system
kubectl get hr,pod,pvc -n default | grep media-postgres
kubectl logs -n default deploy/media-postgres --since=30m
```
