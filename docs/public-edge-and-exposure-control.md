---
title: Public Edge and Exposure Control
summary: Current permanent-public and temporary-share routing, ownership, state, and emergency controls.
status: active
owner: homelab
last_reviewed: 2026-11-27
---

# Public Edge and Exposure Control

## Ownership

The public edge is split deliberately:

- `infrastructure/public-edge/helmrelease.yaml`: Cloudflare Tunnel process and hostname-to-origin routes
- `infrastructure/public-edge/share-hosts-cname.yaml`: proxied public DNS aliases
- `apps/exposure-control/services.json`: services the cockpit can target
- `apps/exposure-control/helmrelease.yaml`: control-plane runtime, persistence, ingress, and configuration
- `apps/exposure-control/exposure-core.js`: share transitions, effective state, expiry, authentication policy, and audit events
- `apps/exposure-control/server.js`: state persistence, HTTP APIs, expiry scheduling, auth-presence enforcement, rate limiting, and proxying
- `apps/exposure-control/exposure-client.js`: cockpit API client
- `apps/exposure-control/cli/`: native Rust `exposure` command and its container build

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

Private-only services have no catalog entry, Tunnel route, or DNS alias because they have no external sharing need: Audiobookshelf, Flux UI, Gatus, Immich, Radarr, Shelfmark, Sonarr, Speedtest, and Tracerr. Add share wiring for them only when public access is explicitly requested.

`actual` uses the dedicated `actual-agent.khzaw.dev` host for API clients that hold a Cloudflare Access service token. Its catalog entry sets `"kind": "agent"`, which marks a standing machine endpoint rather than a temporary share: the cockpit shows it under Agent access instead of the service list, and share counts and travel posture leave it out. Entries without `kind` are shares; any other value fails startup. See [service-token hosts](./share-host-authentication.md#service-token-hosts).

## Runtime State

Exposure-control stores enabled state and audit data on its PVC. Shares support bounded expiry and an explicit until-disabled mode. The normal quick preset defaults to one hour. A live share can be extended, given a new expiry, or switched between auth modes without closing it; each snapshot reports `openedAt`, the start of the current public window, which such edits keep.

Authentication mode is per service/share. The backend fallback is Cloudflare Access, while the operator UI may present `none` as the selectable default. In `cloudflare-access` mode the backend verifies the Access token's signature, issuer, expiry, and optional per-service audience against `CF_ACCESS_TEAM_DOMAIN`; while that is unset, those shares reject every request. The [share-host authentication contract](./share-host-authentication.md) owns the details.

State lives at `/data/state.json`; the append-only audit stream is `/data/audit.json`. `GET /api/audit` returns the latest 100 entries newest first. Recognized share hosts proxy target application paths including `/api/*`, preserving request bodies and `Content-Length`. Exposure-control's own APIs are restricted to the control-panel host.

The core has no HTTP, filesystem, or Kubernetes dependency. The server supplies persistence, audit delivery, hostname configuration, and a clock; the proxy, API, startup recovery, and periodic reconciler use the same core policy. The GUI and Rust CLI call the same private HTTP API. The CLI never reads or writes the server's state files directly.

Enable requests accept numeric `hours` from `0.25` to `24` in 15-minute increments, or `null` for until disabled. Omitted duration and authentication use server/catalog defaults; invalid explicit values return `400` instead of being silently clamped or replaced. Existing valid GUI requests and persisted state retain their behavior.

`POST /api/services/<id>/update` edits a share that is public right now and takes at least one of: `hours` (a new expiry counted from now, same rules as enable, `null` for until disabled), `extendHours` (`0.25` to `24` in 15-minute steps added to the current expiry), and `authMode`. `hours` and `extendHours` are mutually exclusive. A share that is off or already past its expiry returns `409` and is never reopened, as does extending a share with no expiry; invalid values return `400`. Each edit appends an `update` audit entry with the requested change and the resulting `expiresAt`. The CLI has no update command; its `enable` on a live share starts a new window instead.

## Command Line

The [Exposure CLI guide](./exposure-cli.md) covers kubectl access without a checkout, all commands and defaults, JSON scripting, local execution, and troubleshooting. The CLI is a compiled Rust binary that uses the same private API and core as the GUI.

## CLI Image Delivery

An init container copies the binary from the pinned `ghcr.io/khzaw/exposure-cli` image into an ephemeral volume. The application container mounts it read-only at `/usr/local/bin/exposure` and sets `EXPOSURE_CONTROL_URL` to the loopback API. The CLI runs only when invoked; there is no continuously running CLI sidecar.

`.github/workflows/exposure-cli.yaml` runs Rust tests and builds the CLI image natively for Linux AMD64 and ARM64, then publishes a combined `sha-<commit>` manifest to GHCR. The workflow runs for CLI/build changes on master, validates pull requests without publishing, and supports manual dispatch. Promote a successful build by pinning its tag and manifest digest in the HelmRelease's `cli` init container. Renovate owns Cargo dependencies, the Rust toolchain, and Dockerfile bases; the deployed CLI image pin is promoted explicitly through Git.

The init container uses `default/ghcr-pull-secret` for registry access. The Node server image and ConfigMap-delivered GUI/core keep their existing ownership. `make validate-all` runs Rust formatting, Clippy, Rust tests, and the Rust CLI against a disposable Node backend to check GUI/CLI state, expiry, authentication, audit, and restart behavior. `EXPOSURE_CLI_BIN` can select a separately built native binary for that integration test.

## Operator Cockpit

The private [Control Panel](https://controlpanel.khzaw.dev/) combines shares, Transmission mode, image/chart updates, deploy requests, managed Jobs, Secrets, travel checks, [Pulse telemetry](./controlpanel-pulse.md), the [Activity timeline](./controlpanel-activity.md), and [Tuning](./resource-advisor.md). Resource Advisor remains a separate backend: `GET /api/tuning` proxies its report and preflight.

The default route is Overview. The navigation groups Monitor (Overview, Pulse, Activity), Manage (Updates, Deployments, Jobs, Tuning), and Access (Public access, Travel, Secrets). Desktop uses a fixed rail that folds to an icon strip from the top-bar control or `[`; the choice is stored per browser, and folded labels appear beside their icon on hover or focus. Narrow screens use a modal menu with Escape dismissal and focus restoration. Theme selection lives in the expanded navigation and the command palette. Existing hash routes remain stable, including `#audit` and `#transmission`; the audit route opens the Audit disclosure on Public access, which keeps the `#exposure` route.

Overview leads with a count of states that need a look (nodes, travel, Transmission route, advisor, DNS records), the chips that name them, and four [Pulse](./controlpanel-pulse.md) readings. The DNS chip shows the base-domain zone's Cloudflare record usage against its plan quota from `GET /api/dns-usage`, which caches for 10 minutes and keeps the last reading if a refresh fails. It turns amber at 80% and red at 95%, and links to the zone's DNS records in Cloudflare. Without the `exposure-control-cloudflare` token, the chip is hidden. The trace behind the headline follows primary-node CPU load and is flat when that reading is missing; it is decoration and carries no information the chips and readings do not.

The command palette (`Cmd/Ctrl+K` or `/`) reaches every page, each share row, theme modes, and the same actions as the page buttons. It adds no capability: destructive actions keep their confirmation, and anything without one on the page has none in the palette.

Updates separates image and chart inventories into keyboard-accessible tabs. Public access lists every shareable service in its configured order on fixed columns (state, access, time left with a draining meter, actions), so rows and columns stay put when a share opens or closes. Rows are keyed and repainted in place: a background refresh keeps an open panel, its focus, and its draft. Text search and a Public filter narrow the list. Clicking a row, or its Share or Edit button, opens one panel under it; Escape closes it. A private service's panel picks an expiry and access, and its button names the result ("Share for 1h", "Share until stopped"); on success the panel turns into the live editor in place. A live share's panel shows the link with Copy, extends it by 15m, 1h, 6h or 24h or removes its expiry (a share with no expiry offers those steps as a new expiry instead), switches access between anyone with the link and Cloudflare login, and stops it. Edits apply on click through the update API. Stop on the row closes a share at once. Agent access sits below the list as one switch per agent host: on enables it with `cloudflare-access` and no expiry, off disables it. Stop all closes every share and agent host; the Travel button closes temporary shares only. Job schedules and history, overview freshness, and tuning schedule evidence are expandable. Jobs, deployments, and secret inventories load on demand, including when selected during initial loading.

Boxes are reserved for the dashboard pages: the Overview hero and the Pulse reading strip. Every other page is open type on hairlines, with a stronger rule opening a group and a faint one dividing its rows; do not add framed cards or corner ornaments to them.

Action feedback appears as one toast per area, replaced in place as an operation progresses. Toasts stack in one deck at the top centre: the newest in front with up to two older ones peeking below; hovering or focusing the deck fans it out and pauses the timers. A toast can carry a detail line and one action, and clicking its body dismisses it; errors stay longer. Share and agent actions show a busy toast while the request runs and the outcome once the table shows it: going public offers Copy link, closing a share offers Undo (same auth, remaining time), an edit to a live share offers Undo (the previous access, or the previous time left in 15-minute steps when at most a day), and a failure offers Retry and returns the panel to the last known state. Expired shares are announced when the page notices them. Deployments keep an inline status line because it carries the pending-reconcile indicator. State is always a lamp plus a text label; figures stay in the text colour.

UI sources are `index.html`, `styles.css`, `app.js`, the presentation layer `fx.js` (palette, toasts, motion), and the focused Pulse, Tuning, and Activity (`feed.js`) modules under `apps/exposure-control/`. A new client script must be added to the Kustomize ConfigMap, the server asset map and version rewrite, the deferred HTML scripts, and `npm run check`. Never name a class or id after social or ad widgets (`share`, `social`, `sponsor`, `promo`, `cookie`, and similar): content blockers such as Brave Shields hide generic hooks like `.share-list` on every site, and `fx.test.js` rejects them. Run `make validate-all`; verify all ten routes in both themes at desktop and phone widths, keyboard tab navigation, the palette, the folded rail, mobile menu dismissal, share filtering, and legacy deep links. UI review must not enable shares, deploy sites, run jobs, or modify secrets merely to exercise controls.

Update comparisons are best-effort registry evidence, not dependency ownership or rollout proof. Deploy acknowledgments mean reconciliation was requested; readiness comes from the latest Flux snapshot. Missing snapshots remain unavailable rather than showing a false healthy/zero state. Pending writes remain visible during refresh. Reduced motion disables every animation and leaves static cues: a still trace, an unanimated activity mark, and instant theme changes.

Assets use content hashes, immutable caching, ETags, and brotli/gzip compression. CSP permits the configured font providers and hash-pins the theme bootstrap. Preserve those delivery and security contracts when changing the cockpit.

## Security Boundary

- The Tunnel is outbound-only from the cluster.
- Protected share hosts need a Cloudflare Access application in front; exposure-control rejects requests whose Access token it cannot verify.
- Private canonical hostnames remain separate from public share hostnames unless a service has an explicit `publicHostOverride`.
- Rate limits, expiry, and enable state are enforced by exposure-control, not cloudflared.

## Emergency Disable

Use the cockpit's Stop all action or the corresponding exposure-control API to clear runtime share state. Suspending the Flux Kustomization does not stop an already-running cloudflared pod and is not an emergency shutdown.

If the whole public edge must stop, scale or suspend the running Tunnel workload as an explicit operator action, then reconcile GitOps state deliberately after the incident.

## Add Or Remove A Share

Update the catalog, Tunnel route, and DNS alias together. Then validate JSON/YAML, reconcile `exposure-control` and `public-edge`, wait for the exposure-control rollout, and confirm:

- disabled host returns `403`
- enabled host reaches the intended service
- Access-protected mode rejects a request without the assertion header and one with a forged value
- expiry returns the host to disabled state

## Verification

```bash
flux get kustomizations -n flux-system | grep -E 'public-edge|exposure-control'
kubectl get hr cloudflared -n public-edge
kubectl rollout status deployment/exposure-control -n default --timeout=180s
dig @1.1.1.1 +short <public-host>
curl -I --max-time 20 https://<public-host>/
```
