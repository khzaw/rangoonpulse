---
title: Public Edge and Exposure Control
summary: Current permanent-public and temporary-share routing, ownership, state, and emergency controls.
status: active
owner: homelab
last_reviewed: 2026-11-13
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

## Runtime State

Exposure-control stores enabled state and audit data on its PVC. Shares support bounded expiry and an explicit until-disabled mode. The normal quick preset defaults to one hour.

Authentication mode is per service/share. The backend fallback is Cloudflare Access, while the operator UI may present `none` as the selectable default. The backend currently checks for the Cloudflare Access assertion header; cryptographic JWT verification is not implemented.

State lives at `/data/state.json`; the append-only audit stream is `/data/audit.json`. `GET /api/audit` returns the latest 100 entries newest first. Recognized share hosts proxy target application paths including `/api/*`, preserving request bodies and `Content-Length`. Exposure-control's own APIs are restricted to the control-panel host.

The core has no HTTP, filesystem, or Kubernetes dependency. The server supplies persistence, audit delivery, hostname configuration, and a clock; the proxy, API, startup recovery, and periodic reconciler use the same core policy. The GUI and Rust CLI call the same private HTTP API. The CLI never reads or writes the server's state files directly.

Enable requests accept numeric `hours` from `0.25` to `24` in 15-minute increments, or `null` for until disabled. Omitted duration and authentication use server/catalog defaults; invalid explicit values return `400` instead of being silently clamped or replaced. Existing valid GUI requests and persisted state retain their behavior.

## Command Line

The [Exposure CLI guide](./exposure-cli.md) covers kubectl access without a checkout, all commands and defaults, JSON scripting, local execution, and troubleshooting. The CLI is a compiled Rust binary that uses the same private API and core as the GUI.

## CLI Image Delivery

An init container copies the binary from the pinned `ghcr.io/khzaw/exposure-cli` image into an ephemeral volume. The application container mounts it read-only at `/usr/local/bin/exposure` and sets `EXPOSURE_CONTROL_URL` to the loopback API. The CLI runs only when invoked; there is no continuously running CLI sidecar.

`.github/workflows/exposure-cli.yaml` runs Rust tests and builds the CLI image natively for Linux AMD64 and ARM64, then publishes a combined `sha-<commit>` manifest to GHCR. The workflow runs for CLI/build changes on master, validates pull requests without publishing, and supports manual dispatch. Promote a successful build by pinning its tag and manifest digest in the HelmRelease's `cli` init container. Renovate owns Cargo dependencies, the Rust toolchain, and Dockerfile bases; the deployed CLI image pin is promoted explicitly through Git.

The init container uses `default/ghcr-pull-secret` for registry access. The Node server image and ConfigMap-delivered GUI/core keep their existing ownership. `make validate-all` runs Rust formatting, Clippy, Rust tests, and the Rust CLI against a disposable Node backend to check GUI/CLI state, expiry, authentication, audit, and restart behavior. `EXPOSURE_CLI_BIN` can select a separately built native binary for that integration test.

## Operator Cockpit

The private [Control Panel](https://controlpanel.khzaw.dev/) combines shares, Transmission mode, image/chart updates, deploy requests, managed Jobs, Secrets, travel checks, [Pulse telemetry](./controlpanel-pulse.md), and [Tuning](./resource-advisor.md). Resource Advisor remains a separate backend: `GET /api/tuning` proxies its report and preflight.

The default route is Overview. The navigation groups Monitor (Overview, Pulse), Manage (Updates, Deployments, Jobs, Tuning), and Access (Shares, Travel, Secrets). Desktop uses a fixed rail; narrow screens use a modal menu with Escape dismissal and focus restoration. Theme selection stays in the navigation. Existing hash routes remain stable, including `#audit` and `#transmission`; the audit route opens its Activity disclosure.

Updates separates image and chart inventories into keyboard-accessible tabs. Shares supports text search and an Active filter without replacing in-progress share forms. Disable all shares lives on Shares and Travel. Job schedules and history, overview freshness, and tuning schedule evidence are expandable. Jobs, deployments, and secret inventories load on demand, including when selected during initial loading.

UI sources are `index.html`, `styles.css`, `app.js`, and the focused Pulse/Tuning modules under `apps/exposure-control/`. Run `make validate-all`; verify all nine routes in both themes at desktop and phone widths, keyboard tab navigation, mobile menu dismissal, share filtering, and legacy deep links. UI review must not enable shares, deploy sites, run jobs, or modify secrets merely to exercise controls.

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
