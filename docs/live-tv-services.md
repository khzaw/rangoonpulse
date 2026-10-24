---
title: Live TV Services
summary: Current Nodecast TV and Tunarr deployment, storage, hardware access, and exposure contracts.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Live TV Services

## Active Services

### Nodecast TV

- source: `apps/nodecast-tv/`
- state: node-local SQLite
- hardware: `/dev/dri` access for media acceleration
- security exception: privileged/container device access required by the workload

The local SQLite choice gives predictable latency but makes the service node-affined. No repository-defined automated backup exists.

### Tunarr

- source: `apps/tunarr/`
- state: `truenas-nfs`
- hardware: Intel VAAPI through `/dev/dri`
- security exception: privileged/container device access required by media processing
- temporary public share: fully wired through exposure-control and public-edge

Tunarr's NFS-backed application state is relocatable, but active media processing still depends on compatible node hardware.

## Dormant Source

`apps/ersatztv/` and `flux/kustomizations/ersatztv.yaml` remain in the tree, but ErsatzTV is not included by `flux/kustomization.yaml` and is not current desired state. Do not document or operate it as a live service.

Resource Advisor still contains an ErsatzTV mapping. Treat it as dead policy until the dormant service is either deliberately restored or removed from code.

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'nodecast|tunarr|ersatz'
kubectl get pod,pvc,svc,ingress -n default | grep -E 'nodecast|tunarr|ersatz'
```

Current expected result: Nodecast TV and Tunarr are reconciled; ErsatzTV is absent from active Flux state.
