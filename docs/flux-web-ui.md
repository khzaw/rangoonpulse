---
title: Flux Operator Web UI
summary: Current private and temporary-share access, source ownership, controller-manifest caveat, and verification.
status: active
owner: homelab
last_reviewed: 2026-11-04
---

# Flux Operator Web UI

`fluxui.khzaw.dev` exposes the ControlPlane Flux Operator UI for Flux sources, Kustomizations, HelmReleases, and controller status.

## Source Of Truth

- Helm source: `flux/repositories/controlplaneio-fluxcd.yaml`
- release: `infrastructure/flux-operator/helmrelease.yaml`
- Flux: `flux/kustomizations/flux-operator.yaml`
- dashboard link: `apps/dynacat/helmrelease.yaml`

Chart versions are authoritative in the HelmRelease.

## Access

The canonical hostname uses the private ingress path and is intended for LAN or Tailscale clients. `share-fluxui.khzaw.dev` is fully wired through exposure-control and public-edge for temporary access with Cloudflare Access mode.

## Flux Controller Manifest

`flux/flux-system/gotk-components.yaml` has a Flux `v2.8.8` base with one component override: image-reflector-controller `v1.2.5` and its matching ImageRepository/ImagePolicy CRDs from Flux `v2.9.6`. The scanner explicitly enables `--feature-gates=FluxStorage=true`. Its tag cache uses Flux artifact storage on the existing `/data` emptyDir; no PVC or application data is involved.

This keeps the scanner within Flux's [supported one-minor controller skew](https://fluxcd.io/flux/releases/#supported-releases), while avoiding a coordinated controller upgrade for the storage optimization. The remaining five controller images, shared RBAC, resource requests, and placement are unchanged. A scanner from Flux `v2.10` would exceed that skew against the `v2.8` base; upgrade the distribution coherently before moving to that line.

The ordinary root Kustomization reconciles `./flux`, but does not include the nested `flux/flux-system/` directory. Updating the generated file alone therefore does not upgrade live controllers. The Flux Operator provides the UI; there is no FluxInstance managing controller versions.

### Regeneration

Use the matching Flux CLI to regenerate the base with both image components:

```bash
flux install --version=v2.8.8 \
  --components-extra=image-reflector-controller,image-automation-controller \
  --export > /tmp/flux-base.yaml
```

Reapply the component override before replacing the tracked manifest: import the two CRD specs and annotations from the checksum-verified `image-reflector-controller.crds.yaml` release asset for `v1.2.5`, preserve installation labels, and set their version label to `v2.9.6`. Set only the scanner Deployment's image to `ghcr.io/fluxcd/image-reflector-controller:v1.2.5`, add `--feature-gates=FluxStorage=true`, and set its deployment/pod version labels to `v2.9.6`. Preserve its existing arguments, environment, security context, resources, and volumes. Keep the manifest header's override provenance. Inspect the rendered diff against both Git and live state; do not replace this composed manifest with an unmodified base export.

The scanner's `v1` schemas match the existing APIs apart from a description correction; `v1beta2` is no longer served. All three image CRDs must have only `v1` in `status.storedVersions` before removing beta schemas. Shared RBAC remains compatible; the scanner does not need a new permission for artifact storage.

Controller upgrades are controlled operator actions:

1. check target Flux/Kubernetes compatibility, controller skew, architecture support, and release notes
2. inspect every Flux CRD's stored versions and run `flux migrate` before removing deprecated versions; check Git manifests with `flux migrate -f <path> --dry-run`
3. regenerate the affected objects, retaining the component override unless the target release supersedes it
4. render and inspect the diff, run capacity checks and a server-side dry run, then run `make validate-all`
5. publish the exact source changes; for a scanner cache rebuild, suspend the `image-automation` Kustomization and the six writers temporarily as described in [dependency updates](./dependency-updates-renovate-and-flux-image-automation.md)
6. explicitly apply the affected objects from the published manifest with the normal agent context; a scanner-only update needs only its Deployment and two CRDs, not `gotk-sync.yaml`
7. verify rollout, image digests, fresh registry scans, selected tags, and all Flux Kustomization/HelmRelease conditions; restore the prior writer/Kustomization suspension states
8. compare steady-state cAdvisor CPU windows after rescanning settles, check service endpoints, and remove temporary renders/downloads

Check current Flux and Kubernetes release requirements when upgrading.

## Verification

```bash
flux get kustomization flux-operator -n flux-system
kubectl get hr flux-operator -n flux-system
kubectl rollout status deployment/flux-operator -n flux-system --timeout=180s
kubectl get ingress,certificate -n flux-system
flux version
curl -Ik https://fluxui.khzaw.dev/
```
