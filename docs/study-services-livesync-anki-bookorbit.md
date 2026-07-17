# Study Services: Obsidian LiveSync, Anki Sync, and BookOrbit

This document records the GitOps deployment and operational decisions for study-related services.

## What Is Deployed

### 1) Obsidian LiveSync backend (`obsidian-livesync`)
- Path: `apps/obsidian-livesync/helmrelease.yaml`
- Hostname: `https://livesync.khzaw.dev`
- Backend: CouchDB (`couchdb:3.5.1`)
- Purpose: self-hosted sync target for Obsidian LiveSync plugin.

### 2) Anki sync server (`anki-server`)
- Path: `apps/anki-server/helmrelease.yaml`
- Hostname: `https://anki.khzaw.dev`
- Image: `jeankhawand/anki-sync-server:25.07`
- Purpose: private Anki sync endpoint.

### 3) BookOrbit (`bookorbit`)
- Path: `apps/bookorbit/helmrelease.yaml`
- Canonical hostname: `https://bookorbit.khzaw.dev`
- Alias: `https://books.khzaw.dev` redirects to the canonical hostname.
- Image: `ghcr.io/bookorbit/bookorbit:2.2.0`
- Backend: PostgreSQL with pgvector.
- Purpose: digital book library and web reader over the existing Calibre books.

Stump and its private SQLite/config PVC were retired after BookOrbit was populated and verified. No Stump database
state was migrated. The book files remained on the existing `calibre-books-nfs` claim throughout the replacement.

## Mochi Cards Status

`Mochi` (`app.mochi.cards`) is not currently published as a self-hostable server stack. Keep it out of cluster GitOps
unless Mochi publishes a supported self-hosted server deployment.

## Storage Design

Writable app state is separate from the shared library:

- `obsidian-livesync`: `/opt/couchdb/data` on a dedicated `5Gi` `local-path` PVC.
- `anki-server`: `/anki_data` on a dedicated expandable `5Gi` PVC.
- `bookorbit-postgres`: `/var/lib/postgresql/data` on a dedicated `5Gi` `local-path` PVC.
- `bookorbit`: `/data` on a dedicated expandable `5Gi` NFS PVC.
- `bookorbit`: `/books` from existing claim `calibre-books-nfs`, mounted read-only.

BookOrbit library `Books` points at `/books`, uses `book_per_folder` organization, disables file writes and renames,
excludes `bookdrop`, and scans every six hours. Calibre, Calibre-Web Automated, and Shelfmark remain the only writers
to the shared book claim.

## Node Placement and Resources

These services are pinned to the primary node (`talos-7nf-osf`). Requests and limits are bounded so library scans and
metadata work cannot starve the media workloads.

## Secrets

Managed with SOPS under `infrastructure/secrets/default/`:

- `obsidian-livesync-secret.yaml`
- `anki-server-secret.yaml`
- `bookorbit-secret.yaml`

The BookOrbit secret holds PostgreSQL credentials, JWT/bootstrap material, and the initial administrator credentials.

## Flux Wiring

Flux Kustomizations:

- `flux/kustomizations/obsidian-livesync.yaml`
- `flux/kustomizations/anki-server.yaml`
- `flux/kustomizations/bookorbit.yaml`

## Library Safety Verification

Before replacement, record the shared claim identity, file count, byte count, and a content checksum. After the first
BookOrbit scan and again after Stump removal, confirm those values are unchanged. Also verify that the rendered and live
BookOrbit pod specs mount `calibre-books-nfs` at `/books` with `readOnly: true`.

## Quick Checks

```bash
flux get kustomizations | rg 'obsidian-livesync|anki-server|bookorbit'
kubectl get hr -n default | rg 'obsidian-livesync|anki-server|bookorbit'
kubectl get pods,pvc -n default | rg 'obsidian-livesync|anki-server|bookorbit|calibre-books-nfs'
curl --fail --max-time 20 https://bookorbit.khzaw.dev/api/v1/health
curl -I --max-time 20 https://books.khzaw.dev/
```
