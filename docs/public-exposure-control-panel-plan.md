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
- `infrastructure/public-edge/namespace.yaml`
- `infrastructure/public-edge/helmrelease.yaml` (cloudflared)
- `infrastructure/public-edge/kustomization.yaml`
- `flux/kustomizations/public-edge.yaml`

### Exposure control plane
- `apps/exposure-control/namespace.yaml`
- `apps/exposure-control/crd-publicexposures.yaml`
- `apps/exposure-control/controller-deployment.yaml`
- `apps/exposure-control/api-deployment.yaml`
- `apps/exposure-control/ui-helmrelease.yaml`
- `apps/exposure-control/rbac.yaml`
- `apps/exposure-control/kustomization.yaml`
- `flux/kustomizations/exposure-control.yaml`

### Runtime state namespace
- `infrastructure/public-exposure-runtime/` (controller-owned objects only if needed)

### Secrets (SOPS encrypted)
- `infrastructure/secrets/public-edge/cloudflare-tunnel-token.yaml`
- `infrastructure/secrets/public-edge/cloudflare-api-token-exposure.yaml`
- `infrastructure/secrets/public-edge/kustomization.yaml`

## Rollout Plan

### Phase 1: Foundation (No UI Yet)
1. Deploy cloudflared tunnel + SOPS secrets.
2. Validate one static route (`blog.khzaw.dev`) end-to-end.
3. Enable cache/WAF for blog hostname.

### Phase 2: Dynamic Exposure Backend
1. Introduce `PublicExposure` CRD and controller.
2. Implement enable/disable reconciliation and expiry handling.
3. Add allowlist policy.

### Phase 3: Control Panel
1. Deploy UI + API at `controlpanel.khzaw.dev`.
2. Add login/authN for panel admins.
3. Add toggle UX, expiry picker, and audit history.

### Phase 4: Hardening
1. Add Cloudflare Access defaults for temporary shares.
2. Add alerting for stale/failed exposure reconciles.
3. Add disaster fallback procedure (disable all temporary exposures quickly).

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
