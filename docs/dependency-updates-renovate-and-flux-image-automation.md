---
title: Dependency Updates
summary: Current Renovate, Flux image automation, ownership boundaries, cadence, and verification.
status: active
owner: homelab
last_reviewed: 2026-11-13
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

- `kube-prometheus-stack` follows normal Renovate chart updates. Before a monitoring upgrade, verify the operator and config-reloader image indexes support both `linux/amd64` and `linux/arm64`, review chart/CRD changes, and verify the generated Prometheus and Alertmanager workloads as well as Helm readiness. Preserve placement and resource reservations unless separately validated.
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

### Scanner Storage And Upgrades

The scanner uses the Flux artifact-storage backend with `FluxStorage=true`, enabled explicitly on image-reflector-controller `v1.2.5`. Controller and CRD ownership is documented in [Flux controller maintenance](./flux-web-ui.md#flux-controller-manifest). The `/data` emptyDir is a derived tag cache, not application storage. A restart or backend switch rebuilds it by rescanning the registries; neither action changes the declared three/six-hour intervals or per-app writer ownership.

Before a cache-rebuilding upgrade, capture the six selected policy image references, scan results, Git image tags, and original suspension states. Temporarily suspend the owning `image-automation` Kustomization first, then each ImageUpdateAutomation, and verify no writer reconciliation is still running. Leave repository/policy reconciliation enabled so the new scanner can rebuild. This prevents registry discoveries during the rebuild from immediately promoting application images.

Use `flux suspend`, which records the suspension under Flux CLI field ownership. Ordinary `kubectl patch` ownership can be removed by the parent Kustomization's server-side apply, silently resuming both the child Kustomization and its writers. After confirming the namespace contains exactly the six expected writers:

```bash
flux suspend kustomization image-automation -n flux-system
flux suspend image update --all -n flux-system
flux reconcile kustomization flux-system -n flux-system
kubectl get kustomization image-automation -n flux-system -o jsonpath='{.spec.suspend}{"\n"}'
kubectl get imageupdateautomations -n flux-system -o custom-columns=NAME:.metadata.name,SUSPENDED:.spec.suspend
```

Require the child and all six writers to remain suspended after this parent reconciliation and immediately before applying the scanner change. Restore with `flux resume` only for objects that were originally active.

Require fresh successful scans for all six repositories and Ready policies after rollout. Compare their selected tags with the captured references and Git before restoring writers; investigate any change rather than treating a successful scan as proof of an unchanged promotion. Restore only suspensions introduced by the maintenance, reconcile each restored writer, and require Ready/up-to-date conditions. Restore and reconcile the owning Kustomization too. Check the intervals, update paths, and Git branch/commit settings remain unchanged.

Measure scanner CPU with `rate(container_cpu_usage_seconds_total{namespace="flux-system",container="manager",pod=~"image-reflector-controller-.*",metrics_path="/metrics/cadvisor"}[15m])` after startup and rescanning settle. Compare equally sized baseline and post-upgrade windows on the same node. Do not sum the duplicate `/metrics/resource` series into this measurement, or translate reduced CPU time into measured electricity savings.

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
