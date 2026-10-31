---
title: Dependency Updates
summary: Current Renovate, Flux image automation, ownership boundaries, cadence, and verification.
status: active
owner: homelab
last_reviewed: 2026-10-31
---

# Dependency Updates

## Renovate

- configuration: `renovate.json`
- workflow: `.github/workflows/renovate.yaml`
- execution: GitHub Actions every six hours
- PR concurrency and hourly creation limits: seven

Renovate owns normal chart, image, GitHub Actions, and other declared dependency updates except where package/path rules delegate ownership or intentionally pin a dependency.

The two AdGuard releases use file-specific branches because they are separate rollout units. Self-built image tags are excluded or package-disabled where Flux image automation owns promotion.

Do not infer Renovate failure from the control panel update count. The control panel compares live workload images with registry tags; Renovate compares Git declarations under manager, versioning, ignore, and PR-limit policy.

## Versioning Constraints

- LinuxServer build suffixes must remain orderable. Jellyfin accepts stable two- or three-component app versions, numeric Ubuntu base versions, and LinuxServer rebuild numbers; base transitions are reviewable updates rather than compatibility locks.
- Jackett tracks `linuxserver/docker-jackett` packaging releases through an inline custom-manager hint, converting their tags to the image's three-component app version. Packaging releases follow the multiarch image push; upstream `Jackett/Jackett` releases can precede publication and must not drive deployments. Its Docker datasource is disabled because the registry's large history makes lookup incomplete.
- Keep the intentionally pinned Flaresolverr image exception and the separate AdGuard rollout branches. Check `renovate.json` and inline hints before changing a tag representation or release source.

## Flux Image Automation

Source: `infrastructure/image-automation/`.

Current independently owned flows:

- Blog
- MMCal
- Erica Knight
- Interview Prep
- Retirement
- Rangoon Mapper

Each app has its own ImageRepository, ImagePolicy, and ImageUpdateAutomation writer. Interview Prep currently scans and writes every three hours; the other five use six hours.

There is no shared `image-update-automation.yaml`. Inspect the per-app objects.

## Ownership Decision

Before changing a version, determine whether it is controlled by:

- Renovate
- Flux image automation
- a Helm chart version
- a manual image pin or compatibility exception
- a generated controller manifest

Do not make two systems own the same field.

## Verification

```bash
flux get image repository -A
flux get image policy -A
flux get image update -A
kubectl kustomize flux >/tmp/rangoonpulse-flux-rendered.yaml
```

After image automation runs, fetch and fast-forward `master` before reporting because the controller may have committed the selected tag remotely.
