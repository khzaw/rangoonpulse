# Job Ops

## URL
- `https://job-ops.khzaw.dev`

## Deployment
- GitOps: `apps/job-ops/`
- HelmRelease: `apps/job-ops/helmrelease.yaml`
- Flux Kustomization: `flux/kustomizations/job-ops.yaml`
- Node placement: pinned to `talos-7nf-osf` (primary `amd64` node)

## Storage
- App state is persisted at `/app/data` on a `local-path` PVC (`10Gi`).
- Upstream Job Ops uses SQLite plus generated PDFs and backups under the same data directory.
- Do not move this workload to NFS-backed storage unless upstream changes away from SQLite. See the same SQLite-on-NFS failure mode documented in `docs/uptime-kuma-sqlite-on-nfs-timeouts.md`.

## Runtime Notes
- Upstream defaults to SQLite; shared `media-postgres` is not used.
- `JOBOPS_PUBLIC_BASE_URL` is set to `https://job-ops.khzaw.dev` so tracer-link URLs and background-generated PDF links use the canonical hostname.
- Base install does not require a GitOps-managed Secret. LLM provider keys, RxResume credentials, Gmail OAuth, and extractor credentials can be configured later through the Job Ops UI and are stored in the app data directory.
- Write auth is unauthenticated by default upstream unless `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are provided in the environment.

## Image / Port
- Image: `ghcr.io/dakheera47/job-ops:v0.1.29`
- Container / Service port: `3001`
- Health endpoint: `/health`
