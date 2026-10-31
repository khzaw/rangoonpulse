---
title: Miniflux
summary: Private RSS reader using shared PostgreSQL, restricted database credentials, and encrypted administrator bootstrap.
status: active
owner: homelab
last_reviewed: 2026-11-01
---

# Miniflux

Miniflux runs at `https://rss.khzaw.dev` through the private LAN/Tailscale ingress.
Sign in as `admin`; retrieve `ADMIN_PASSWORD` from `default/miniflux-secret` on
the Control Panel Secrets page. Add subscriptions in the app or import an OPML file.

## Runtime and storage

- Source: `apps/miniflux/`; Flux, HelmRelease, Deployment, and Service: `miniflux`.
- Pinned `app-template` chart and `ghcr.io/miniflux/miniflux` image; Renovate owns both version fields.
- One ARM64 replica on `${UTILITY_NODE_NAME}`, using `Recreate` upgrades.
- Requests: `50m` CPU / `128Mi` memory; limits: `500m` CPU / `512Mi` memory.
- UID/GID `65534`, read-only root filesystem, RuntimeDefault seccomp, no elevated capabilities.
- Startup/readiness use the database-aware `/healthcheck` on port `8080`;
  liveness uses `/liveness` to avoid restarting during a database outage.
- Two feed workers and a five-connection database pool.
- No HPA: the process owns the feed scheduler and polling workers, so replicas
  are fixed at one to avoid duplicate workers and overlapping startup migrations.
- All durable state lives in PostgreSQL; no application PVC is needed.

## Database and credentials

Database and role `miniflux` reuse `media-postgres.default.svc.cluster.local:5432`.
The `miniflux-database` pre-install/pre-upgrade hook idempotently provisions them
under an advisory lock. The role has an eight-connection ceiling and no superuser,
role/database creation, replication, or row-security bypass privileges. Only the
hook receives the existing PostgreSQL administrator credential; the app receives
its own connection URL. Installing Miniflux does not roll the shared database.

`infrastructure/secrets/default/miniflux-secret.yaml` is SOPS-managed:

| Key | Consumer and lifecycle |
| --- | --- |
| `POSTGRES_PASSWORD` | Database hook; keep the password in `DATABASE_URL` identical |
| `DATABASE_URL` | Miniflux runtime, restricted `miniflux` database role |
| `ADMIN_USERNAME` | Initial administrator bootstrap |
| `ADMIN_PASSWORD` | Initial administrator bootstrap; changing it does not reset an existing user |

Startup runs migrations and creates the administrator only if it does not already
exist. Password changes for an existing user belong in Miniflux settings or its
interactive `miniflux -reset-password` command; update the encrypted bootstrap
password to match if it should remain valid for disaster recovery. App-created
API tokens are optional and remain runtime-owned in PostgreSQL; they are not
Git-managed Secrets.

For database password rotation, update both database keys, reconcile `secrets`,
force the HelmRelease to rerun its hook, and restart the Deployment to reload its
environment. After a shared database rebuild, force the HelmRelease as well;
restarting only the pod does not run the provisioning hook.

The cert-manager-owned Certificate and TLS Secret `default/miniflux-tls` use
`letsencrypt-prod` for Ingress `miniflux` and hostname `rss.khzaw.dev`. TLS material
is separate from editable application credentials. The Secrets page inventories
only SOPS-managed objects and has no managed-TLS view; verify this certificate
and Secret's metadata through Kubernetes without exposing private keys.

The shared PostgreSQL volume has no repository-defined automated backup. Miniflux
subscriptions, articles, users, and settings share that existing recovery gap;
SOPS and OPML exports do not back up the complete database.

## Operator integrations

- Dynacat: RSS bookmark, Health monitor using the cluster-local `/healthcheck`,
  and upstream `miniflux/v2` release watcher.
- Control Panel: live image/chart update rows, editable SOPS credential inventory,
  and resource tuning. Managed TLS metadata uses Kubernetes as described above.
- Resource Advisor: mapped app-template release with normal maturity and safety
  gates for resource recommendations and apply PRs. Fixed replicas avoid HPA conflicts.
- Exposure Control: `miniflux` targets port `8080`; `share-miniflux.khzaw.dev`
  has DNS/tunnel plumbing and defaults to disabled with Cloudflare Access authentication.
  The canonical base URL stays `https://rss.khzaw.dev`; Miniflux-generated links
  and authentication redirects target that private origin even through a share.

## Verification

```bash
flux get kustomization miniflux -n flux-system
flux get helmrelease miniflux -n default
kubectl rollout status deployment/miniflux -n default --timeout=180s
kubectl get certificate miniflux-tls -n default
curl --fail https://rss.khzaw.dev/healthcheck
```

Verify login and a feed import/fetch, plus the actual dashboard and Control Panel
rows after refreshing inventory and running a fresh Resource Advisor report.

Upstream: [Docker deployment](https://miniflux.app/docs/docker.html),
[database setup](https://miniflux.app/docs/database.html), and
[configuration](https://miniflux.app/docs/configuration.html).
