---
title: Interview Prep
summary: Deployment, persistence, image updates, and recovery notes for the interview practice journal.
---

# Interview Prep

Interview Prep is a single-user coding and system-design practice journal deployed at `https://prep.khzaw.dev`.

## Runtime

- Source and image: `github.com/khzaw/interview-prep` / `ghcr.io/khzaw/interview-prep`
- Workload: one `app-template` replica pinned to `${PRIMARY_NODE_NAME}`
- Port and health: `3000` / `/api/health`
- GitOps: `apps/interview-prep/` and `flux/kustomizations/interview-prep.yaml`
- Image promotion: timestamped commit tags selected by `ImagePolicy/interview-prep`

## Persistence

The application stores its entire versioned workspace in SQLite at `/data/interview-prep.sqlite`. The `/data` mount is a `1Gi` `local-path` PVC and the controller uses `Recreate`, so only one process can write the database.

SQLite is intentionally not placed on NFS. The Uptime Kuma SQLite-on-NFS incident demonstrated that WAL and locking traffic can cause routine operations to stall on the NAS-backed storage class.

The PVC is node-affined to the primary node. Moving the workload requires an explicit data migration or restoring an exported workspace.

## Backup and recovery

- Logical backup: Settings -> Export JSON from the application.
- Volume backup: include the Interview Prep PVC in the local-path backup workflow.
- Restore: start from an empty database and import the JSON export, or restore the SQLite database while the workload is stopped.

Do not copy only the main SQLite file while the app is writing. Stop the workload or include its `-wal` and `-shm` files in a consistent snapshot.
