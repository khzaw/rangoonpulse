# Back Up Plan

## Purpose
This document defines a cost-effective backup strategy for this homelab Kubernetes setup.  
It is planning-only for now and does not change running infrastructure.

## Scope
The plan covers service data that must survive pod restarts, OOM crashes, node loss, and operator error.

Primary examples:
- Vaultwarden data
- Immich photos and Immich database
- Grafana database and dashboards
- Other app configs and databases that are not trivially rebuildable

## Current State
- Cluster workloads run on a single primary node.
- Some persistent data is on `local-path` PVCs (node-local risk).
- Some data is on NFS-backed PVCs (TrueNAS).
- GitOps and Flux handle deployment state, but app data is separate from manifests.
- No centralized backup system is currently defined for all app datasets.

## Constraints
- Budget-sensitive: avoid expensive managed backup products.
- Resource-sensitive: backup system should be lean.
- Prefer simple operations and clear restore workflow.
- Offsite copy is needed for disaster scenarios, but cost must stay low.

## Backup Goals
- Fast recovery from app-level problems (bad deploy, accidental delete).
- Recovery from node/disk failure.
- Recovery from site-level issues through encrypted offsite copies.
- Regular restore validation, not just backup job success.

## Recommended Strategy
Use TrueNAS as the backup hub and keep Kubernetes focused on running apps.

Core model:
1. Local snapshots on TrueNAS for fast rollback.
2. App-consistent DB dumps to backup datasets on NAS.
3. Encrypted offsite replication of critical datasets only.
4. Periodic restore drills.

This keeps runtime overhead low in-cluster and controls monthly storage cost.

## Data Classification for Cost Control

### Tier 1: Irreplaceable (offsite required)
- Vaultwarden data
- Immich photos/original assets
- Immich Postgres dump
- Any personal documents/photos not reproducible

### Tier 2: Important but rebuildable (offsite optional)
- Grafana DB/dashboards
- App configs for arr stack and utility apps

### Tier 3: Re-downloadable (usually local-only)
- Media library that can be re-acquired

Only Tier 1 should be mandatory for daily offsite to keep cloud cost low.

## Storage and Backup Architecture

### Local
- Keep app data on NFS datasets in TrueNAS where possible.
- Snapshot schedule on TrueNAS:
  - High-change critical datasets: every 1-4 hours
  - Medium-change datasets: daily
  - Retention tuned by dataset importance

### In-cluster export jobs
- Use lightweight CronJobs for application-consistent database exports.
- Write dumps to NFS backup datasets (not to ephemeral storage).

Examples:
- Immich Postgres: scheduled `pg_dump`
- Vaultwarden (SQLite, if used): safe backup copy from data directory
- Grafana (SQLite): periodic copy of `grafana.db` to NAS backup path

### Offsite
- Use encrypted backup tooling to cheap object storage.
- Practical options:
  - `restic`
  - `kopia`
- Low-cost object storage candidate:
  - Backblaze B2 (or equivalent low-cost S3-compatible provider)

## Scheduling Baseline
- Vaultwarden critical backup: every 6-12 hours
- Immich DB dump: daily
- Immich photo dataset snapshot: hourly or every 4 hours
- Grafana DB backup: daily
- Offsite sync: nightly

Adjust frequency based on change rate and acceptable data-loss window.

## Retention Baseline
- Local snapshots:
  - Hourly for 24-72 hours
  - Daily for 14-30 days
  - Monthly for 3-6 months
- Offsite:
  - Daily for 14-30 days
  - Monthly for 6-12 months for Tier 1 data

Retention should be tuned to storage growth and real restore needs.

## Restore and Validation Plan
- Run monthly restore drills.
- Validate at least:
  - Single-file restore (for photos/docs)
  - App-level restore (for one DB-backed app)
  - Credential recovery path

Drill outputs should record:
- Time to restore
- Any missing dependencies
- Runbook fixes needed

## Phased Implementation Plan

### Phase 1: Inventory and classification
1. List all PVCs, storage classes, and mount paths by app.
2. Map each dataset to Tier 1/2/3.
3. Define RPO/RTO targets per critical app.

### Phase 2: Local snapshot baseline
1. Create dedicated TrueNAS datasets for backup targets.
2. Define snapshot schedules and local retention.
3. Move highest-risk `local-path` critical data to NFS where practical.

### Phase 3: App-consistent backup jobs
1. Add CronJobs for DB dumps and consistency-safe exports.
2. Write outputs to NAS backup datasets.
3. Add alerting for failed jobs.

### Phase 4: Offsite encrypted copy
1. Configure `restic` or `kopia` with encryption.
2. Sync Tier 1 datasets nightly.
3. Validate restore from offsite copy.

### Phase 5: Runbook and drills
1. Document restore procedures per critical app.
2. Run monthly drills and update runbooks.

## Immediate Next Steps (When Resuming Work)
1. Inventory all persistent datasets by app and storage class.
2. Mark Tier 1 datasets first (Vaultwarden, Immich photos, Immich DB).
3. Decide backup engine (`restic` vs `kopia`) and offsite target.
4. Implement one end-to-end pilot backup and restore for a Tier 1 dataset.

## Notes
- Pod restarts and OOM events are not the main risk once PVC persistence is correct.
- Single-node local storage remains a disk/node failure risk.
- Backups are only trustworthy when restores are tested.
