# Shelfmark

## Summary
- Path: `apps/shelfmark/helmrelease.yaml`
- Hostname: `https://shelfmark.khzaw.dev`
- Temporary share host: `https://share-shelfmark.khzaw.dev`
- Image: `ghcr.io/calibrain/shelfmark:v1.2.0`
- Health endpoint: `/api/health`

Shelfmark is deployed as a primary-node `app-template` workload and acts as a manual search/download front end for the
existing book and audiobook stack.

## Storage Mapping
- `/config` -> `app-configs-pvc-nfs` (subPath `shelfmark`)
- `/books` -> `calibre-books-nfs`
- `/bookdrop` -> `booklore` PVC (subPath `bookdrop`)
- `/audiobooks` -> `books` PVC (subPath `audiobooks`)
- `/integrations/calibre` -> `app-configs-pvc-nfs` (subPath `calibre`, read-only)
- `/integrations/calibre-web-automated` -> `app-configs-pvc-nfs` (subPath `calibre-web-automated`, read-only)

Operational intent:
- Shelfmark shares the Calibre/CWA config PVC family without writing into their subpaths.
- Ebook downloads can land on the shared Calibre library PVC.
- BookLore handoff can target `/bookdrop`.
- Audiobookshelf handoff can target `/audiobooks`.

## Runtime Defaults
- Node: `talos-7nf-osf`
- Strategy: `Recreate`
- Requests: `200m` CPU / `512Mi` memory
- Limits: `1500m` CPU / `2Gi` memory
- UI shortcuts:
  - `CALIBRE_WEB_URL=https://calibre.khzaw.dev`
  - `AUDIOBOOK_LIBRARY_URL=https://audiobookshelf.khzaw.dev`

## Related GitOps Surfaces
- Flux: `flux/kustomizations/shelfmark.yaml`
- Glance links/health/release watcher: `apps/glance/helmrelease.yaml`
- Share control catalog: `apps/exposure-control/services.json`
- Share host plumbing:
  - `infrastructure/public-edge/helmrelease.yaml`
  - `infrastructure/public-edge/share-hosts-cname.yaml`
- Resource advisor:
  - `infrastructure/resource-advisor/advisor.py`
  - `infrastructure/resource-advisor/cronjob-apply-pr.yaml`

## Quick Checks
```bash
flux get kustomizations | rg 'shelfmark|booklore|public-edge|exposure-control'
kubectl get hr -n default shelfmark
kubectl get pods -n default | rg shelfmark
kubectl logs -n default deploy/shelfmark --tail=120
curl -I --max-time 20 https://shelfmark.khzaw.dev/api/health
```
