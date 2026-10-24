---
title: Public Edge and Exposure Control
summary: Current permanent-public and temporary-share routing, ownership, state, and emergency controls.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Public Edge and Exposure Control

## Ownership

The public edge is split deliberately:

- `infrastructure/public-edge/helmrelease.yaml`: Cloudflare Tunnel process and hostname-to-origin routes
- `infrastructure/public-edge/share-hosts-cname.yaml`: proxied public DNS aliases
- `apps/exposure-control/services.json`: services the cockpit can target
- `apps/exposure-control/helmrelease.yaml`: control-plane runtime, persistence, ingress, and configuration
- `apps/exposure-control/server.js`: share state, expiry, auth-presence, rate limiting, proxying, and operator APIs

There is no `PublicExposure` CRD or separate exposure controller. Public routes and DNS are static GitOps inventory. Exposure-control owns runtime enabled/disabled state.

## Permanent-Public Sites

The Tunnel routes the `khzaw.dev` apex, Blog, MMCal, Rangoon Mapper, and Erica Knight hostnames directly to their in-cluster services. These paths bypass exposure-control.

Permanent-public DNS aliases are declared in `share-hosts-cname.yaml`. Cloudflare redirect, Access, WAF, and cache policies not represented in this repository must be verified in Cloudflare separately.

## Temporary Shares

A temporary share follows:

```text
share host -> Cloudflare -> Tunnel -> exposure-control -> target Service
```

A service is fully share-wired only when all three current inventories agree:

1. `apps/exposure-control/services.json`
2. `infrastructure/public-edge/helmrelease.yaml`
3. `infrastructure/public-edge/share-hosts-cname.yaml`

Current mismatch: `jackett`, `subarr`, `iris`, and `athena` are catalog entries without complete static public-edge route and DNS wiring.

## Runtime State

Exposure-control stores enabled state and audit data on its PVC. Shares support bounded expiry and an explicit until-disabled mode. The normal quick preset defaults to one hour.

Authentication mode is per service/share. The backend fallback is Cloudflare Access, while the operator UI may present `none` as the selectable default. The backend currently checks for the Cloudflare Access assertion header; cryptographic JWT verification is not implemented.

State lives at `/data/state.json`; the append-only audit stream is `/data/audit.json`. `GET /api/audit` returns recent entries newest first. Recognized share hosts proxy target application paths including `/api/*`, preserving request bodies and `Content-Length`. Exposure-control's own APIs are restricted to the control-panel host.

## Operator Cockpit

The private cockpit combines shares, Transmission mode, image/chart updates, deploy requests, managed Jobs, Secrets, travel checks, [Pulse telemetry](./controlpanel-pulse.md), and [Tuning](./resource-advisor.md). Resource Advisor remains a separate backend: `GET /api/tuning` proxies its report and preflight.

Update comparisons are best-effort registry evidence, not dependency ownership or rollout proof. Deploy acknowledgments mean reconciliation was requested; readiness comes from the latest Flux snapshot. Missing snapshots remain unavailable rather than showing a false healthy/zero state. Pending writes remain visible during refresh, and reduced motion retains a static activity cue.

Assets use content hashes, immutable caching, ETags, and brotli/gzip compression. CSP permits the configured font providers and hash-pins the theme bootstrap. Preserve those delivery and security contracts when changing the cockpit.

## Security Boundary

- The Tunnel is outbound-only from the cluster.
- Protected share hosts must reach exposure-control through Cloudflare Access; direct origin reachability would bypass the header trust boundary.
- Private canonical hostnames remain separate from public share hostnames unless a service has an explicit `publicHostOverride`.
- Rate limits, expiry, and enable state are enforced by exposure-control, not cloudflared.

## Emergency Disable

Use the cockpit's disable-all action or the corresponding exposure-control API to clear runtime share state. Suspending the Flux Kustomization does not stop an already-running cloudflared pod and is not an emergency shutdown.

If the whole public edge must stop, scale or suspend the running Tunnel workload as an explicit operator action, then reconcile GitOps state deliberately after the incident.

## Add Or Remove A Share

Update the catalog, Tunnel route, and DNS alias together. Then validate JSON/YAML, reconcile `exposure-control` and `public-edge`, wait for the exposure-control rollout, and confirm:

- disabled host returns `403`
- enabled host reaches the intended service
- Access-protected mode rejects a request without the assertion header
- expiry returns the host to disabled state

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'public-edge|exposure-control'
kubectl get hr cloudflared -n public-edge
kubectl rollout status deployment/exposure-control -n default --timeout=180s
dig @1.1.1.1 +short <public-host>
curl -I --max-time 20 https://<public-host>/
```
