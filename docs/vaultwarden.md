---
title: Vaultwarden Storage and Recovery
summary: Current Vaultwarden application-data and dedicated PostgreSQL layout, dependencies, and recovery boundaries.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Vaultwarden Storage and Recovery

## Current Architecture

Vaultwarden uses two node-local persistent stores:

- `vaultwarden-data-local`: application data and attachments
- `vaultwarden-postgres`: dedicated PostgreSQL data

Both use `local-path` and are pinned to the primary node. Flux reconciles the PostgreSQL release before Vaultwarden. Credentials are SOPS-managed under `infrastructure/secrets/`.

The split keeps PostgreSQL off NFS and avoids SQLite/NFS locking problems, but both data stores share the primary-node disk failure domain.

## Backup Status

The repository defines no automated PostgreSQL dump, physical backup, PVC snapshot, or offsite copy for Vaultwarden. Git and encrypted Secret manifests are not enough to recover the vault data.

## Recovery Rules

- Preserve application data and PostgreSQL as one recovery set.
- Stop Vaultwarden before restoring or replacing PostgreSQL.
- Prefer a logical PostgreSQL dump/restore when a valid dump exists.
- If recovering physical PostgreSQL storage, require a consistent backup made while PostgreSQL was stopped or through a PostgreSQL-aware tool.
- Verify attachments, login, sync, and websocket behavior after recovery.
- Never initialize an empty replacement database over the only surviving data without explicit approval.

## Verification

```bash
flux get kustomizations -n flux-system | grep vaultwarden
kubectl get hr,pod,pvc -n default | grep vaultwarden
kubectl logs -n default deploy/vaultwarden --since=30m
kubectl logs -n default deploy/vaultwarden-postgres --since=30m
curl -I --max-time 20 https://passwords.khzaw.dev/
```
