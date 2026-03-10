# Pangolin Fit and Replacement Analysis for `rangoonpulse`

Date:
- March 10, 2026

## Purpose
This document answers one repo-specific question:

Where could Pangolin fit into the current `rangoonpulse` access architecture, and what would it replace if adopted?

This is intentionally not a Pangolin feature catalog. The focus here is:
- the current `rangoonpulse` access model,
- which existing components Pangolin overlaps with,
- which migration shapes are realistic,
- which parts of the current stack should remain untouched.

## Current Access Model in `rangoonpulse`

`rangoonpulse` already has a deliberate access split.

### Private access path

Private app access today is built around one canonical destination:
- `*.khzaw.dev` app hostnames resolve to `10.0.0.231`
- that IP is the MetalLB ingress VIP
- LAN users hit that VIP directly
- remote users on Tailscale hit that same VIP through subnet routing

This is the current baseline because it avoids:
- remote-only hostnames,
- alternate remote ingress proxies,
- dual-resolution behavior,
- a second private access plane to debug.

Repo references:
- [AGENTS.md](../AGENTS.md)
- [networking-current-state-and-simplification.md](./networking-current-state-and-simplification.md)
- [networking-simplified-migration-todo.md](./networking-simplified-migration-todo.md)

### Public access path

Public access today is intentionally separate from the private path:
- Cloudflare Tunnel is the internet entry point
- permanent public services such as `blog.khzaw.dev` route through the tunnel
- temporary public shares use dedicated `share-*.khzaw.dev` aliases
- the share aliases terminate at `apps/exposure-control/`
- `exposure-control` decides whether a share is enabled, expired, gated, or disabled

Repo references:
- [public-edge-phase1-bootstrap.md](./public-edge-phase1-bootstrap.md)
- [public-exposure-control-panel-plan.md](./public-exposure-control-panel-plan.md)
- [exposure-control-phase2-phase3-mvp.md](./exposure-control-phase2-phase3-mvp.md)

### LAN non-Kubernetes host access

Some non-Kubernetes LAN systems are still exposed through Kubernetes ingress:
- `nas.khzaw.dev`
- `router.khzaw.dev`

That path exists so TLS terminates at ingress while backend traffic proxies to LAN IPs.

Repo references:
- [lan-access-current-state-and-lean-plan.md](./lan-access-current-state-and-lean-plan.md)

## The Short Answer

Pangolin could fit only at the access boundary of `rangoonpulse`.

It would not replace:
- Flux
- HelmRelease app deployment
- ingress-nginx as the internal cluster ingress baseline
- AdGuard DNS
- external-dns for private canonical hostnames
- cert-manager for the current ingress/TLS pattern
- monitoring, storage, secrets, or resource-advisor

If adopted, Pangolin would overlap with one or more of these current access surfaces:
- Tailscale subnet-routing for remote private access
- Cloudflare Tunnel for browser-facing public entry
- `apps/exposure-control/` for temporary public sharing
- Cloudflare Access for identity-gated browser shares

That means Pangolin is not an additive "nice to have" in this repo. It is only meaningful if it replaces part of the
existing access stack.

## What Pangolin Would Potentially Replace

This section is the core mapping.

### 1. `apps/exposure-control/` and its share workflow

Current role:
- operator-only control panel
- allowlisted shareable services
- enable/disable flow
- expiry enforcement
- audit log
- routing decisions for `share-*.khzaw.dev`

Relevant repo surfaces:
- [apps/exposure-control/helmrelease.yaml](../apps/exposure-control/helmrelease.yaml)
- [apps/exposure-control/server.js](../apps/exposure-control/server.js)
- [apps/exposure-control/services.json](../apps/exposure-control/services.json)

How Pangolin fits:
- Pangolin could take over the "grant someone access to a web app" job.
- Pangolin could also absorb the identity and resource-policy part that is currently split across the custom backend and
  Cloudflare Access.

What this would replace:
- the custom share-state and share-proxy logic in `exposure-control`
- the per-service allowlist logic in `services.json`
- part or all of the current "temporary share" operator workflow

What it would not automatically replace:
- the fact that `rangoonpulse` currently uses a separate hostname family for shares
- the need for clear DNS ownership
- the need for a public edge path if Pangolin is not itself the edge entry point

Assessment:
- this is the cleanest area for Pangolin to replace existing infrastructure
- this is also the only area where Pangolin could plausibly reduce custom code in the repo

### 2. Cloudflare Access for share authentication

Current role:
- protects `share-*.khzaw.dev` browser access
- adds login and policy at the Cloudflare edge
- is intentionally scoped only to public share hostnames

Relevant repo surface:
- [cloudflare-access-share-hosts-email-otp-plan.md](./cloudflare-access-share-hosts-email-otp-plan.md)

How Pangolin fits:
- Pangolin has its own identity and policy layer for protected resources.
- If Pangolin fronts the shared web apps directly, it can replace the current Cloudflare Access gating pattern for those
  apps.

What this would replace:
- Cloudflare Access as the access-control layer for temporary public shares

What it would not replace:
- Cloudflare DNS if you continue to use your domain there
- Cloudflare Tunnel if Pangolin is not the public entry point

Assessment:
- Pangolin can replace Cloudflare Access only if Pangolin becomes the app-facing auth layer for those shares
- if Cloudflare Tunnel remains the public edge and Pangolin sits behind it, you may still choose to keep Cloudflare
  Access in front, which would reduce Pangolin's value

### 3. Cloudflare Tunnel for public app sharing

Current role:
- internet-facing entry point for `blog.khzaw.dev`
- internet-facing entry point for `share-*.khzaw.dev`
- keeps the home network outbound-only

Relevant repo surfaces:
- [infrastructure/public-edge/helmrelease.yaml](../infrastructure/public-edge/helmrelease.yaml)
- [infrastructure/public-edge/share-hosts-cname.yaml](../infrastructure/public-edge/share-hosts-cname.yaml)

How Pangolin fits:
- Pangolin can be the app-facing public access platform if you let it own the external access path for browser resources.
- In that model, Pangolin is not just replacing share logic; it is replacing the current public edge design for those
  apps.

What this would replace:
- `cloudflared` for Pangolin-managed web resources
- the dedicated tunnel route inventory for `share-*.khzaw.dev`

What it would not replace:
- Cloudflare Tunnel for other services you intentionally keep on the current path
- the blog path unless you explicitly migrate the blog too

Assessment:
- Pangolin can replace Cloudflare Tunnel only if you are comfortable moving public entry away from the current
  `cloudflared` path
- this is a larger and riskier change than replacing only `exposure-control`

### 4. Tailscale subnet routing for remote private access

Current role:
- remote users on Tailscale reach the same `10.0.0.231` ingress VIP used on LAN
- remote users can also reach specific LAN IPs through advertised `/32` routes
- this keeps remote admin access simple and predictable

Relevant repo surface:
- [infrastructure/tailscale-subnet-router/connector.yaml](../infrastructure/tailscale-subnet-router/connector.yaml)

How Pangolin fits:
- Pangolin can present access per app, per host, per port, or per CIDR instead of giving a user route-level reachability
- Pangolin is therefore closer to a least-privilege access broker than a subnet router

What this would replace:
- Tailscale as the primary remote-access fabric for whatever resources Pangolin manages
- the current "remote user reaches the same LAN IP through subnet routing" model for those resources

What it would not replace:
- Tailscale itself if you keep it for admin access
- Tailscale for machine-to-machine or node/operator use cases

Assessment:
- Pangolin could replace Tailscale subnet routing for guest-style or third-party access
- Pangolin is a poor replacement for your current day-to-day admin path because the repo intentionally optimized toward
  one canonical destination model

### 5. Nothing else important

Pangolin does not meaningfully replace:
- your ingress conventions for internal/private apps
- AdGuard's LAN DNS role
- external-dns ownership of private canonical hostnames
- cert-manager as currently used by ingress
- `lan-gateway` for TLS-terminated proxying of NAS and router UIs

Those stay unless you perform a much broader architecture rewrite than "add Pangolin".

## Replacement Matrix

| Current component | Current job | Could Pangolin replace it? | Notes |
|---|---|---|---|
| `apps/exposure-control` | Temporary public app-sharing control plane | Yes, strongly | Best-fit replacement target |
| Cloudflare Access on `share-*` | Identity gate for temporary public shares | Yes, conditionally | Only if Pangolin owns auth for those apps |
| `cloudflared` for `share-*` | Public edge path for shared apps | Yes, conditionally | Larger change; not required for a narrower Pangolin pilot |
| `cloudflared` for `blog.khzaw.dev` | Permanent public blog path | Technically yes | Low-value replacement; current path already fits the blog well |
| Tailscale subnet router | Remote private reachability to ingress VIP and selected LAN IPs | Partially | Makes sense only for least-privilege user access, not your main admin path |
| ingress-nginx for private apps | Internal/private app ingress | No | Keep it |
| external-dns for private hostnames | Canonical DNS ownership for `*.khzaw.dev -> 10.0.0.231` | No | Keep it |
| cert-manager on current ingress path | TLS for current ingress hostnames | No | Keep it unless Pangolin takes hostname ownership |
| AdGuard DNS | LAN recursive DNS/filtering | No | No overlap |
| `lan-gateway` NAS/router path | TLS-terminated proxy to LAN UIs | Not meaningfully | Different problem |

## Realistic Adoption Shapes for `rangoonpulse`

These are the only adoption shapes that make architectural sense in this repo.

### Option A: No adoption

Meaning:
- keep the current stack unchanged

What Pangolin replaces:
- nothing

Why this is still a valid outcome:
- `rangoonpulse` already has a coherent answer for private access
- `rangoonpulse` already has a coherent answer for temporary public shares
- the current architecture was intentionally simplified to remove extra proxy indirection

This remains the default recommendation unless you have a concrete access problem the current stack is not solving.

### Option B: Replace only `exposure-control`

Meaning:
- keep Tailscale subnet routing for private access
- keep ingress-nginx and the private hostname model
- keep existing admin path
- use Pangolin only for web-app sharing and guest-facing app access

What Pangolin replaces:
- `apps/exposure-control`
- possibly Cloudflare Access for those shared apps
- possibly the `share-*` tunnel routing if Pangolin also owns the public edge

What stays:
- Tailscale for remote private access
- ingress-nginx for private app ingress
- private `*.khzaw.dev -> 10.0.0.231` design

Why this is attractive:
- smallest blast radius
- clearest replacement target
- easiest way to evaluate whether Pangolin is better than custom share management

Why this is still non-trivial:
- hostname ownership must stay clear
- DNS and cert ownership must stay clear
- you still end up with two access systems: Tailscale for private access and Pangolin for delegated app access

### Option C: Replace public browser access broadly

Meaning:
- Pangolin becomes the browser-facing access platform for public or delegated access
- Cloudflare Tunnel plus the custom share control plane shrink or disappear for those apps

What Pangolin replaces:
- `apps/exposure-control`
- Cloudflare Access on shares
- some or all `cloudflared` routes for shared apps

What stays:
- Tailscale for private admin reachability
- current private ingress path

Why this might make sense:
- if the main pain point is delegated browser access, not raw private network access

Why it is risky:
- public edge ownership changes
- DNS and certificate workflows change
- the current public-share design is already working

### Option D: Replace both public sharing and private remote access

Meaning:
- Pangolin becomes the main user-facing access plane
- Tailscale remains only for operator or machine use, or is reduced substantially

What Pangolin replaces:
- `apps/exposure-control`
- Cloudflare Access on shares
- some or all Cloudflare Tunnel web-access flows
- some or all Tailscale subnet-routing use cases

What stays:
- probably ingress-nginx as an internal cluster ingress behind Pangolin
- Flux, Helm, app manifests, monitoring, secrets, storage

Why this is the strongest Pangolin story:
- Pangolin is most valuable when it becomes the unified access broker

Why this is the weakest `rangoonpulse` fit:
- it directly conflicts with the repo's current simplicity principle
- it is the largest migration
- it is the easiest way to recreate the multi-path complexity the repo intentionally removed

## What Pangolin Improves, Specifically in This Repo

Pangolin only earns its place here if it solves one of these specific problems better than the current stack:

### Delegated least-privilege access

Today the cleanest remote/private model is still your own Tailscale-connected path.

Pangolin becomes attractive when the user is not you.

Examples:
- give a friend access to one app without giving route-level reachability
- give someone access to one internal service without tailnet membership
- expose one raw port or one host without exposing the shared ingress VIP

This is the strongest Pangolin fit for `rangoonpulse`.

### Non-HTTP remote access under a policy model

Your current public-share model is optimized for browser apps.

Pangolin could cover access patterns that the current stack does not cover elegantly:
- SSH to a selected system
- database access
- one-off admin ports
- protocol-agnostic private services

This is the second strongest Pangolin fit.

### Reducing custom share-app maintenance

If you decide that the custom share controller is becoming operational debt, Pangolin could replace that surface with a
more standardized access platform.

This matters only if:
- the share flow becomes more complex,
- user/role workflows become more important,
- or you no longer want to maintain custom control-plane code.

## What Pangolin Makes Worse in This Repo

### It pushes against the current "one canonical destination" design

The existing repo intentionally converged on:
- private DNS answers point to LAN IPs
- Tailscale only supplies the route
- there is no separate remote-only ingress proxy to reason about

Pangolin would move away from that for whatever it manages.

That is not automatically wrong, but it is a real architecture reversal.

### It adds another stateful control plane

`rangoonpulse` already has:
- ingress
- Tailscale operator
- Cloudflare Tunnel
- monitoring
- external-dns
- cert-manager
- a custom share control plane

Pangolin is only worth adding if it removes enough of that list for the relevant access workflows.

If it is just added on top, complexity goes up and clarity goes down.

### It can create hostname and certificate ownership conflicts

Your current repo is careful about hostname ownership:
- private canonical hostnames point to `10.0.0.231`
- public-share hostnames use a separate alias family
- public blog DNS is intentionally owned separately from private ingress

If Pangolin takes over existing canonical service names too early:
- DNS ownership becomes unclear
- certificate ownership becomes unclear
- debugging becomes harder

## Recommended Fit for `rangoonpulse`

Current recommendation:
- do not replace the current access stack wholesale
- if Pangolin is evaluated at all, evaluate it as a narrow replacement for `exposure-control` or for delegated
  least-privilege access to a small set of resources

In plain terms:

Best current fit:
- Pangolin replaces `apps/exposure-control`
- Pangolin maybe replaces Cloudflare Access for those delegated app shares
- Tailscale stays as the primary admin and operator remote path
- ingress-nginx stays the private/internal ingress baseline

Bad first fit:
- replacing the entire current Tailscale subnet-routing model for your own daily access
- reassigning all canonical `*.khzaw.dev` service hostnames to Pangolin
- adding Pangolin on top of the current stack without retiring any overlapping piece

## Safest Pilot Shape

If Pangolin is ever piloted here, the safest version is:

1. Keep the current private canonical hostnames untouched.

2. Use a separate experimental hostname family.
- examples:
  - `*.pangolin.khzaw.dev`
  - `*.access.khzaw.dev`

3. Start with one delegated browser app and one private non-HTTP resource.

4. Keep Tailscale as the main admin path during the trial.

5. Decide only after seeing whether Pangolin actually replaces something meaningful.

If the answer after the pilot is "it did not clearly replace `exposure-control` or clearly improve delegated access",
then it does not belong in this repo.

## Repo Impact If Adopted Later

If Pangolin is ever added as a real component, the repo would need:
- a new GitOps path such as `apps/pangolin/` or `infrastructure/pangolin/`
- SOPS-managed secrets for Pangolin runtime and auth configuration
- new operator docs for backup, restore, health checks, and certificate ownership
- updates to [AGENTS.md](../AGENTS.md)
- updates to [README.md](../README.md)
- updates to [ops-command-cheatsheet.md](./ops-command-cheatsheet.md)
- updated access-model docs documenting which current component Pangolin replaced

## References

Internal references:
- [AGENTS.md](../AGENTS.md)
- [README.md](../README.md)
- [networking-current-state-and-simplification.md](./networking-current-state-and-simplification.md)
- [networking-simplified-migration-todo.md](./networking-simplified-migration-todo.md)
- [lan-access-current-state-and-lean-plan.md](./lan-access-current-state-and-lean-plan.md)
- [public-edge-phase1-bootstrap.md](./public-edge-phase1-bootstrap.md)
- [public-exposure-control-panel-plan.md](./public-exposure-control-panel-plan.md)
- [exposure-control-phase2-phase3-mvp.md](./exposure-control-phase2-phase3-mvp.md)
- [cloudflare-access-share-hosts-email-otp-plan.md](./cloudflare-access-share-hosts-email-otp-plan.md)

Official Pangolin references:
- [How Pangolin Works](https://docs.pangolin.net/about/how-pangolin-works)
- [Understanding Resources](https://docs.pangolin.net/manage/resources/understanding-resources)
- [Authentication for Private Resources](https://docs.pangolin.net/manage/resources/private/authentication)
- [Without Tunneling](https://docs.pangolin.net/self-host/advanced/without-tunneling)
- [Docker Compose](https://docs.pangolin.net/self-host/manual/docker-compose)
- [Database Options](https://docs.pangolin.net/self-host/advanced/database-options)
- [Blueprints](https://docs.pangolin.net/manage/blueprints)
- [GitHub Repository](https://github.com/fosrl/pangolin)
