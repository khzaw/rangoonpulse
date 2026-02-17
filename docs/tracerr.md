# Tracerr (Tracearr)

## URL
- `https://tracerr.khzaw.dev`

## Deployment
- GitOps: `apps/tracerr/`
- HelmRelease: `apps/tracerr/helmrelease.yaml`

Tracerr runs as a single app-template release:
- `main`: Tracearr web/app
- `redis`: Redis

Postgres/TimescaleDB is provided by the shared in-cluster instance `media-postgres`.

## Storage
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
DATABASE_URL="postgres://tracearr:${POSTGRES_PASSWORD}@media-postgres:5432/tracearr"

kubectl create secret generic tracerr-db-secret -n default \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic tracerr-app-secret -n default \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=COOKIE_SECRET="$COOKIE_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```
