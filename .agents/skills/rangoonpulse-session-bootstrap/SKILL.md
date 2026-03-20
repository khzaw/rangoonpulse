---
name: rangoonpulse-session-bootstrap
description: "Mandatory bootstrap for any new session or takeover in /Users/khz/Code/rangoonpulse. Read AGENTS.md, README.md, and docs/README.md first, then the smallest relevant focused docs, before planning, reviewing, debugging, answering repo questions, or editing GitOps manifests."
---

# Rangoonpulse Session Bootstrap

## Overview

This skill is the entry gate for work in `/Users/khz/Code/rangoonpulse`.
Do not start substantive work until the startup docs have been read in order and the task's focused docs have been chosen from the docs index.

Use this skill for every new session, session takeover, or repo question that depends on cluster conventions.

## Startup Sequence

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

Before planning, reviewing, debugging, or editing, read these files in order:
1. `/Users/khz/Code/rangoonpulse/AGENTS.md`
2. `/Users/khz/Code/rangoonpulse/README.md`
3. `/Users/khz/Code/rangoonpulse/docs/README.md`

Then use `/Users/khz/Code/rangoonpulse/docs/README.md` to choose focused docs:
- Single-service or single-component work: read at least one focused doc for that area.
- Cross-cutting work: read at least one focused doc for each affected domain.
- Incident/debugging work: read the incident or gotcha doc that most closely matches the symptom before proposing fixes.
- Repo questions or architecture recommendations: read the docs that define the touched operating domain before answering.

## Working Rules

- Treat the startup trio as mandatory, even for small asks, reviews, and architecture questions.
- If work began before bootstrapping, stop and read the startup trio before continuing.
- Do not start with manifest edits before reading the docs trio above.
- Do not brute-force every file in `docs/`; use the docs index to target the relevant material.
- In the first substantive update, state which focused docs were consulted and the constraints they impose.
- If the task changes an operating convention, update `docs/README.md` and the focused doc that owns that convention in the same change.
- If no focused doc exists for a recurring operational area, add one and link it from `docs/README.md` and `AGENTS.md`.

## Minimum Context To Extract

Before proceeding, make sure the startup docs have established these repo-level facts:
- GitOps-first workflow with Flux as the source of truth
- current access model, ingress VIP, and DNS/TLS patterns
- node placement policy and storage constraints
- secrets handling expectations
- how `docs/README.md` routes task-specific reading

If any of those are still unclear, keep reading focused docs before making recommendations or edits.

## Expected Outcome

After bootstrap, the agent should understand:
- the repo-wide GitOps and documentation rules
- the current cluster/access/storage conventions
- which focused docs own the task's operating context
