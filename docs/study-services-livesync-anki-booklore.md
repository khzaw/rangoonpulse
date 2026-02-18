# Study Services: Obsidian LiveSync, Anki Sync, and BookLore

This document records the GitOps deployment and operational decisions for study-related services.

## What Is Deployed

### 1) Obsidian LiveSync backend (`obsidian-livesync`)
- Path: `apps/obsidian-livesync/helmrelease.yaml`
- Hostname: `https://livesync.khzaw.dev`
- Backend: CouchDB (`couchdb:3.5.1`)
- Purpose: self-hosted sync target for Obsidian LiveSync plugin.

Key runtime settings:
- single-node CouchDB mode
- CORS enabled for Obsidian/mobile origins
- larger request/document limits for attachment-heavy vaults

### 2) Anki sync server (`anki-server`)
- Path: `apps/anki-server/helmrelease.yaml`
- Hostname: `https://anki.khzaw.dev`
- Image: `jeankhawand/anki-sync-server:25.07` (official sync-server Dockerfile lineage)
- Purpose: private Anki sync endpoint (alternative to AnkiWeb)

### 3) BookLore (`booklore` + `booklore-mariadb`)
- Paths:
  - `apps/booklore/helmrelease.yaml`
  - `apps/booklore-mariadb/helmrelease.yaml`
- Hostname: `https://booklore.khzaw.dev`
- App image: `ghcr.io/booklore-app/booklore:v1.18.5`
- DB image: `lscr.io/linuxserver/mariadb:11.4.8`
- Purpose: book library management/reader that can index existing Calibre books.

## Mochi Cards Status (Important)

`Mochi` (`app.mochi.cards`) is not currently published as a self-hostable server stack.
It is a hosted SaaS/local-first app model, so there is no supported Kubernetes backend deployment equivalent to Anki sync or BookLore.

Operational decision:
- Keep Mochi out of cluster GitOps for now.
- Re-evaluate only if Mochi publishes an official self-host/server deployment model.

## Storage Design

All new writable app state is on expandable NFS storage (`truenas-nfs`).

- `obsidian-livesync`
  - `/opt/couchdb/data` -> dedicated PVC (`10Gi`, expandable)

- `anki-server`
  - `/anki_data` -> dedicated PVC (`5Gi`, expandable)

- `booklore-mariadb`
  - `/config` -> dedicated PVC (`5Gi`, expandable)

- `booklore`
  - `/app/data` + `/bookdrop` -> dedicated PVC (`8Gi`, expandable)
  - `/books` -> existing claim `calibre-books-nfs` (mounted read-only)

Notes:
- `DISK_TYPE=NETWORK` is set for BookLore to reflect NFS usage and avoid local-disk assumptions.
- Existing Calibre books data is mounted read-only on BookLore to avoid accidental mutation during evaluation.
- Calibre config PVC is intentionally not mounted in the initial stable rollout; add it later only if a specific integration requires it.

## Node Placement and Resource Policy

All three deployed services are pinned to the primary node:
- `kubernetes.io/hostname: talos-7nf-osf`

Reason:
- Consistent with default userland policy.
- Avoid accidental ARM-only/AMD64-only image mismatches during evaluation.

Requests/limits were intentionally conservative and bounded to avoid starving media workloads.

## Secrets

Managed with SOPS under `infrastructure/secrets/default/`:
- `obsidian-livesync-secret.yaml`
- `anki-server-secret.yaml`
- `booklore-secret.yaml`

Consumed by:
- `obsidian-livesync` (`COUCHDB_USER`, `COUCHDB_PASSWORD`)
- `anki-server` (`SYNC_USER1`)
- `booklore` + `booklore-mariadb` (DB credentials)

## Flux Wiring

Added Flux Kustomizations:
- `flux/kustomizations/obsidian-livesync.yaml`
- `flux/kustomizations/anki-server.yaml`
- `flux/kustomizations/booklore-mariadb.yaml`
- `flux/kustomizations/booklore.yaml`

And included them in:
- `flux/kustomization.yaml`

## Quick Checks

```bash
flux get kustomizations | rg 'obsidian-livesync|anki-server|booklore'
kubectl get hr -n default | rg 'obsidian-livesync|anki-server|booklore'
kubectl get pods -n default | rg 'obsidian-livesync|anki-server|booklore'
```
