---
title: Documentation Conventions
summary: Rules that keep repository docs and project-local skills aligned with the current implementation.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Documentation Conventions

## Contract

Repository documentation is an operational projection of the current tree. It is not an archive.

- `README.md` gives the human-facing overview.
- `docs/README.md` routes readers to focused current-state guidance.
- `docs/*.md` records active architecture, operating contracts, non-obvious constraints, and reusable recovery procedures.
- `.agents/skills/*/SKILL.md` owns repeatable workflows, safety gates, and verification steps.
- Git history owns superseded decisions, completed migrations, and incident chronology.

Implementation wins when prose and source disagree. Correct or remove the prose in the same change.

## What Belongs In Current Docs

Keep content that answers at least one current operational question:

- What is deployed and where is its source of truth?
- What access, storage, security, or scheduling constraint applies now?
- Which files must change together?
- How is the current behavior verified or recovered?
- Why does a non-obvious current tradeoff exist?

Past context may remain only when removing it would make the current design unsafe or misleading. State the active rule first, then keep the rationale to the minimum necessary.

## What Does Not Belong

Delete or rewrite:

- completed plans, phases, and migration checklists
- incident timelines and command transcripts
- superseded options or rejected-product evaluations
- retired services, PVCs, hostnames, and temporary compatibility notes that no longer apply
- aspirational behavior presented as implemented
- volatile live status copied into prose when the source can be queried directly

When a plan lands, replace it with a current operating doc or delete it. When an incident closes, move only the durable guardrail into the owning current doc or skill, then delete the incident record.

## Focused Doc Format

Every focused file under `docs/`, except `docs/README.md`, carries:

```yaml
---
title: <human title>
summary: <one-sentence current scope>
status: active
owner: homelab
last_reviewed: YYYY-MM-DD
---
```

`active` is the only accepted status. Draft proposals belong in issues, plans, or `ideas.md`, not in the current docs index.

Use repository-relative paths, concrete Kubernetes object names, and executable verification commands. Avoid duplicating version numbers or inventories already expressed in manifests unless the exact value is itself an operator constraint.

## Skills

Every project-local `SKILL.md` must:

- include `name` and `description` front matter
- say when it applies
- route factual context to focused docs
- describe workflow, guardrails, and verification
- use repository-relative paths
- inspect current source instead of carrying lists that drift, such as every service, node assignment, or image tag

## Mechanical Checks

Run:

```bash
make check-docs
```

`scripts/check_docs.py` verifies the entrypoints, focused-doc metadata, active-only status, review dates, linked index coverage, local links/headings, literal repository paths, project-local skill metadata/UI portability, and obvious historical/completed section headings. Fenced examples and template paths are excluded from reference checks. `make check-docs` also runs the checker's fixture-based regression tests.

Review dates use `Asia/Singapore`, matching the cluster's operating timezone even when CI runs in UTC. Future dates and reviews older than 180 days fail the gate.

The checker is a floor. A document can pass structure checks and still be wrong; compare its claims with the implementation whenever its domain changes.
