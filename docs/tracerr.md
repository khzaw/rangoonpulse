---
title: Tracerr
summary: Current Tracerr deployment, Tracearr upstream naming, shared database, Redis, secrets, and exposure surfaces.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Tracerr

## Naming Contract

Repository objects, directory names, Flux wiring, and hostname use `tracerr`. The upstream image and PostgreSQL role/database use `tracearr`. Preserve that distinction; do not rename database identities during ordinary maintenance.

## Runtime

- source: `apps/tracerr/`
- application image: `ghcr.io/connorgallopo/tracearr`
- database: shared `media-postgres`
- Redis: persistent sidecar in the Tracerr release
- hostname: `tracerr.khzaw.dev`
- temporary share: fully wired through exposure-control and public-edge

Mutable image versions belong in the HelmRelease, not this doc.

## Secrets

`tracerr-db-secret` and `tracerr-app-secret` are SOPS-managed under `infrastructure/secrets/` and reconciled by the `secrets` Flux Kustomization. Do not create imperative plaintext replacements.

The database secret must stay consistent with the `tracearr` role/database initialized by media-postgres. The app secret owns application authentication material.

## Integration

Tracerr is registered with Flux, Dynacat, exposure-control/public-edge, and Resource Advisor. Check each current source before changing service identity or ports.

## Verification

```bash
flux get kustomization tracerr -n flux-system
kubectl get hr,pod,svc,ingress -n default | grep tracerr
kubectl get secret -n default | grep tracerr
kubectl logs -n default deploy/tracerr --since=30m
curl -Ik https://tracerr.khzaw.dev/
```

Verify secret metadata and key names only; never print values.
