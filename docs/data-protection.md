---
title: Data Protection Status
summary: Repository-defined backup coverage, current gaps, and restore rules for persistent workloads.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Data Protection Status

## What Git Protects

Git and SOPS protect declarative cluster state and encrypted Secret manifests. They do not back up PVC contents, databases, uploaded media, or runtime-owned ConfigMaps.

## Repository-Defined Data Backups

Two SQLite applications currently have automated data replication defined in Git:

- Retirement: local-path database replicated by Litestream to `retirement-backup` on `truenas-nfs`
- 75 Soft: local-path database replicated by Litestream to `seventyfivesoft-backup` on `truenas-nfs`

Both use Litestream (version pinned in the HelmRelease), five-second synchronization, daily snapshots, 90-day retention, restore-on-missing startup behavior, and Prometheus monitoring.

These replicas protect against loss of the local node disk. They are still in the same homelab and are not offsite disaster recovery.

## Current Gaps

The repository does not define centralized backup software, offsite replication, Kubernetes VolumeSnapshots, `pg_dump` jobs, or a general TrueNAS snapshot policy.

Important persistent systems without repository-defined automated backups include:

- Interview Prep SQLite
- Uptime Kuma SQLite
- Vaultwarden application data and dedicated PostgreSQL
- media-postgres and its application databases
- Immich PostgreSQL and local machine-learning/cache state
- Prometheus TSDB and Grafana state
- exposure-control runtime state

NFS placement is not a backup. It changes the failure domain but does not protect against deletion, corruption, operator error, or NAS loss.

TrueNAS snapshot or replication schedules may exist outside this repository. Do not claim that coverage without checking TrueNAS directly.

## Restore Rules

- Stop all writers before copying SQLite or PostgreSQL storage.
- For SQLite in WAL mode, use the application's export path, SQLite backup API, Litestream restore, or a complete copy that includes WAL/SHM state while the writer is stopped.
- For PostgreSQL, prefer a logical dump/restore or a verified application-consistent physical backup. Copying a live data directory is not a backup procedure.
- Restore into disposable storage first when possible, run database integrity checks, and verify application behavior before replacing live data.
- A successful backup job is not sufficient evidence. Restore tests are the proof.

## Verification

Repository coverage:

```bash
find apps infrastructure -type f \( -name '*.yaml' -o -name '*.yml' \) -print \
  | xargs grep -nE 'litestream|VolumeSnapshot|pg_dump|restic|kopia'
```

Live Retirement and 75 Soft checks:

```bash
kubectl get pods,pvc -n default | grep -E 'retirement|seventyfivesoft'
kubectl logs -n default deploy/retirement -c litestream --since=1h
kubectl logs -n default deploy/seventyfivesoft -c litestream --since=1h
kubectl get prometheusrule -n monitoring | grep litestream
```

Never infer offsite or NAS snapshot coverage from these checks.
