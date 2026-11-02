# Homelab Ideas Backlog

Only unresolved ideas belong here. Delivered work is documented by the current manifests and Git history.

## Jellyfin-Aware Load Shedding

Detect active Jellyfin playback or transcoding plus primary-node pressure, then temporarily shed selected background workloads through reversible runtime overlays.

Current constraints:

- exposure-control should own the operator UI, audit log, and runtime write boundary
- Flux-managed desired state must remain stable while runtime-owned overlays carry temporary state
- actions must never restart Jellyfin or mutate persistent data
- automation should begin advisory-only and require hysteresis, cooldowns, manual override, and observable restore behavior

## Away Mode And Quiet Hours

Add an expiring posture that can disable temporary public shares, select the safer Transmission route, and pause approved background workloads with automatic restoration.

Build on existing exposure-control actions. Do not create a second control plane.

## Operator Cockpit Safe Actions

Extend the control panel with a small, RBAC-constrained set of audited restart, Flux reconcile, and diagnostic actions.

Only expose actions with clear scope, idempotent behavior, and live completion evidence. Avoid turning the cockpit into an unrestricted Kubernetes shell.

## BookOrbit Import Hardening

Audit BookOrbit scanning, metadata extraction, OPDS behavior, first-user setup, and write-back cost against the shared `books` library.

The library is currently mounted read-write because BookOrbit can update embedded metadata. Any hardening must preserve that intended behavior or explicitly change it after data-safety validation.

## Utility-Node Placement Review

Use current node capacity, image architecture support, storage locality, and I/O demand to identify additional workloads that can safely move to the ARM utility node.

Do not maintain a candidate list here. Derive it from current manifests and measurements when the work starts.

## Public Edge Reproducibility And Smoke Checks

Move the remaining Cloudflare Access, WAF, and cache behavior into reproducible configuration where the provider supports it, and add scheduled end-to-end checks for permanent sites and temporary share toggling.

## Unified Static-Site Origin

Evaluate whether the public static sites can share one lightweight multi-host runtime without coupling independent release and rollback boundaries.

A viable design must keep one pinned artifact version per site and update one site without rolling every site together. If that cannot be achieved cleanly, the current separate deployments are the better tradeoff.

## Control Panel Motion

Review motion in `apps/exposure-control/app.js` and `apps/exposure-control/styles.css`:

- Keep Secrets filtering immediate, without replaying entry animations on every keystroke.
- Use short transform/opacity transitions for mode controls and changed overview readings, avoiding animated layout dimensions.
- Preserve brief appearance feedback under reduced motion while disabling movement and continuous animation.
- Distinguish first-load skeleton replacement from ordinary refreshes. Any success effect should be brief and local to the completed action.

Inspect the current selectors and behavior before implementation. Preserve theme persistence, routing controls, and explicit key-row feedback; add no runtime dependencies solely for motion.

## Control Panel Flux And Alert Views

Evaluate read-only Pulse views for Flux readiness and Prometheus alert state, with an optional aggregate status indicator. Reuse the existing bounded query proxy and recording rules; keep missing telemetry visibly unavailable.

Derive resource and rule counts from current data. Prometheus firing state does not account for Alertmanager silences or inhibitions. Preserve keyboard access, reduced motion, and refresh behavior when the page is hidden. Verify with fixtures or isolated test rules rather than disrupting production to generate an alert.
