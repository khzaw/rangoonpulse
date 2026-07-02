---
title: Subarr
summary: Deployment notes and breadcrumb surfaces for the Subarr subtitle-management service.
status: active
owner: homelab
last_reviewed: 2026-07-02
---

# Subarr

Subarr is a subtitle-management service for the media automation stack.

## Source Of Truth

- App manifests: `apps/subarr/`
- Flux registration: `flux/kustomizations/subarr.yaml`
- Glance dashboard links and monitors: `apps/glance/helmrelease.yaml`
- Exposure-control service catalog: `apps/exposure-control/services.json`

## Runtime

- Image: `ghcr.io/coaxk/subarr:2.3.1`
- Namespace: `default`
- Service: `subarr.default.svc.cluster.local:9922`
- Health endpoint: `/api/health`
- Public hostname: `https://subarr.khzaw.dev`

## Storage

- `/data`: dedicated `local-path` PVC, `2Gi`; contains `subarr.db` and persisted settings
- `/media`: existing shared `media` PVC

## Breadcrumbs To Keep Updated

- Root `README.md` media automation overview
- `docs/README.md` service-specific guide index
- Glance `Arr Stack` bookmark group
- Glance `Arr and Download Health` monitor group
- Glance GitHub releases widget entry: `coaxk/subarr`
- Exposure-control service catalog entry: `subarr`
