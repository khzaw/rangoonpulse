---
title: Flux Operator Web UI
summary: Current private and temporary-share access, source ownership, controller-manifest caveat, and verification.
status: active
owner: homelab
last_reviewed: 2026-10-25
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

`flux/flux-system/gotk-components.yaml` is generated from Flux `v2.8.8`. The ordinary root Kustomization reconciles `./flux`, but does not include the nested `flux/flux-system/` directory. Updating the generated file alone therefore does not upgrade live controllers.

Controller upgrades are controlled operator actions:

1. check the target Flux/Kubernetes compatibility
2. run `flux migrate`
3. regenerate `gotk-components.yaml` with the target Flux version
4. inspect the diff
5. apply the generated controller manifest explicitly
6. commit the generated source
7. verify every controller image and Flux API condition

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
