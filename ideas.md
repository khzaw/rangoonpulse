# Homelab Ideas Backlog

This file tracks ideas explicitly rated `good` or better.

## Selected Ideas

1. `really good` - Public Exposure Control Plane (Blog + Temporary Shares)
- Add a dynamic control panel at `controlpanel.khzaw.dev` to toggle temporary public exposure for approved services with optional expiry.
- Keep `blog.khzaw.dev` permanently public behind Cloudflare edge cache/WAF (HN-spike resilient), while all other services remain private-by-default.
- Implement via Cloudflare Tunnel + `PublicExposure` control object + controller/API/UI flow, with audit logs and safe defaults (`expiresAt`, Access auth, allowlist).
- Use dedicated temporary share hostnames (for example `share-<app>.khzaw.dev`) to avoid DNS contention with existing private canonical hostnames.

2. `really good` - Capacity-Aware Resource Advisor v2
- Extend resource advisor with node-fit simulation, headroom checks, and tradeoff recommendations (downsize some workloads to safely upsize others).

3. `good` - Self-Service Ops Portal (Lean)
- Internal ops portal for safe actions (restart app, Flux reconcile, quick diagnostics) with audit trail and scoped RBAC.

4. `good` - Media-Aware Dynamic Throttling
- Detect active Jellyfin load/transcoding and temporarily throttle non-critical workloads, then restore automatically.

5. `good` - Lean Ops Command Center v2
- Runbook-driven operational UI on top of self-service actions, with guided diagnostics and incident context.

6. `okay` - GitOps App Bootstrapper
- CLI/script scaffolding for new apps (`apps/<name>`, Flux kustomization, ingress/TLS/external-dns, baseline resources, and PVC policy).

## Deferred / Not Included

- Items marked as not needed or not for now are intentionally excluded from this list.
