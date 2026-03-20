---
title: Repository Architecture Map
summary: Top-level map of the repo's operating domains, source-of-truth locations, and how agents should navigate them.
status: active
owner: homelab
last_reviewed: 2026-03-21
---

# Repository Architecture Map

## Purpose

This document is the top-level navigation map for repository knowledge.
It answers two questions:

- where the source of truth for a given operating domain lives
- which files an agent should read before editing that domain

## Knowledge Layout

- `AGENTS.md`: short bootstrap map and repo invariants
- `README.md`: human-friendly cluster overview
- `docs/README.md`: routing index for focused docs
- `docs/*.md`: source of truth for operating facts, runbooks, incidents, and stable conventions
- `.agents/skills/*/SKILL.md`: procedural workflows, safety checks, and repeated operator playbooks

Rule of thumb:
- facts belong in docs
- workflows belong in skills
- bootstrap routing belongs in `AGENTS.md`

## Repo Domains

### `apps/`

User-facing workloads, usually one app per directory.

Typical files:
- `apps/<name>/helmrelease.yaml`
- `apps/<name>/kustomization.yaml`
- ingress, PVC, or secret references when the app needs them

When working here, also inspect:
- `flux/kustomizations/<name>.yaml`
- `flux/kustomization.yaml`
- any focused doc for the service domain in `docs/README.md`

### `core/`

Cluster foundation pieces that support many apps.

Current examples:
- ingress controllers
- shared controller patches

Changes here usually have wider blast radius than app-local edits.

### `infrastructure/`

Shared platform services and operator components.

Current examples:
- storage
- monitoring
- secrets
- DNS helpers
- public edge
- resource advisor

Treat these directories as the source of truth for the running platform behavior, and pair edits with the owning focused doc.

### `flux/`

Flux sources, kustomizations, and shared substitutions.

Important files:
- `flux/kustomization.yaml`
- `flux/kustomizations/*.yaml`
- `flux/cluster-settings.yaml`

Use this domain when wiring new workloads into GitOps or changing shared non-secret cluster constants.

### `talos/`

Talos machine configuration and node-level settings.

Talos remains explicit and is not part of the Flux substitution path. If node IPs or control-plane details change, verify whether Talos config also needs a manual update.

### `docs/`

Versioned knowledge base for stable facts, focused runbooks, and incident history.

Use `docs/README.md` as the router rather than scanning every file.

### `.agents/skills/`

Project-local procedural guidance for repeated workflows.

Current examples:
- bootstrap and shared-worktree behavior
- service deployment
- upgrades
- cluster conventions
- access and edge changes
- AdGuard DNS
- resource advisor

## Common Cross-Cutting Touch Points

Service changes often span more than one domain. Before declaring a change complete, check whether it should also touch:

- `apps/glance/helmrelease.yaml` for dashboard links or monitors
- `apps/exposure-control/services.json` if the service should be share-managed
- `infrastructure/resource-advisor/advisor.py` and related policy if the service should be auto-tuned
- ingress, DNS, and TLS wiring if external reachability changed
- the owning focused doc under `docs/`

## Navigation Rules

1. Start with `AGENTS.md`.
2. Read `README.md`.
3. Read `docs/README.md`.
4. Open the smallest focused doc set for the touched domain.
5. Use the matching project-local skill when the task is procedural or safety-sensitive.

Prefer progressive disclosure over bulk loading. The goal is to read the minimum set that makes the next edit correct.

## Maintenance

- If a stable operating convention changes, update the owning focused doc and `docs/README.md` in the same change.
- If a repeated workflow is showing up in many tasks, add or refine a project-local skill instead of expanding `AGENTS.md`.
- If a doc becomes purely historical, mark it as such in its front matter when you next touch it and keep it linked only where the historical context is still useful.
