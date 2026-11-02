---
title: Live TV Services
summary: Current Nodecast TV and Tunarr deployment, storage, hardware access, and exposure contracts.
status: active
owner: homelab
last_reviewed: 2026-11-02
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

## Inventory

Use `flux/kustomization.yaml` to determine which workloads are desired state. A source directory or advisor mapping alone does not register a service with Flux.

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'nodecast|tunarr'
kubectl get pod,pvc,svc,ingress -n default | grep -E 'nodecast|tunarr'
```

Verify both services' reconciliation, persistent mounts, and hardware-accelerated playback.
