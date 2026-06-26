# Study Services: Obsidian LiveSync, Anki Sync, and Stump

This document records the GitOps deployment and operational decisions for study-related services.

## What Is Deployed

### 1) Obsidian LiveSync backend (`obsidian-livesync`)
- Path: `apps/obsidian-livesync/helmrelease.yaml`
- Hostname: `https://livesync.khzaw.dev`
- Backend: CouchDB (`couchdb:3.5.1`)
- Purpose: self-hosted sync target for Obsidian LiveSync plugin.

Current rollout note:
- uses baseline CouchDB config (no custom ini overlay) for startup stability
- set plugin/server options from the LiveSync setup flow after first login

### 2) Anki sync server (`anki-server`)
- Path: `apps/anki-server/helmrelease.yaml`
- Hostname: `https://anki.khzaw.dev`
- Image: `jeankhawand/anki-sync-server:25.07` (official sync-server Dockerfile lineage)
- Purpose: private Anki sync endpoint (alternative to AnkiWeb)

### 3) Stump (`stump`)
- Path: `apps/stump/helmrelease.yaml`
- Hostnames:
  - `https://books.khzaw.dev`
  - `https://stump.khzaw.dev`
- Image: `aaronleopold/stump:0.1.5`
- Purpose: digital book library management/reader that imports the existing Calibre books.

BookLore and its MariaDB sidecar were retired in favor of Stump. The old BookLore app database is not reused because
Stump has its own SQLite data model; the actual book files are preserved by mounting the shared Calibre library PVC.

## Mochi Cards Status (Important)

`Mochi` (`app.mochi.cards`) is not currently published as a self-hostable server stack.
It is a hosted SaaS/local-first app model, so there is no supported Kubernetes backend deployment equivalent to Anki sync or Stump.

Operational decision:
- Keep Mochi out of cluster GitOps for now.
- Re-evaluate only if Mochi publishes an official self-host/server deployment model.

## Storage Design

All new writable app state is on expandable NFS storage (`truenas-nfs`), except where a service explicitly needs node-local state.

- `obsidian-livesync`
  - `/opt/couchdb/data` -> dedicated PVC (`5Gi`, `local-path`, node-affined)

- `anki-server`
  - `/anki_data` -> dedicated PVC (`5Gi`, expandable)

- `stump`
  - `/config` -> dedicated PVC (`8Gi`, expandable)
  - `/data` -> existing claim `calibre-books-nfs`

Notes:
- Stump stores its config and SQLite database on `/config` via `STUMP_CONFIG_DIR=/config` and `STUMP_DB_PATH=/config`.
- The existing Calibre books are mounted at Stump's library root (`/data`) so Stump scans the same files instead of duplicating them.
- Shelfmark's `/bookdrop` staging path is also on `calibre-books-nfs` (subPath `bookdrop`) and can be scanned by Stump when used.

## Node Placement and Resource Policy

All three deployed services are pinned to the primary node:
- `kubernetes.io/hostname: talos-7nf-osf`

Reason:
- Consistent with default userland policy.
- Avoid accidental ARM-only/AMD64-only image mismatches during evaluation.

Requests/limits are intentionally bounded to avoid starving media workloads while allowing Stump scans and thumbnailing to finish.

## Secrets

Managed with SOPS under `infrastructure/secrets/default/`:
- `obsidian-livesync-secret.yaml`
- `anki-server-secret.yaml`

Consumed by:
- `obsidian-livesync` (`COUCHDB_USER`, `COUCHDB_PASSWORD`)
- `anki-server` (`SYNC_USER1`)

Stump does not currently require a Git-managed Kubernetes Secret.

## Flux Wiring

Flux Kustomizations:
- `flux/kustomizations/obsidian-livesync.yaml`
- `flux/kustomizations/anki-server.yaml`
- `flux/kustomizations/stump.yaml`

And included in:
- `flux/kustomization.yaml`

## Quick Checks

```bash
flux get kustomizations | rg 'obsidian-livesync|anki-server|stump'
kubectl get hr -n default | rg 'obsidian-livesync|anki-server|stump'
kubectl get pods -n default | rg 'obsidian-livesync|anki-server|stump'
curl -I --max-time 20 https://books.khzaw.dev/
curl -I --max-time 20 https://stump.khzaw.dev/
```
