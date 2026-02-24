# Public Exposure Control Plane Plan (Blog + Temporary Shares)

## Purpose
Design a dynamic control plane that can:
- keep selected services private by default (current model),
- keep `blog.khzaw.dev` permanently public, and
- allow temporary public sharing of selected services with on/off + expiry.

This plan is intentionally aligned with the current GitOps repository and networking model.

## Current Baseline (From This Repo)
- `*.khzaw.dev` app hostnames are currently managed by `external-dns` and resolve to private ingress VIP `10.0.0.231`.
- LAN + Tailscale remote users both reach services through the same ingress path.
- Public internet users cannot reach private RFC1918 destination `10.0.0.231`.

Relevant files:
- `docs/networking-current-state-and-simplification.md`
- `infrastructure/external-dns/helmrelease.yaml`
- `core/ingress-nginx/kustomization.yaml`
- `infrastructure/tailscale-subnet-router/connector.yaml`

## Target Model

Two public-exposure classes:

1. Permanent public
- `blog.khzaw.dev` is always public.
- Cloudflare edge caching and WAF are enabled.
- Origin is reached via Cloudflare Tunnel (not direct inbound to home network).

2. Temporary public
- Selected services can be exposed with a UI toggle.
- Optional `expiresAt` automatically disables exposure.
- Default remains private.

Private/Tailscale path remains unchanged for all existing internal services.

## Architecture

### Components
1. `cloudflared` (public edge connector)
- Runs in-cluster with at least 2 replicas.
- Maintains outbound-only tunnel to Cloudflare.
- Provides internet entry path without opening router inbound ports.

2. Exposure API (`exposure-api`)
- Internal backend for the control panel.
- Validates requested exposures against an allowlist.
- Creates/updates/deletes `PublicExposure` custom resources.

3. Exposure controller (`exposure-controller`)
- Reconciles `PublicExposure` objects.
- Programs cloudflared route config for enabled entries.
- Manages DNS records for public hostnames.
- Applies/updates ingress-level auth annotations for exposed routes.
- Turns exposure off when `expiresAt` is reached.

4. Control Panel UI (`controlpanel.khzaw.dev`)
- Lists expose-eligible services and current status.
- Toggle switch for enable/disable.
- Expiry picker (for example 1h, 6h, 24h, custom).
- Audit log view.

5. Optional scheduler/worker
- Periodic reconciliation for expiry and cleanup.
- Can be built into controller reconcile loop or separate CronJob.

### Data Object

Proposed CRD: `PublicExposure`

Core spec fields:
- `hostname`: FQDN (example `share-seerr.khzaw.dev`)
- `targetRef.namespace`
- `targetRef.service`
- `targetRef.port`
- `enabled`: boolean
- `expiresAt`: RFC3339 timestamp or null
- `authMode`: `cloudflare-access` | `none`
- `owner`: user identifier/email
- `reason`: optional note

Status fields:
- `phase`: `Disabled` | `Pending` | `Enabled` | `Error` | `Expired`
- `lastTransitionTime`
- `conditions[]`
- `observedDNSRecord`
- `observedRoute`

### DNS and Routing Strategy

Important: avoid fighting current private `external-dns` records.

Recommended convention:
- Keep canonical private hostnames unchanged (example `seerr.khzaw.dev` remains private).
- Use dedicated public aliases for temporary shares (example `share-seerr.khzaw.dev`).
- Keep `blog.khzaw.dev` as dedicated permanent public hostname.

This avoids private/public DNS contention on the same FQDN.

### Security Model
1. Expose allowlist
- Only pre-approved services can be exposed from the panel.
- Do not allow critical admin planes by default.

2. Auth by default for temporary exposure
- Default `authMode=cloudflare-access`.
- `none` allowed only if explicitly selected and policy permits.

3. Default expiry
- If user does not choose expiry, apply safe default (example 24h).

4. Auditability
- Store who enabled what and when.
- Record disable events (manual or expired).

5. Rate and abuse controls
- Cloudflare WAF/rate limits on share hostnames.
- Optional bot protection/country allow rules.

## Blog-Specific Integration

`blog.khzaw.dev` becomes the first permanent `PublicExposure` record:
- `enabled: true`
- `expiresAt: null`
- `authMode: none`
- `locked: true` (UI cannot disable without admin override)

Operationally:
- Blog deployment stays GitOps-managed.
- Public reachability is via tunnel route and DNS record controlled by exposure controller.
- Cloudflare cache rules apply to `blog.khzaw.dev` for HN-style bursts.

## Proposed Repo Layout

### Public edge foundation
- `infrastructure/public-edge/helmrelease.yaml` (cloudflared)
- `infrastructure/public-edge/share-hosts-cname.yaml` (share host DNS aliases)
- `infrastructure/public-edge/kustomization.yaml`
- `flux/kustomizations/public-edge.yaml`

### Exposure control plane
- `apps/exposure-control/helmrelease.yaml` (lean combined backend + UI service)
- `apps/exposure-control/kustomization.yaml`
- `flux/kustomizations/exposure-control.yaml`

### Secrets (SOPS encrypted)
- `infrastructure/secrets/public-edge/cloudflared-tunnel-token.yaml`
- `infrastructure/secrets/public-edge/kustomization.yaml`

Optional for future dynamic DNS API operations:
- `infrastructure/secrets/public-edge/cloudflare-api-token-exposure.yaml`

## Rollout Plan

### Phase Status (as of February 20, 2026)
- [x] Phase 1: Public edge foundation + low-risk pilot exposure
- [x] Phase 2: Dynamic exposure backend (lean MVP)
- [x] Phase 3: Control panel UI + API
- [x] Phase 4: Security hardening and operations
- [x] Phase 5: Blog permanent-public onboarding

### Phase 1: Public Edge Foundation + Pilot (Completed)
1. Deploy cloudflared tunnel + SOPS-managed tunnel token secret.
2. Place cloudflared on Raspberry Pi utility node for lean resource usage.
3. Validate one low-risk pilot route end-to-end:
- `share-sponsorblocktv.khzaw.dev` -> `isponsorblock-tv.default.svc.cluster.local:8080`
4. Confirm existing LAN + Tailscale private access model remains unchanged.

### Phase 2: Dynamic Exposure Backend (Completed)
1. Introduce `PublicExposure` data model (CRD or equivalent API-backed object).
2. Implement backend reconciliation for:
- enable/disable exposure
- `expiresAt` auto-disable
- allowlist enforcement
3. Manage runtime DNS/route updates from backend state (no manual DNS edits for shares).
4. Produce audit events for exposure on/off and expiry actions.

Lean MVP note:
- Implemented with a single lightweight backend service (`apps/exposure-control`) using:
  - allowlist config (`services.json`)
  - PVC-backed state file (`/data/state.json`)
  - reconciliation loop for expiry disable
  - default expiry `1h` (UI presets include `15m`, `30m`, `1h`, `2h`, `6h`, `12h`, `24h`)

### Phase 3: Control Panel UI + API (Completed)
1. Deploy UI + API at `controlpanel.khzaw.dev`.
2. Admin authentication skipped (control panel behind private ingress — LAN/Tailscale only).
3. Implement operator UX:
- list expose-eligible services
- toggle exposure on/off
- set expiry windows (preset dropdown: 15m, 30m, 1h, 2h, 6h, 12h, 24h)
- view audit history (append-only JSON Lines log at `/data/audit.json`, API at `GET /api/audit`)

Implementation:
- UI and API are served by the same lightweight `exposure-control` process.
- API access is restricted to requests on `controlpanel.khzaw.dev`.

Validation status:
- Fully validated on February 19, 2026 with end-to-end checks:
  - exposure disabled baseline returns `403` on share hostname,
  - enable action returns active exposure state,
  - public share hostname returns `200` while enabled,
  - disable action returns disabled state and share hostname returns `403`,
  - expiry reconciliation logic verified by loading expired runtime state and observing auto-disable.

### Phase 4: Security Hardening and Ops
1. Default temporary shares to Cloudflare Access protection.
2. Add rate-limit and WAF defaults for share hostnames.
3. Add monitoring/alerting for failed exposure reconciliation.
4. Add one-command emergency shutdown for all temporary exposures.

Implementation status (lean GitOps path):
- `apps/exposure-control/server.js` enforces default `authMode=cloudflare-access` and supports explicit `authMode:none`.
- In-process per-service/IP rate limiting is enabled.
- Emergency shutdown endpoint is implemented at `POST /api/admin/disable-all` (UI button wired).
- Metrics are exposed at `GET /metrics`.
- Monitoring objects:
  - `infrastructure/monitoring/servicemonitor-exposure-control.yaml`
  - `infrastructure/monitoring/prometheusrule-exposure-control.yaml`
- Access setup runbook:
  - `docs/cloudflare-access-share-hosts-email-otp-plan.md`

Validation status:
- Verified on February 22, 2026:
  - `ServiceMonitor/monitoring/exposure-control` exists and is reconciled by Flux,
  - `PrometheusRule/monitoring/exposure-control` exists and is validated,
  - `/metrics` endpoint serves `exposure_control_*` metrics,
  - emergency disable-all endpoint is reachable from control panel host.

### Phase 5: Blog Permanent-Public Onboarding
1. Deploy blog service in-cluster (GitOps-managed app path).
2. Create permanent public exposure policy for `blog.khzaw.dev`:
- `enabled: true`, no expiry, locked in control panel
3. Enable Cloudflare cache strategy tuned for burst traffic (HN-style spikes).
4. Keep non-blog services private-by-default unless explicitly shared.

Implementation status (GitOps DNS ownership):
- Cloudflare Tunnel route:
  - `infrastructure/public-edge/helmrelease.yaml` (`hostname: blog.khzaw.dev` -> `blog.default.svc.cluster.local:8080`)
- DNS alias ownership:
  - `infrastructure/public-edge/share-hosts-cname.yaml` (`Service/blog-cname`)
- Important:
  - blog Ingress must not publish `external-dns.alpha.kubernetes.io/hostname: blog.khzaw.dev`.
  - public DNS should resolve to Cloudflare edge for `blog.khzaw.dev`, not private `10.0.0.231`.

Validation status:
- Verified on February 22, 2026:
  - Cloudflare DNS for `blog.khzaw.dev` is `CNAME` to tunnel endpoint with external-dns TXT ownership,
  - `dig @1.1.1.1 blog.khzaw.dev` resolves to Cloudflare edge IPs,
  - `https://blog.khzaw.dev` returns `200`.

## Operational Guardrails
- Keep exposure runtime state controller-owned; avoid manual `kubectl` drift.
- Keep secrets only in SOPS-managed manifests.
- Preserve existing private ingress pattern for non-public services.
- Do not repoint existing private canonical hostnames for temporary sharing.

## Open Decisions
1. Hostname strategy:
- `share-<app>.khzaw.dev` or `<app>-public.khzaw.dev`

2. Auth strategy for temporary shares:
- Always Cloudflare Access vs optionally open unauthenticated links

3. Control panel auth:
- Tailscale-only admin access vs Cloudflare Access + identity provider

4. Implementation style:
- Custom lightweight controller/API vs integrating an existing operator framework

## Success Criteria
1. `blog.khzaw.dev` remains continuously public and performant under cache.
2. Temporary share can be enabled in UI and becomes reachable within minutes.
3. Expiry auto-disables exposure reliably.
4. Turning exposure off fully removes external reachability.
5. Existing LAN + Tailscale private access remains unchanged.
