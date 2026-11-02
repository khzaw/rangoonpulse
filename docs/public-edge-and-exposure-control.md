---
title: Public Edge and Exposure Control
summary: Current permanent-public and temporary-share routing, ownership, state, and emergency controls.
status: active
owner: homelab
last_reviewed: 2026-11-02
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
- `apps/exposure-control/exposure-client.js`: shared browser/Node API client for the cockpit and CLI
- `apps/exposure-control/cli.js`: local `exposure` command

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

The core has no HTTP, filesystem, or Kubernetes dependency. The server supplies persistence, audit delivery, hostname configuration, and a clock; the proxy, API, startup recovery, and periodic reconciler use the same core policy. Both user interfaces call the same private API through the shared client. The CLI never reads or writes the server's state files directly.

Enable requests accept numeric `hours` from `0.25` to `24` in 15-minute increments, or `null` for until disabled. Omitted duration and authentication use server/catalog defaults; invalid explicit values return `400` instead of being silently clamped or replaced. Existing valid GUI requests and persisted state retain their behavior.

## Command Line

Any machine with `kubectl`, a working cluster connection, and permission to exec into the exposure-control pod can run the CLI without a repository checkout or local Node installation:

```bash
kubectl -n default exec deployment/exposure-control -- node /app-files/cli.js --url http://127.0.0.1:8080 list
kubectl -n default exec deployment/exposure-control -- node /app-files/cli.js --url http://127.0.0.1:8080 enable bookorbit
```

The Git-managed ConfigMap mounts the CLI and shared client in the existing Node container. Each invocation runs the CLI in that pod and calls its loopback API, using the same core and persisted state as the GUI. No separate CLI workload or image is needed. This path requires a running exposure-control pod and Kubernetes `pods/exec` access; the command does not bypass the existing cluster permissions.

For a shorter command in a POSIX shell, define a function:

```sh
exposure() {
  kubectl -n default exec deployment/exposure-control -- node /app-files/cli.js --url http://127.0.0.1:8080 "$@"
}
exposure list --active
exposure enable bookorbit
```

Alternatively, run locally with Node.js 24 or newer from the repository root:

```bash
npm run --silent exposure -- list
npm run --silent exposure -- show bookorbit --json
```

To make `exposure` available on the current Node installation's command path, run `npm link --ignore-scripts --package-lock=false` from the repository root. This links the executable to the checkout; keep the checkout available and relink after changing Node installations. No dependencies or Kubernetes credentials are required.

```bash
exposure list --active
exposure show bookorbit
exposure enable bookorbit
exposure enable bookorbit --for 2h
exposure enable immich --until-disabled --auth cloudflare-access
exposure disable bookorbit
exposure disable-all --yes
exposure audit bookorbit --limit 20
exposure list --json
```

The CLI defaults to `authMode: none` and indefinite duration: `exposure enable bookorbit` enables the share until disabled, and `exposure enable bookorbit --for 2h` adds a two-hour expiry with no authentication. These defaults are sent explicitly to the shared API. Use `--auth cloudflare-access` to require Access. `--for` accepts minutes or hours, such as `15m`, `90m`, or `2h`; it cannot be combined with `--until-disabled`. `list --active` uses effective enabled state, including immediate expiry enforcement. `audit [service]` filters the latest 100 server events and displays up to `--limit` entries (default 20). JSON output preserves the API's `services`, `service`, or `entries` envelope, including `disabled` for disable-all. Exit codes are `0` for success, `1` for API/connection failures, and `2` for command usage errors.

When running locally, the default origin is `https://controlpanel.khzaw.dev`, reachable over LAN or Tailscale. Override it with `EXPOSURE_CONTROL_URL` or `--url` (which takes precedence). The URL must be an HTTP(S) origin with no embedded credentials, path, query, or fragment. Requests have a ten-second timeout, refuse redirects, and require JSON responses so a login page cannot be mistaken for success.

If private ingress is unavailable, an operator with Kubernetes access can forward the existing Service:

```bash
kubectl -n default port-forward service/exposure-control 8080:8080
# In a second terminal:
exposure --url http://127.0.0.1:8080 list
```

The CLI can run locally or through `kubectl exec` in the existing pod. `kubectl run` and a separate in-cluster CLI workload are unnecessary. Both paths use the existing private control-host trust boundary, with no additional public operator endpoint.

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
