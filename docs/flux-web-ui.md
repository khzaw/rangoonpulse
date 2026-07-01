# Flux Web UI

## Purpose

`fluxui.khzaw.dev` runs the ControlPlane Flux Operator web UI. It gives a browser view over Flux sources, Kustomizations, HelmReleases, controller status, and GitOps reconciliation state.

## Source of Truth

- Helm repository: `flux/repositories/controlplaneio-fluxcd.yaml`
- Helm release: `infrastructure/flux-operator/helmrelease.yaml`
- Flux wiring: `flux/kustomizations/flux-operator.yaml`
- Dashboard breadcrumbs: `apps/glance/helmrelease.yaml`

## Access Path

- Hostname: `https://fluxui.khzaw.dev`
- Ingress class: `nginx`
- DNS publisher: `external-dns`
- TLS issuer: `letsencrypt-prod`
- In-cluster service: `http://flux-operator.flux-system.svc.cluster.local:9080`

This follows the normal private `*.khzaw.dev` model: public DNS points at the private ingress VIP, so access is intended for LAN or Tailscale clients, not arbitrary public internet.

## Versioning

Flux controllers are currently generated from `flux install --version=v2.8.8` because Flux `v2.9.0` requires Kubernetes `>=1.33`, while the cluster is on Kubernetes `v1.32.3`. Upgrade Flux past `v2.8.x` only after the cluster is upgraded.

The generated controller manifest lives at `flux/flux-system/gotk-components.yaml`, but the live `flux-system` Kustomization reconciles `./flux` and does not currently include `flux/flux-system/`. Treat Flux controller upgrades as a controlled operator action:

```bash
flux migrate
flux install --version=v2.8.8 --components=source-controller,kustomize-controller,helm-controller,notification-controller,image-reflector-controller,image-automation-controller --export > flux/flux-system/gotk-components.yaml
kubectl apply -f flux/flux-system/gotk-components.yaml
```

The web UI is provided by `controlplaneio-fluxcd/flux-operator` chart `0.53.0`.

## Verification

```bash
flux get kustomization flux-operator -n flux-system
kubectl get hr flux-operator -n flux-system
kubectl rollout status deployment/flux-operator -n flux-system --timeout=180s
kubectl get ingress flux-operator -n flux-system
kubectl get certificate fluxui-tls -n flux-system

dig @1.1.1.1 +short fluxui.khzaw.dev
curl -Ik --max-time 20 https://fluxui.khzaw.dev
```

If DNS is stale but ingress is ready, separate DNS propagation from app health:

```bash
curl -Ik --resolve fluxui.khzaw.dev:443:10.0.0.231 https://fluxui.khzaw.dev
```
