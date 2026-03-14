---
name: rangoonpulse-session-bootstrap
description: "Use when starting a new session or taking over work in /Users/khz/Code/rangoonpulse. Bootstrap repo context by reading AGENTS.md, README.md, and docs/README.md, then study the focused docs listed there before planning, reviewing, debugging, or editing GitOps manifests."
---

# Rangoonpulse Session Bootstrap

## Overview

Read the repo's startup docs in a fixed order before doing substantive work.
Use the docs index to choose the smallest focused set of docs that match the task.

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

## Working Rules

- Do not start with manifest edits before reading the docs trio above.
- Do not brute-force every file in `docs/`; use the docs index to target the relevant material.
- In the first substantive update, state which focused docs were consulted and the constraints they impose.
- If the task changes an operating convention, update `docs/README.md` and the focused doc that owns that convention in the same change.
- If no focused doc exists for a recurring operational area, add one and link it from `docs/README.md` and `AGENTS.md`.

## Expected Outcome

After bootstrap, the agent should understand:
- the repo-wide GitOps and documentation rules
- the current cluster/access/storage conventions
- which focused docs own the task's operating context
