---
title: Repository Architecture Map
summary: Current source-of-truth map for cluster configuration, workloads, platform services, and operator guidance.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Repository Architecture Map

## Source Layout

### `apps/`

User-facing workloads. Most services use:

- `apps/<name>/helmrelease.yaml`
- `apps/<name>/kustomization.yaml`
- `flux/kustomizations/<name>.yaml`

A service change may also affect Dynacat, exposure-control, public-edge routing, image automation, resource-advisor policy, and a focused current-state doc.

### `core/`

Cluster-wide primitives whose behavior affects many workloads. `core/ingress-nginx/` currently owns the shared ingress controller patches and VIP wiring.

### `infrastructure/`

Shared platform services, including storage, monitoring, DNS, ingress-adjacent routing, secrets, Tailscale, public edge, image automation, Flux Operator, and resource advisor.

Treat the implementation here as authoritative. Focused docs explain only the operating contract and non-obvious constraints that cannot be read safely from one manifest.

### `flux/`

Flux sources, reconciliation units, and post-build substitutions:

- `flux/kustomization.yaml`: repository reconciliation tree
- `flux/kustomizations/*.yaml`: component reconciliation boundaries and dependencies
- `flux/repositories/`: Helm and OCI sources
- `flux/cluster-settings.yaml`: shared non-secret constants
- `flux/flux-system/gotk-components.yaml`: generated Flux controller manifest

The generated controller manifest is not part of the ordinary workload reconciliation path. Controller upgrades are controlled operator actions; application and infrastructure desired state remains GitOps-managed.

### `talos/`

Talos configuration templates and node-level patches. Talos lifecycle operations are separate from Flux reconciliation. Sensitive generated machine configurations are not committed.

### `native/iris/`

macOS launchd supervision, Darwin metrics/readiness, and independent cluster sentinel implementation. Native host jobs have separate lifecycle and credential-copy handling; see `docs/iris-operations.md`.

### `docs/`

Current operating guidance only. `docs/README.md` is the router. Superseded designs and completed work remain available through Git history rather than active docs.

### `.agents/skills/`

Repeatable repository procedures and safety gates. Skills should inspect current manifests and route to focused docs rather than duplicate inventories that drift.

## Current Access Topology

Three paths are intentional:

1. Private services: LAN or Tailscale client to the shared ingress VIP, then ingress-nginx to the service.
2. Permanently public sites: Cloudflare edge and Tunnel directly to in-cluster services.
3. Temporary public shares: Cloudflare edge and Tunnel to exposure-control, which enforces share state and proxies to the selected service.

`iris.khzaw.dev` and `athena.khzaw.dev` proxy from Kubernetes to services on the Mac mini. SSH for the Iris host uses a dedicated MetalLB VIP. The concrete values live in `flux/cluster-settings.yaml`; the current topology and exceptions live in the focused networking and access docs.

## Current Storage Model

- `truenas-nfs` is the default relocatable storage class for file-oriented and ordinary persistent data.
- `truenas-hdd-media` and `truenas-nvme-downloads` serve large media and download datasets.
- `local-path` is intentionally used for latency-sensitive databases, SQLite workloads, Prometheus/Grafana state, and caches that cannot safely use NFS semantics.

`local-path` is node-affined. Moving or recovering those workloads requires an explicit data path; changing only a node selector is not a migration.

## Cross-Cutting Change Checklist

Before completing a service or platform change, inspect the applicable surfaces:

- `flux/kustomizations/` and `flux/kustomization.yaml`
- `apps/dynacat/helmrelease.yaml`
- `apps/exposure-control/services.json`
- `infrastructure/public-edge/`
- `infrastructure/image-automation/`
- `infrastructure/resource-advisor/`
- ingress, DNS ownership, and TLS objects
- the focused current-state doc and repo-local skill

Not every change touches every surface. The requirement is to check, not to create ceremonial edits.

## Navigation

1. Read `AGENTS.md`, `README.md`, and `docs/README.md`.
2. Load the shared-worktree skill.
3. Read the smallest focused doc set for the affected domain.
4. Inspect the current implementation before trusting copied values or inventories.

See `docs/knowledge-base-conventions.md` for the maintenance rule.
