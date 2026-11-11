---
title: Live TV Services
summary: Current Nodecast TV and Tunarr deployment, storage, hardware access, and exposure contracts.
status: active
owner: homelab
last_reviewed: 2026-11-11
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

The HelmRelease bounds the embedded Meilisearch indexer to one thread and a
`512Mb` indexing-memory budget, with reduced-memory indexing enabled. Library
search remains available; scans and indexing may take longer. The indexing budget
is not a hard limit on Meilisearch or the whole pod: search queries, runtime
allocations, and memory-mapped index pages can use additional memory. Keep the
pod's resource limits separate from these indexing controls.

After changing these settings, inspect the Meilisearch process for
`--max-indexing-memory 512Mb`, `--max-indexing-threads 1`, and
`--experimental-reduce-indexing-memory-usage`. Verify library search and channel
inventory after startup; compare resource usage over representative indexing work
rather than treating a fresh process's lower memory as a sustained saving.

## Inventory

Use `flux/kustomization.yaml` to determine which workloads are desired state. A source directory or advisor mapping alone does not register a service with Flux.

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'nodecast|tunarr'
kubectl get pod,pvc,svc,ingress -n default | grep -E 'nodecast|tunarr'
```

Verify both services' reconciliation, persistent mounts, and hardware-accelerated playback.
