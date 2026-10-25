---
title: Study and Book Services
summary: Current Obsidian LiveSync, Anki sync, BookOrbit, and shared-library operating contracts.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Study and Book Services

## Obsidian LiveSync

- source: `apps/obsidian-livesync/`
- backend: CouchDB
- placement: primary node
- persistence: local-path
- credentials: SOPS-managed

The hostname serves CouchDB for Obsidian LiveSync clients. Treat the database as node-local state; no repository-defined automated backup exists.

## Anki Sync Server

- source: `apps/anki-server/`
- placement: utility node
- persistence: `truenas-nfs`
- credentials: SOPS-managed

This is an Anki sync endpoint, not a web application. A browser request to `/` returning `404` is expected and is not a health failure. Validate with the Anki sync protocol or client login path.

## BookOrbit

- source: `apps/bookorbit/`
- placement: primary node
- application data: `truenas-nfs`
- shared library: `books` mounted read-write at `/books`
- downloads: shared `downloads` claim mounted read-write at `/downloads`
- database: shared `media-postgres`
- canonical hostname: `bookorbit.khzaw.dev`
- alias: `books.khzaw.dev`

BookOrbit can write embedded metadata back to the shared library. Shelfmark also writes into that library. Avoid concurrent bulk mutation from both applications, and verify file-level effects before enabling new automation.

Saved download-client and indexer credentials are encrypted with `BOOK_REQUEST_ENCRYPTION_KEY`, supplied by `bookorbit-secret`. Preserve this key across upgrades and recovery; replacing it makes existing encrypted credentials unreadable.

BookOrbit scan cadence, users, and metadata-provider settings are runtime application state, not declared in this repository. Do not copy those values into Git docs unless they become managed configuration.

A temporary BookOrbit share is fully wired through exposure-control and public-edge.

For Transmission integration, use `http://transmission-main.default.svc.cluster.local:9091` with an explicit `/downloads` to `/downloads` path mapping. The category `bookorbit` uses `/downloads/bookorbit`. Client configuration is runtime application state. BookOrbit stages completed imports in `/data/book-dock`; direct-file plugins use `/data/request-downloads`. These app-data paths are separate filesystems from `/downloads`, so cross-mount hardlinks fall back to copies.

Non-browser sync and reading clients cannot generally complete Cloudflare Access email/browser challenges. Keep exposure authentication `none` for deliberately shared Anki, LiveSync, or BookOrbit client endpoints, and require their application credentials. Validate sync/OPDS/download operations from the actual client before reporting access complete.

## Shared Library Ownership

`books` is shared by BookOrbit and Shelfmark. `audiobooks` contains Audiobookshelf and Shelfmark content; application state uses separate claims. See [book library storage](./book-library-storage.md) for ownership and retained-volume safety.

Do not rename, recreate, or delete the claim as cleanup without proving every current consumer and the underlying dataset mapping.

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'obsidian|anki|bookorbit'
kubectl get pod,pvc,ingress -n default | grep -E 'obsidian|anki|bookorbit|books'
curl --fail --max-time 20 https://bookorbit.khzaw.dev/api/v1/health
curl -I --max-time 20 https://books.khzaw.dev/
```
