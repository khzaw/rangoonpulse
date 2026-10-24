---
title: Interview Prep
summary: Current private access, image promotion, SQLite persistence, and recovery contract for ITVP.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Interview Prep

Interview Prep is the single-user practice journal at `itvp.khzaw.dev`.

## Access

The canonical hostname uses the private shared-ingress path for LAN and Tailscale clients. `share-itvp.khzaw.dev` is a fully wired temporary public share and is disabled by default.

## Runtime

- source/image: `khzaw/interview-prep` and `ghcr.io/khzaw/interview-prep`
- GitOps: `apps/interview-prep/` and `flux/kustomizations/interview-prep.yaml`
- placement: primary node
- port/health: `3000` and `/api/health`
- rollout: one replica with `Recreate`

The server renders the workspace bootstrap and needs burst CPU headroom. Exact resources remain authoritative in the HelmRelease.

## Image Promotion

The ImageRepository and per-app ImageUpdateAutomation currently run every three hours. Other self-built flows normally run every six hours.

Deploy immediately after the GHCR image is published:

```bash
make deploy-itvp
```

Or use the ITVP card at `controlpanel.khzaw.dev/#deploy`.

## Persistence

The versioned workspace lives in `/data/interview-prep.sqlite` on a 1Gi `local-path` PVC. SQLite is intentionally not on NFS because WAL and lock traffic need local latency and filesystem semantics.

The PVC is node-affined. Moving the workload requires an explicit data move or logical restore; changing only the node selector is unsafe.

## Backup And Recovery

- logical backup: application JSON export
- physical recovery: stop the workload and preserve a WAL-consistent SQLite set
- repository-defined automated backup: none

Do not copy only the main database while the app is running.

## Verification

```bash
flux get kustomization interview-prep -n flux-system
kubectl get pod,pvc,ingress -n default | grep interview-prep
curl -I https://itvp.khzaw.dev/api/health
```
