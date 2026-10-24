---
title: Shelfmark
summary: Current Shelfmark storage mappings, shared-library write boundary, exposure, and tuning ownership.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Shelfmark

## Contract

- source: `apps/shelfmark/`
- hostname: `shelfmark.khzaw.dev`
- health: `/api/health`
- placement: primary node
- rollout: `Recreate`
- temporary share: fully wired as `share-shelfmark.khzaw.dev`

Image and resource values are authoritative in the HelmRelease and Resource Advisor policy rather than this doc.

## Storage

- `/config` -> `app-configs-pvc-nfs`, subpath `shelfmark`
- `/books` -> `books`, volume root
- `/bookdrop` -> `books`, subpath `bookdrop`
- `/audiobooks` -> `audiobooks`, volume root

BookOrbit and Shelfmark both mount `books` read-write. Avoid concurrent bulk writes or metadata operations until file-level effects have been validated. Shelfmark and Audiobookshelf must see the same audiobook files at the volume root. Audiobookshelf's private config/metadata claim must not be exposed to Shelfmark. See [book library storage](./book-library-storage.md).

## Integration

- Flux: `flux/kustomizations/shelfmark.yaml`
- Dynacat: links, health monitor, and release watcher
- exposure-control: service catalog
- public-edge: Tunnel route and DNS alias
- Resource Advisor: `infrastructure/resource-advisor/advisor.py`

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'shelfmark|bookorbit|public-edge|exposure-control'
kubectl get hr,pod,pvc -n default | grep shelfmark
curl -I --max-time 20 https://shelfmark.khzaw.dev/api/health
```
