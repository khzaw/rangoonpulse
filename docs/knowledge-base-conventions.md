---
title: Knowledge Base Conventions
summary: Conventions for keeping repository docs and project-local skills structured, navigable, and mechanically checkable.
status: active
owner: homelab
last_reviewed: 2026-03-21
---

# Knowledge Base Conventions

## Purpose

This repo treats repository knowledge as part of the implementation, not as a side channel.

The goals are:
- keep `AGENTS.md` small
- make source-of-truth docs easy to find
- keep procedural guidance separate from factual reference material
- make the structure checkable with lightweight tooling

## Division Of Responsibility

- `AGENTS.md`: bootstrap map, invariants, and routing
- `README.md`: human-facing overview
- `docs/README.md`: docs router
- focused docs in `docs/`: stable facts, architecture notes, incident write-ups, and runbooks
- skills in `.agents/skills/`: repeated procedures, touch-point checklists, and safety guardrails

Do not turn skills into encyclopedias, and do not turn `AGENTS.md` into a runbook dump.

## Focused Doc Conventions

For new or materially reorganized focused docs, add front matter with:

- `title`
- `summary`
- `status`
- `owner`
- `last_reviewed`

Current allowed `status` values:
- `active`
- `draft`
- `historical`

Preferred doc characteristics:
- concrete file paths instead of vague prose
- Kubernetes object names where relevant
- commands that operators can actually run
- links from `docs/README.md`

Backfill policy:
- existing docs do not need to be normalized all at once
- add front matter when you create a new focused doc or substantially refactor an existing one

## Skill Conventions

Every `SKILL.md` should:

- include `name` and `description` front matter
- state when the skill should be used
- point to the focused docs that remain the source of truth
- describe workflow, guardrails, validation, and touch points

Skills should minimize duplication. If a detail is likely to drift, keep the fact in `docs/` and let the skill route to it.

## Mechanical Checks

The local checker is:

- `scripts/check_docs.py`

The Make target is:

- `make check-docs`

Current checks are intentionally lightweight:
- required entrypoint docs exist
- canonical knowledge-base docs carry front matter
- every project-local skill carries front matter
- every project-local skill references repo docs
- every `docs/*.md` file is mentioned in `docs/README.md`

Tighten these checks gradually instead of introducing a large docs framework in one pass.

## When To Add A Doc vs A Skill

Add or extend a focused doc when the content is primarily:
- current architecture
- operating facts
- stable conventions
- incident history
- recovery steps

Add or extend a skill when the content is primarily:
- how to execute a recurring task safely
- what to inspect before editing
- what side surfaces must be updated together
- what validations prove the task is actually done
