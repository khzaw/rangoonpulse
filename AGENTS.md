# AGENTS.md - rangoonpulse

This is the repository entrypoint for agent sessions. Keep it short and current.

## Start Here

1. Refresh Git state and inspect the shared worktree.
2. Read `README.md` and `docs/README.md`.
3. Load `.agents/skills/rangoonpulse-shared-worktree/SKILL.md` as baseline behavior.
4. Open only the focused docs and project-local skill that match the task.

Use repository-relative paths. The checkout location differs between operators and agents.

## Sources Of Truth

- Desired cluster state: `apps/`, `core/`, `infrastructure/`, and `flux/`
- Shared non-secret constants: `flux/cluster-settings.yaml`
- Current operating guidance: `docs/`
- Repeated procedures and safety gates: `.agents/skills/`
- Historical decisions and superseded designs: Git history, not current docs

If prose conflicts with manifests or code, treat the implementation as authoritative and fix the prose in the same change.

## Repo Invariants

- Use Flux GitOps for permanent cluster state. Direct `kubectl apply` is for validation or an explicitly controlled operator action only.
- Prefer `HelmRelease` changes over raw manifests when the existing deployment pattern supports it.
- Keep app configuration inline in `helmrelease.yaml` unless separation has a concrete maintenance benefit.
- Put cluster-wide non-secret constants in `flux/cluster-settings.yaml`.
- Escape runtime-literal placeholders as `$${VAR}` when Flux post-build substitution is active.
- Never commit plaintext credentials. Git-managed secrets stay SOPS-encrypted under `infrastructure/secrets/`.
- Before requesting a GitHub token, consult `docs/github-credentials.md` for existing credentials, required permissions, and reuse guidance.
- Keep ingress, DNS ownership, and TLS configuration aligned for reachable services.
- Do not couple redundant critical services into one rollout unit.
- This is a shared worktree. Preserve unrelated edits and stage only the task's files or hunks.
- Commit directly to the current branch. On `master`, use `<subsystem>: <present-tense action>` and push `master` unless the user says otherwise.

## Task Routing

Use the smallest matching project-local skill:

- `rangoonpulse-service-deploy`: add, move, rename, expose, or materially change a service
- `rangoonpulse-upgrade`: bump a chart, image, controller, or service version
- `rangoonpulse-cluster-conventions`: placement, storage, shared settings, ingress/TLS, secrets, and ordinary manifests
- `rangoonpulse-access-and-edge`: Tailscale, ingress, public edge, exposure-control, share hosts, Transmission VPN routing, and hostname exceptions
- `rangoonpulse-adguard-dns`: dual AdGuard and LAN DNS
- `rangoonpulse-resource-advisor`: tuning automation and cockpit integration

If no skill applies, use `docs/README.md` to find the owning current-state doc.
Miniflux's RSS, shared PostgreSQL, and administrator bootstrap contract is in `docs/miniflux.md`.

New apps must meet `docs/service-onboarding.md`: dashboard/monitor, update management, disabled share wiring, tuning/HPA policy, secrets inventory, and live verification. For existing services, keep the affected integrations consistent without expanding a narrow fix into unrelated onboarding work.

## Documentation Standard

- Docs describe the current implementation, operating contract, and non-obvious constraints that still apply.
- Do not keep completed plans, migration checklists, incident timelines, superseded options, or retired-service notes in the current corpus.
- Retain past rationale only when it is necessary to explain a present-day tradeoff. State the active constraint first and keep the history to the minimum needed.
- When a plan lands, replace it with current operating guidance or delete it.
- When an incident is resolved, absorb any reusable guardrail into the owning current-state doc or skill, then delete the incident record.
- Update or remove stale docs in the same change as the implementation that invalidates them.

## Validation

- Use the smallest meaningful task-specific checks before the canonical repository gate.
- Run `make validate-all` before push unless the change is explicitly eligible for a narrower documented fast path.
- For resource, replica, placement, or new-workload changes, render the workloads and run the Git/CI and live CPU headroom preflights in `docs/cpu-headroom-validation.md`. Check HPA maximum replicas separately; there is no live admission webhook.
- Inspect the exact staged diff, commit only intended work, push, and verify local and remote refs agree.
- For debugging or service changes, report the current failure boundary, evidence, decision, and verification. Do not preserve the investigation diary in repo docs.
