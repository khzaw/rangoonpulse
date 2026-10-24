---
title: Static-Site Deployment
summary: Current build, image promotion, public-edge ownership, rollback, and verification contract for self-built sites.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Static-Site Deployment

## Blog Contract

- workload source: `apps/blog/`
- image promotion: `infrastructure/image-automation/blog-*`
- image policy/writer interval: 6 hours
- public origins: `khzaw.dev` and `blog.khzaw.dev`
- private ingress: `blog.khzaw.dev`
- public routing: Cloudflare Tunnel directly to the Blog Service

The private Blog Ingress deliberately does not own ExternalDNS. Public DNS is owned by `infrastructure/public-edge/share-hosts-cname.yaml`; adding an app Ingress DNS annotation would publish the private ingress VIP and conflict with the public path.

The apex and Blog hostname are permanently public and do not pass through exposure-control.

## Promotion Chain

```text
source repository push
  -> CI publishes immutable GHCR image
  -> Flux ImageRepository scans registry
  -> ImagePolicy selects newest eligible tag
  -> ImageUpdateAutomation commits the tag to rangoonpulse
  -> Flux source and app Kustomization reconcile
  -> Deployment rolls out exact image
```

Normal promotion is asynchronous. To request it immediately after the image is published:

```bash
make deploy-blog
```

The same action is available from `controlpanel.khzaw.dev/#deploy`.

Other self-built image-automated targets are MMCal, Erica Knight, Interview Prep, Retirement, and Rangoon Mapper. Their exact intervals and public/private paths are authoritative in `infrastructure/image-automation/` and each app manifest.

## Rollback

Rollback by reverting the pinned image tag in Git. Do not patch the live Deployment image; Flux will overwrite it.

After reverting, reconcile the source and app Kustomization and verify the exact running image.

Coordinate the ImagePolicy/writer so automation does not immediately promote the reverted tag again. Keep a durable pin or policy change in Git when required, and restore normal promotion deliberately after verifying recovery.

## External Cloudflare State

`www.khzaw.dev` redirect behavior and cache policy are external Cloudflare configuration. They are not proven by Git. Verify them separately when changing public-site routing or deployment behavior.

## Verification

```bash
flux get image repository -A | grep blog
flux get image policy -A | grep blog
flux get image update -A | grep blog
flux get kustomization blog -n flux-system
kubectl rollout status deployment/blog -n default --timeout=180s
kubectl get deployment blog -n default -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
dig @1.1.1.1 +short khzaw.dev
curl -I https://khzaw.dev/
curl -I https://blog.khzaw.dev/
```

A published image is not deployed until the policy, Git commit, Flux revision, workload image, and public response all agree.
