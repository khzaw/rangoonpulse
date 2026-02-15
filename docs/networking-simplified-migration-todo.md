# Migration TODO: Unified LAN IP Access over Tailscale

This checklist is designed to migrate from the current dual-path model to a unified destination model, while preserving outside access at all times.

## Phase 0 - Preflight and Safety
- [ ] Confirm non-negotiables:
  - [ ] `*.khzaw.dev` must work on LAN.
  - [ ] `*.khzaw.dev` must work remotely when connected to Tailscale.
  - [ ] NAS access is priority (`10.0.0.210`).
- [ ] Record current known-good endpoints:
  - [ ] Ingress VIP: `10.0.0.231`
  - [ ] Tailscale ingress proxy IP: `100.107.172.81`
  - [ ] Tailscale DNS host: `homelab-dns` (`100.78.49.35`)
- [ ] Prepare a rollback window and test device outside LAN.

## Phase 1 - Introduce Subnet Routing (No Traffic Cutover Yet)
- [ ] Use Kubernetes Tailscale `Connector` as the subnet router (selected approach).
- [ ] Advertise host routes first (not full `/24`):
  - [ ] `10.0.0.231/32` (k8s ingress)
  - [ ] `10.0.0.210/32` (NAS)
  - [ ] `10.0.0.1/32` (router)
- [ ] Approve subnet routes in Tailscale admin, or configure `autoApprovers` for router tags.
- [ ] Verify from remote Tailscale client:
  - [ ] Can ping or TCP-connect to `10.0.0.231`.
  - [ ] Can reach `10.0.0.210`.
  - [ ] Can reach `10.0.0.1`.

## Phase 2 - DNS Alignment to Unified Destination
- [ ] Ensure Cloudflare records for app hostnames resolve to `10.0.0.231`.
- [ ] Add explicit records:
  - [ ] `nas.khzaw.dev -> 10.0.0.210`
  - [ ] `router.khzaw.dev -> 10.0.0.1`
- [ ] Reduce DNS TTL temporarily during migration.
- [ ] Confirm from remote Tailscale client DNS answers are LAN IPs, not `100.107.172.81`.

## Phase 3 - Validation Before Decommissioning Old Path
- [ ] LAN tests:
  - [ ] `https://hq.khzaw.dev`
  - [ ] `https://photos.khzaw.dev`
  - [ ] `https://jellyfin.khzaw.dev`
  - [ ] `https://nas.khzaw.dev` (or HTTP if TLS not configured)
- [ ] Remote Tailscale tests (outside LAN):
  - [ ] Same app URLs work.
  - [ ] NAS URL works.
  - [ ] Router URL works.
- [ ] Confirm no service is still logically dependent on Tailscale ingress proxy IP.

## Phase 4 - Decommission Legacy Tailscale Proxy Path
- [ ] Remove `tailscale.com/expose: "true"` from ingress-nginx service patch.
- [ ] Remove custom Tailscale CoreDNS wildcard mapping (`*.khzaw.dev -> 100.107.172.81`).
- [ ] Reconcile Flux and verify no regression.
- [ ] Confirm tailscale namespace no longer contains:
  - [ ] `ts-ingress-nginx-controller-*` statefulset
  - [ ] `coredns-tailscale` deployment/service (if no longer needed)

## Phase 5 - Post-Migration Hardening
- [ ] Keep at least one stable subnet router for high availability needs.
- [ ] Decide whether to keep only `/32` routes or expand to `/24`.
- [ ] Document final architecture and dependencies.
- [ ] Add periodic checks:
  - [ ] DNS resolution consistency.
  - [ ] Subnet route availability in tailnet.

## Rollback Checklist
Use this only if remote access breaks.

- [ ] Re-enable ingress `tailscale.com/expose` annotation.
- [ ] Re-enable Tailscale CoreDNS wildcard mapping to `100.107.172.81`.
- [ ] Reconcile Flux.
- [ ] Confirm remote access restored.
- [ ] Re-run root cause analysis before retrying migration.
