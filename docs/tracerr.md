# Tracerr (Tracearr)

## URL
- `https://tracerr.khzaw.dev`

## Deployment
- GitOps: `apps/tracerr/`
- HelmRelease: `apps/tracerr/helmrelease.yaml`

Tracerr is deployed as a single app-template release with multiple containers in one pod:
- `main`: Tracearr web/app
- `db`: TimescaleDB (Postgres)
- `redis`: Redis

This keeps the service "capsulated" and avoids cross-namespace dependency sprawl.

## Storage
- Timescale/Postgres data: `local-path` PVC (`tracerr-db-data`)
  - Rationale: Postgres/Timescale durability and fsync/latency characteristics are better on node-local storage than NFS.
- Redis data: `truenas-nfs` PVC (`tracerr-redis-data`)

## Required Secrets (Not In Git)
Tracerr expects two Secrets in `default`:

1) `tracerr-db-secret`
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (must match the password above)

2) `tracerr-app-secret`
- `JWT_SECRET`
- `COOKIE_SECRET`

Example (generates random values locally and applies them):

```bash
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 32)"
COOKIE_SECRET="$(openssl rand -hex 32)"
DATABASE_URL="postgres://tracearr:${POSTGRES_PASSWORD}@127.0.0.1:5432/tracearr"

kubectl create secret generic tracerr-db-secret -n default \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic tracerr-app-secret -n default \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=COOKIE_SECRET="$COOKIE_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```

