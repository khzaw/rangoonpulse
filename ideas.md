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

## Convenience-First Autonomous Cluster Operators (Iris + Athena)
- Owner preference: prioritize hands-off operation and convenience over elaborate least-privilege isolation. OpenClaw (Iris) and Hermes (Athena) on the Apple Silicon Mac mini are trusted operators, primarily controlled through Slack (also Telegram for Iris), with existing access to this repo. Do not redesign or disrupt their native setups just to add cluster access.
- Intended autonomy: diagnose cluster-wide, read logs and necessary Secrets, exec into pods, restart/scale workloads, run maintenance, reconcile Flux, and maintain applications/infrastructure. Routine changes and supported upgrades with a clear recovery path should not require approval; send concise Slack summaries after meaningful actions.
- Use GitOps for durable changes, including autonomous commits/pushes. Permit direct Kubernetes recovery actions when needed, then bring Git back into alignment. Verify rollout and user-facing health after changes, and coordinate the agents so they do not operate on the same service concurrently.
- Privilege decision: dedicated cluster-admin credentials per agent are acceptable for this trusted, convenience-first homelab model; do not default back to read-only access or restrictive app-only RBAC. Separate identities support attribution/revocation, not isolation while both agents share macOS user `iris`. Approval rules are behavioral guardrails, not enforced containment; unrestricted writes to the Flux source are already an administrative path.
- Ask first only for exceptional actions: intentional persistent-data destruction, cluster rebuilds/storage wipes, new public exposure or substantially broader access, and risky irreversible migrations without a verified recovery path.
- Implementation TODOs:
  - Recheck current credentials before provisioning: SSH inspection found `~/.kube/config` using an expired `system:masters` admin certificate (expired 2026-09-29); API requests returned Unauthorized. Do not treat the existing kubeconfig as working access.
  - Provision separate operator identities with dependable unattended credential renewal/rotation, revocation instructions, and expiry monitoring. Keep credentials out of Git and preserve independent human break-glass access.
  - Keep operator credentials separate from the existing narrowly scoped watchdog identity; preserve the monitoring setup in [`docs/iris-operations.md`](docs/iris-operations.md).
  - Verify backups and restoration for persistent data: reverting Git restores desired configuration, not deleted data, destructive migrations, or leaked credentials. Tailnet-only access reduces exposure but does not prevent operator mistakes or prompt injection.
  - Preserve existing agent configs/processes and uncommitted repo work. Identify the active checkout before implementation; the inspected checkout had substantial local changes and lagged its locally recorded upstream.
- Status: planning only; this entry does not provision access or authorize destructive work.
