# Reactive Resume

## URL
- `https://build-resume.khzaw.dev`

## Deployment
- GitOps: `apps/reactive-resume/`
- HelmRelease: `apps/reactive-resume/helmrelease.yaml`
- Flux Kustomization: `flux/kustomizations/reactive-resume.yaml`

Reactive Resume runs as a single `app-template` release with:
- `main`: the web app (`ghcr.io/amruthpillai/reactive-resume:v5.0.11`)
- `printer`: a sidecar Chromium worker (`ghcr.io/browserless/chromium:v2.43.0`)

Current placement target is the primary node (`talos-7nf-osf`). Both images publish `arm64` manifests, but the first GHCR pull on the
Raspberry Pi utility node was too slow for a predictable rollout and the Chromium sidecar is still a better fit on the larger node.
Because the app data PVC is on NFS, moving the release back to `talos-uua-g6r` later is a manifest-only change if you want to retry it.

## Storage
- App uploads/runtime files: `truenas-nfs` PVC mounted at `/app/data`

Reactive Resume can use S3-compatible object storage, but this deployment intentionally uses the built-in filesystem mode so the
service stays small and portable.

## Database
- Postgres: shared `media-postgres` service
- DB name: `reactive_resume`
- Role: `reactive_resume`

The `media-postgres` init script creates the role and database on first boot only. If the shared Postgres PVC is ever rebuilt,
keep the secret and init script in sync before reconciling.

## Required Secrets
Reactive Resume expects two SOPS-managed Secrets in `default`:

1. `reactive-resume-db-secret`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

2. `reactive-resume-app-secret`
- `AUTH_SECRET`
- `PRINTER_TOKEN`

## Auth Note
SMTP is intentionally not configured. Email flows fall back to app logging, so first-run signup or email verification may require
checking the Reactive Resume container logs.
