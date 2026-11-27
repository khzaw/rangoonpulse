---
title: Documentation Site
summary: Starlight documentation portal built from docs/ and served at rangoonpulse.khzaw.dev/docs/.
status: active
owner: homelab
last_reviewed: 2026-11-27
---

# Documentation Site

The browsable documentation site serves the Markdown guides in `docs/` at **https://rangoonpulse.khzaw.dev/docs/**. It uses the private ingress VIP on LAN and Tailscale and shares the `rangoonpulse.khzaw.dev` origin with [Dynacat](./dashboards-dynacat.md).

## Source And Sync Pipeline

`docs/` remains the single source of truth for GitHub browsing, agent sessions, and `make check-docs`. `docs-site/` renders it without moving or restructuring any file in `docs/`:

- `docs-site/scripts/sync-docs.mjs`: reads tracked Markdown and diagram images from `docs/`, maps existing `title`, `summary`, and `last_reviewed` frontmatter (plus Git commit dates when available), rewrites local doc and repository links, copies diagram images into the build output, and generates `src/generated/sidebar.json` from the section order in [`docs/README.md`](./README.md).
- `docs-site/astro.config.mjs`: configures Astro + Starlight with `base: "/docs"`, Pagefind full-text search, rangoonpulse styling (`docs-site/src/styles/rangoonpulse.css`), and `starlight-links-validator` to fail builds on broken internal links or anchors.
- `docs-site/Dockerfile` and `docs-site/nginx.conf`: builds the static bundle once on `$BUILDPLATFORM` and packages it into a multi-architecture `nginxinc/nginx-unprivileged` image serving `/docs/`, `/healthz`, and a `/` to `/docs/` redirect.

Local development and build commands:

```bash
make docs-dev    # live sync from docs/ + Astro dev server
make docs-build  # sync docs/, build dist/, and validate internal links
```

## GitOps, Ingress, And Image Promotion

- Application manifests: `apps/docs/helmrelease.yaml` and `apps/docs/kustomization.yaml`
- Flux Kustomization: `flux/kustomizations/docs.yaml` (depends on `ingress-nginx` and `dynacat`)
- CI image workflow: `.github/workflows/docs-site.yaml` builds on pull requests and publishes `ghcr.io/khzaw/rangoonpulse-docs:<unix_ts>-<sha>` on pushes to `master` touching `docs/**` or `docs-site/**`
- Flux image automation: `infrastructure/image-automation/docs-*` scans GHCR every hour and commits tag updates back to `apps/docs/helmrelease.yaml`
- Renovate (`renovate.json`): tracks the `app-template` chart and `docs-site/Dockerfile` base images while leaving `ghcr.io/khzaw/rangoonpulse-docs` to Flux image automation

To promote a newly built docs image immediately:

```bash
make deploy-docs
```

The same deployment action is available at `controlpanel.khzaw.dev/#deploy`.

### Shared Hostname Contract

`apps/docs/helmrelease.yaml` attaches an `ingress-nginx` Ingress for `rangoonpulse.${BASE_DOMAIN}` on `path: /docs` (`pathType: Prefix`) referencing the existing `dynacat-tls` Secret.

- `apps/dynacat` remains the sole owner of ExternalDNS (`rangoonpulse.${BASE_DOMAIN}`) and the cert-manager `Certificate` (`dynacat-tls`). Do not add `external-dns` or `cert-manager` annotations to the `docs` Ingress.
- `ingress-nginx` merges both Ingress resources under one server block, routing `/docs` and `/docs/*` to the `docs` Service and leaving `/` and `/api/*` on Dynacat.

## Exposure, Resources, And Credentials

- **Temporary share**: disabled-by-default share `share-docs.khzaw.dev` is wired in `apps/exposure-control/services.json`, `infrastructure/public-edge/helmrelease.yaml`, and `infrastructure/public-edge/share-hosts-cname.yaml`. Canonical access remains private.
- **Placement and scaling**: pinned to `${UTILITY_NODE_NAME}` with `RollingUpdate` (`maxSurge: 1`, `maxUnavailable: 0`), `readOnlyRootFilesystem: true`, bounded `emptyDir` mounts at `/tmp` and `/var/cache/nginx`, requests `25m` CPU / `64Mi` memory, and limits `100m` CPU / `128Mi` memory. No HPA is configured because a single static nginx container serves private homelab traffic comfortably within those bounds.
- **Resource Advisor**: registered in `APP_TEMPLATE_RELEASE_FILE_MAP` in `infrastructure/resource-advisor/advisor.py`.
- **Application credentials**: none. The app serves static documentation from a public GHCR image.
- **Managed TLS metadata**: reuses cert-manager Certificate `dynacat-tls` (`default` namespace, `letsencrypt-prod` issuer, owned by `apps/dynacat/certificate.yaml`).

## Verification

```bash
flux get kustomization docs -n flux-system
kubectl get helmrelease docs -n default
kubectl rollout status deployment/docs -n default --timeout=180s
curl -fsS -o /dev/null -w '%{http_code}\n' https://rangoonpulse.khzaw.dev/docs/
curl -fsS -o /dev/null -w '%{http_code}\n' https://rangoonpulse.khzaw.dev/api/healthz
```
