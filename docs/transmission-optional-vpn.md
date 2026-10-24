---
title: Transmission Optional VPN Routing
summary: Current direct default, Gluetun scaffold, runtime-owned mode state, placeholders, and verification.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Transmission Optional VPN Routing

## Current State

Transmission runs direct by default. The HelmRelease includes a disabled Gluetun sidecar and a GitOps-owned control definition. The selected runtime mode is stored in `ConfigMap/default/transmission-vpn-state`, which is intentionally not owned by Flux.

The control panel can switch modes without patching the Flux-managed workload directly. The Gluetun Web UI remains available at `torrent-vpn.khzaw.dev` for diagnostics.

## Not Ready For Real VPN Traffic

The repository still marks the VPN configuration as a placeholder and contains documentation-only WireGuard endpoint/key material. Do not enable VPN mode until real provider or custom WireGuard values have been stored in the SOPS-managed `transmission-vpn-secret` and connectivity has been verified.

Edit the encrypted Secret with:

```bash
sops infrastructure/secrets/default/transmission-vpn-secret.yaml
```

## Ownership

- workload: `apps/transmission/helmrelease.yaml`
- GitOps control shape: `apps/transmission/transmission-vpn-control.yaml`
- runtime state: `default/transmission-vpn-state`
- cockpit API/UI: `apps/exposure-control/`

Do not add the runtime state ConfigMap to a Flux Kustomization. Flux ownership would fight operator mode changes.

## Routing Tradeoff

Use Gluetun's provider-native configuration when supported. Use custom WireGuard only when the provider requires explicit endpoint, public key, address, and allowed-IP material.

Changing to VPN mode affects egress identity and can break tracker reachability or port behavior. It must not change the dedicated Transmission peer-to-peer LoadBalancer ownership unintentionally.

## Verification

Before switching:

```bash
kubectl get secret transmission-vpn-secret -n default -o go-template='keys={{range $k, $_ := .data}} {{$k}}{{end}}{{"\n"}}'
kubectl get configmap transmission-vpn-state -n default -o yaml
kubectl get pod,svc -n default | grep transmission
```

After switching, verify the pod rollout, Gluetun health, Transmission UI, external egress IP from the Transmission network namespace, tracker connectivity, and rollback to direct mode.
