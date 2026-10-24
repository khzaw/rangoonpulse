---
title: Reactive Resume
summary: Current utility-node deployment, printer sidecar, NFS data, shared database, and authentication constraints.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Reactive Resume

## Contract

- hostname: `build-resume.khzaw.dev`
- source: `apps/reactive-resume/`
- Flux: `flux/kustomizations/reactive-resume.yaml`
- placement: utility node
- data: `truenas-nfs` mounted at `/app/data`
- database: `reactive_resume` on shared `media-postgres`

The release contains the web application and a Browserless Chromium printer sidecar. Image versions are authoritative in the HelmRelease.

The app data is NFS-backed, so placement is not coupled to a local PVC. A node move still requires architecture support and capacity validation for both containers.

## Secrets

SOPS-managed Secrets:

- `reactive-resume-db-secret`: database password and URL
- `reactive-resume-app-secret`: authentication secret and printer token

`media-postgres` creates the role/database on first initialization. The database bootstrap and Secret must remain aligned.

SMTP is not configured. Email flows fall back to application logs, so signup or verification may require log inspection.

## Integration And Verification

Reactive Resume is linked from Dynacat and included in Resource Advisor policy.

```bash
flux get kustomization reactive-resume -n flux-system
kubectl get hr,pod,pvc,ingress -n default | grep reactive-resume
kubectl logs -n default deploy/reactive-resume -c main --since=30m
kubectl logs -n default deploy/reactive-resume -c printer --since=30m
curl -Ik https://build-resume.khzaw.dev/
```
