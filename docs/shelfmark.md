# Shelfmark

## Summary
- Path: `apps/shelfmark/helmrelease.yaml`
- Hostname: `https://shelfmark.khzaw.dev`
- Temporary share host: `https://share-shelfmark.khzaw.dev`
- Image: `ghcr.io/calibrain/shelfmark:v1.3.4`
- Health endpoint: `/api/health`

Shelfmark is deployed as a primary-node `app-template` workload and acts as a manual search/download front end for the
existing book and audiobook stack.

## Storage Mapping
- `/config` -> `app-configs-pvc-nfs` (subPath `shelfmark`)
- `/books` -> `books` PVC (volume root)
- `/bookdrop` -> `books` PVC (subPath `bookdrop`)
- `/audiobooks` -> `audiobooks` PVC (volume root)

Operational intent:
- Ebook downloads can land on the shared ebook library PVC.
- BookOrbit and Shelfmark both mount `books` read-write. BookOrbit owns library browsing and metadata;
  Shelfmark writes downloaded files into the library or `bookdrop`.
- Audiobookshelf and Shelfmark see the same content at `/audiobooks`; do not restore Shelfmark's former
  `subPath: audiobooks`, which pointed at a different directory beneath the library root.
- Audiobookshelf's configuration and metadata live on `audiobookshelf-data` and are not exposed to Shelfmark.

The generic content claim names, retained PV identities, and migration procedure are recorded in
[book library storage](./book-library-storage.md).

## Runtime Defaults
- Node: `talos-7nf-osf`
- Strategy: `Recreate`
- Requests: `84m` CPU / `417Mi` memory
- Limits: `633m` CPU / `864Mi` memory
- UI shortcuts:
  - `AUDIOBOOK_LIBRARY_URL=https://audiobookshelf.khzaw.dev`

## Related GitOps Surfaces
- Flux: `flux/kustomizations/shelfmark.yaml`
- Dynacat links/health/release watcher: `apps/dynacat/helmrelease.yaml`
- Share control catalog: `apps/exposure-control/services.json`
- Share host plumbing:
  - `infrastructure/public-edge/helmrelease.yaml`
  - `infrastructure/public-edge/share-hosts-cname.yaml`
- Resource advisor:
  - `infrastructure/resource-advisor/advisor.py`
  - `infrastructure/resource-advisor/cronjob-apply-pr.yaml`

## Quick Checks
```bash
flux get kustomizations | rg 'shelfmark|bookorbit|public-edge|exposure-control'
kubectl get hr -n default shelfmark
kubectl get pods -n default | rg shelfmark
kubectl logs -n default deploy/shelfmark --tail=120
curl -I --max-time 20 https://shelfmark.khzaw.dev/api/health
```
