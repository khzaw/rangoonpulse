# AGENTS.md - rangoonpulse

This file is the repo entrypoint for new agent sessions. Keep it lean.
Detailed operating context belongs in the root `README.md`, `docs/README.md`,
focused docs under `docs/`, and project-local skills under `.agents/skills/`.

## Start Here
- On every new session in `/Users/khz/Code/rangoonpulse`, read in order:
  1. `AGENTS.md`
  2. `README.md`
  3. `docs/README.md`
- Then open the smallest relevant focused doc set before planning, reviewing, debugging, or editing.
- After bootstrap, treat `.agents/skills/rangoonpulse-shared-worktree/` as baseline behavior for the rest of the session.

## Minimal Cluster Snapshot
- Platform: Talos Linux Kubernetes cluster managed with Flux CD GitOps
- Primary workload node: `talos-7nf-osf` (`amd64`, `10.0.0.197`)
- Utility node: `talos-uua-g6r` (`arm64`, `10.0.0.38`)
- Shared ingress VIP: `10.0.0.231`
- Timezone standard: `Asia/Singapore`

## Repo Invariants
- Commit Message Format: For monorepos, use the "xxx: commit msg" pattern, where "xxx" is the subsystem or component being changed (e.g., `iris:`, `feat:`).
- Use GitOps. Do not rely on direct `kubectl apply` for permanent state.
- `kubectl apply --dry-run=client` is fine for validation.
- Prefer `HelmRelease` changes over raw manifests.
- Keep app config inline in `helmrelease.yaml` unless a separate file is clearly warranted.
- Use `flux/cluster-settings.yaml` for cluster-wide non-secret constants.
- Escape runtime-literal placeholders as `$${VAR}` when Flux post-build substitution is in play.
- Do not commit plaintext credentials; Git-managed secrets stay SOPS-encrypted under `infrastructure/secrets/**`.
- Keep ingress, DNS annotation, and TLS settings aligned for externally reachable apps.
- For critical redundant services, do not couple both instances into one risky rollout unit.
- This repo is a shared worktree. Do not revert unrelated edits; stage only your task's hunks.

## Task Routing
Use the matching project-local skill when the task fits:
- `rangoonpulse-service-deploy`: add, move, rename, expose, or materially change a service
- `rangoonpulse-upgrade`: bump a chart, image, or service version
- `rangoonpulse-cluster-conventions`: cluster-wide settings, placement, storage, ingress/TLS, secrets, and ordinary manifest conventions
- `rangoonpulse-access-and-edge`: Tailscale, ingress VIP access model, public-edge, exposure-control, share hosts, Transmission VPN routing, and hostname exceptions
- `rangoonpulse-adguard-dns`: dual AdGuard rollout and LAN DNS behavior
- `rangoonpulse-resource-advisor`: tuning automation, exporter/UI, apply scope, and service auto-tuning integration

If no skill applies, route through `docs/README.md` and read the smallest focused doc set for the touched domain.

## Docs Hygiene
- If you change a stable operating convention, update `docs/README.md` and the focused doc that owns it.
- If you add a recurring workflow or dense operator procedure, prefer a project-local skill or focused doc instead of growing this file.
- If you discover a new operational gotcha or incident pattern, add a focused doc and link it from `docs/README.md`.

## Validation
- Validate manifests before push using the smallest meaningful check for the change (`kubectl apply --dry-run=client`, `kubectl kustomize`, `flux build`, and task-specific checks).
- Before commit/push, inspect `git status` and stage only your task's hunks.
