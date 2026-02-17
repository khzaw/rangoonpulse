# Migration TODO: Unified LAN IP Access over Tailscale

> Status: Completed. This file is kept as an audit + rollback checklist.

The repository baseline is now the unified destination model:
- App hostnames resolve to ingress VIP `10.0.0.231` (MetalLB).
- `nas.khzaw.dev` / `router.khzaw.dev` also resolve to `10.0.0.231` and are proxied by ingress to LAN IPs via
  selectorless `Service` + `Endpoints` (`infrastructure/lan-gateway/`) so TLS terminates at ingress.
- Remote tailnet clients reach the same `10.0.0.x` destinations via the Tailscale `Connector` subnet router
  (`infrastructure/tailscale-subnet-router/connector.yaml`).

## Phase 0 - Preflight and Safety
- [x] Confirm non-negotiables:
  - [x] `*.khzaw.dev` must work on LAN.
  - [x] `*.khzaw.dev` must work remotely when connected to Tailscale.
  - [x] NAS access is priority (`10.0.0.210`).
- [x] Record current known-good endpoints:
  - [x] Ingress VIP: `10.0.0.231`
  - [x] NAS: `10.0.0.210`
  - [x] Router: `10.0.0.1`
- [x] Prepare a rollback window and test device outside LAN.

## Phase 1 - Introduce Subnet Routing (No Traffic Cutover Yet)
- [x] Use Kubernetes Tailscale `Connector` as the subnet router (selected approach).
- [x] Advertise host routes first (not full `/24`):
  - [x] `10.0.0.197/32` (Talos node / Kubernetes API)
  - [x] `10.0.0.231/32` (k8s ingress)
  - [x] `10.0.0.210/32` (NAS)
  - [x] `10.0.0.1/32` (router)
- [x] Approve subnet routes in Tailscale admin, or configure `autoApprovers` for router tags.
- [x] Verify from remote Tailscale client:
  - [x] Can ping or TCP-connect to `10.0.0.231`.
  - [x] Can reach `10.0.0.210`.
  - [x] Can reach `10.0.0.1`.

## Phase 2 - DNS Alignment to Unified Destination
- [x] Ensure Cloudflare records for app hostnames resolve to `10.0.0.231`.
- [x] Ensure NAS/router hostnames resolve to `10.0.0.231` (ingress) and proxy to LAN devices behind ingress.
- [ ] Reduce DNS TTL temporarily during migration (optional; only needed for future DNS cutovers).
- [x] Confirm from remote Tailscale client DNS answers are LAN IPs (no Tailscale proxy IP indirection).

## Phase 3 - Validation Before Decommissioning Old Path
- [x] LAN tests:
  - [x] `https://hq.khzaw.dev`
  - [x] `https://photos.khzaw.dev`
  - [x] `https://jellyfin.khzaw.dev`
  - [x] `https://nas.khzaw.dev`
- [x] Remote Tailscale tests (outside LAN):
  - [x] Same app URLs work.
  - [x] NAS URL works.
  - [x] Router URL works.
- [x] Confirm no service is still logically dependent on a Tailscale ingress proxy IP.

## Phase 4 - Decommission Legacy Tailscale Proxy Path
- [x] Remove `tailscale.com/expose: "true"` from ingress-nginx service patch.
- [x] Remove custom Tailscale CoreDNS wildcard mapping (`*.khzaw.dev -> <proxy IP>`).
- [x] Reconcile Flux and verify no regression.
- [x] Confirm tailscale namespace no longer contains:
  - [x] `ts-ingress-nginx-controller-*` statefulset
  - [x] `coredns-tailscale` deployment/service

## Phase 5 - Post-Migration Hardening
- [x] Keep at least one stable subnet router for high availability needs.
- [x] Decide whether to keep only `/32` routes or expand to `/24`.
- [x] Document final architecture and dependencies.
- [ ] Add periodic checks:
  - [ ] DNS resolution consistency.
  - [ ] Subnet route availability in tailnet.

## Rollback Checklist
Use this only if remote access breaks.

- [ ] Re-introduce ingress `tailscale.com/expose` annotation (legacy model).
- [ ] Re-introduce Tailscale DNS wildcard mapping to a proxy IP (legacy model).
- [ ] Reconcile Flux.
- [ ] Confirm remote access restored.
- [ ] Re-run root cause analysis before retrying migration.
