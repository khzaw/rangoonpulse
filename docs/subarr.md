---
title: Subarr
summary: Current Subarr runtime, SQLite/media storage, dashboard integration, and incomplete public-share wiring.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Subarr

Subarr is the subtitle-management service at `subarr.khzaw.dev`.

## Source And Runtime

- app: `apps/subarr/`
- Flux: `flux/kustomizations/subarr.yaml`
- service: `subarr.default.svc.cluster.local:9922`
- health: `/api/health`
- state: 2Gi `local-path` PVC at `/data`, including SQLite
- media: shared `media` PVC at `/media`

The local SQLite state makes Subarr node-affined and has no repository-defined automated backup.

## Integration

Dynacat owns the Arr Stack link, health monitor, and upstream release widget.

Subarr appears in `apps/exposure-control/services.json`, but it currently has no matching cloudflared route or public-edge CNAME. It is catalog-visible, not a working public share. Add all three wiring surfaces together before claiming temporary public access.

Subarr is not in Resource Advisor's auto-apply map.

## Verification

```bash
flux get kustomization subarr -n flux-system
kubectl get hr,pod,pvc,svc,ingress -n default | grep subarr
curl -I https://subarr.khzaw.dev/api/health
```
