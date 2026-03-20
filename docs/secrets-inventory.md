# Secrets Inventory (Services -> Secrets)

This doc is a living map of **which services consume which Kubernetes Secrets**, and where those secrets are managed.

## Management Model (Current)
- **GitOps encrypted secrets** live under `infrastructure/secrets/**` and are encrypted with **SOPS+age**.
- Flux decrypts them during reconciliation via:
  - Flux Kustomization: `flux-system/secrets` (file: `flux/kustomizations/secrets.yaml`)
  - age key Secret: `flux-system/sops-age` (key file: `age.agekey`)

Notes:
- At runtime, workloads still consume **normal Kubernetes `Secret` objects** (SOPS only protects secrets at rest in Git).
- TLS secrets like `*-tls` are **managed by cert-manager** and are not tracked here unless a workload explicitly references them.

## In-Use Secrets (Referenced By GitOps Manifests)

### Dashboards
- **glance** (`apps/glance/helmrelease.yaml`)
  - `default/homepage-widget-secrets`
    - consumed via `envFrom.secretRef`
    - keys: various `*_API_KEY` values used by Glance widgets

- **exposure-control** (`apps/exposure-control/helmrelease.yaml`)
  - `default/exposure-control-github`
    - key: `GITHUB_TOKEN` (GitHub API token for dispatching Renovate workflow and listing Renovate runs and PRs)

### Study Services
- **obsidian-livesync** (`apps/obsidian-livesync/helmrelease.yaml`)
  - `default/obsidian-livesync-secret`
    - keys: `COUCHDB_USER`, `COUCHDB_PASSWORD`

- **anki-server** (`apps/anki-server/helmrelease.yaml`)
  - `default/anki-server-secret`
    - key: `SYNC_USER1` (format `username:password`)

- **booklore + booklore-mariadb** (`apps/booklore/helmrelease.yaml`, `apps/booklore-mariadb/helmrelease.yaml`)
  - `default/booklore-secret`
    - keys: `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `MYSQL_ROOT_PASSWORD`

### DNS / TLS
- **external-dns** (`infrastructure/external-dns/helmrelease.yaml`)
  - `flux-system/cloudflare-api-token`
    - key: `token` (Cloudflare API token)

- **cert-manager ClusterIssuers** (`infrastructure/cert-manager/config/le-clusterissuer.yaml`)
  - `cert-manager/cloudflare-api-token`
    - key: `token` (Cloudflare API token for DNS-01)

### Registry Auth
- **Flux image automation for private GHCR repos** (`infrastructure/image-automation/*.yaml`)
  - `flux-system/ghcr-pull-secret`
    - key: `.dockerconfigjson` (registry auth for ImageRepository scans)

- **rangoon-mapper** (`apps/rangoon-mapper/helmrelease.yaml`)
  - `default/ghcr-pull-secret`
    - key: `.dockerconfigjson` (registry auth for kubelet image pulls)

### Storage
- **democratic-csi** (`infrastructure/storage/democratic-csi/hr-hdd.yaml`, `infrastructure/storage/democratic-csi/hr-nvme.yaml`)
  - `democratic-csi/truenas-credentials`
    - keys: `username`, `password`

### Media DBs
- **media-postgres** (`apps/media-postgres/helmrelease.yaml`)
  - `default/media-postgres-secret`
    - key: `POSTGRES_PASSWORD` (postgres superuser password)
  - `default/tracerr-db-secret`
    - key: `POSTGRES_PASSWORD` (used by init script to create role/db)

- **tracerr** (`apps/tracerr/helmrelease.yaml`)
  - `default/tracerr-db-secret`
    - key: `DATABASE_URL`
    - key: `POSTGRES_PASSWORD` (also used by `media-postgres` init)
  - `default/tracerr-app-secret`
    - key: `JWT_SECRET`
    - key: `COOKIE_SECRET`

- **reactive-resume** (`apps/reactive-resume/helmrelease.yaml`)
  - `default/reactive-resume-db-secret`
    - key: `DATABASE_URL`
    - key: `POSTGRES_PASSWORD` (also used by `media-postgres` init)
  - `default/reactive-resume-app-secret`
    - key: `AUTH_SECRET`
    - key: `PRINTER_TOKEN`

- **immich** (`apps/immich/helmrelease.yaml`)
  - `default/immich-db-secret`
    - key: `POSTGRES_PASSWORD`

### Password Manager
- **vaultwarden + vaultwarden-postgres** (`apps/vaultwarden/helmrelease.yaml`, `apps/vaultwarden-postgres/helmrelease.yaml`)
  - `default/vaultwarden-db-secret`
    - keys: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`

### Ops / Notifications
- **resource-advisor (apply PR)** (`infrastructure/resource-advisor/cronjob-apply-pr.yaml`)
  - `monitoring/resource-advisor-github`
    - key: `token` (GitHub token for PR creation)

### Networking
- **tailscale-operator** (workload managed by chart; secret created out-of-band today)
  - `tailscale/operator-oauth`
    - keys: `client_id`, `client_secret`

### Downloaders / VPN
- **transmission optional VPN sidecar** (`apps/transmission/helmrelease.yaml`)
  - `default/transmission-vpn-secret`
    - keys: `WIREGUARD_PRIVATE_KEY`, `WIREGUARD_PRESHARED_KEY`
    - consumed by `gluetun` via `envFrom.secretRef`
  - `default/transmission-gluetun-control-secret`
    - keys: `GLUETUN_API_KEY`, `HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE`
    - consumed by both `gluetun` and `gluetun-webui` via `envFrom.secretRef`

## Not Managed By GitOps (But Present In Cluster)
These exist in-cluster but are not currently referenced by this repo's GitOps manifests (or are chart-owned/generated state):
- cert-manager account keys (e.g. `cert-manager/letsencrypt-prod-account-key`)
- helm release state secrets (`sh.helm.release.v1.*`)
- kube-prometheus-stack generated secrets (Grafana admin, Prometheus web config, etc.)
- legacy/orphaned app secrets (example: `default/ghost-*`) if the app is no longer managed via GitOps

## Local Repo Files To Treat As Sensitive
These files contain credentials and should not be committed to Git (even if they are convenient locally):
- `kubeconfig` (client cert/key material)
