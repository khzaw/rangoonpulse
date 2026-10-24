---
name: rangoonpulse-shared-worktree
description: "Baseline for rangoonpulse work: preserve concurrent edits, keep scope exact, validate, publish requested changes, and verify the remote result."
---

# Rangoonpulse Shared Worktree

Use this skill for every rangoonpulse work cycle after reading `AGENTS.md`, `README.md`, and `docs/README.md`.

## Scope First

Honor the request type:

- audit, review, investigation, or plan: stay read-only unless the user asks for changes
- implementation or maintenance: edit, validate, commit, push, and verify the requested coherent change
- cluster rollout: reconcile and verify live behavior only when the task changes running state or explicitly requests deployment

Do not turn read-only work into a commit or live action.

## Shared Checkout Rules

Before editing, staging, or committing:

```bash
git status --short --branch
git diff --name-only
git diff --cached --name-only
```

- Treat unrelated modifications as concurrent work, not an automatic blocker.
- Never revert, overwrite, unstage, or commit another person's or agent's changes.
- If the same file contains mixed ownership, inspect both staged and unstaged hunks and stage only the task's hunks.
- Re-read status and the exact diff after long commands because the checkout can move underneath the task.

## Refresh

Every work cycle starts with current remote state:

```bash
git fetch --prune
```

Fast-forward the current branch when the worktree is clean. If unrelated changes prevent a safe pull, preserve them and reason from current local plus fetched remote state rather than stashing someone else's work.

## Validation

Use the smallest task-specific checks while editing, then run the repository's canonical safe gate before publication:

```bash
make validate-all
```

Inspect the exact intended diff and run `git diff --check`.

## Publish

For change requests, stage exact paths or hunks, use the repo's `<subsystem>: <present-tense action>` manual commit style, and push the current branch. On `master`, push `master` unless the user requests another flow.

Before committing, re-check:

```bash
git status --short
git diff --cached --check
git diff --cached
```

After pushing, verify:

```bash
git status --short --branch
git log -1 --oneline --decorate
git rev-list --left-right --count HEAD...@{u}
git ls-remote origin refs/heads/$(git branch --show-current)
```

Local HEAD, upstream, and the remote ref must agree.

## Reporting

Report the current result: changed behavior or guidance, validation evidence, commit, push, and any real remaining blocker. For debugging, explain the active failure boundary and the evidence that proved the fix. Do not turn the final message or repo docs into an incident diary.
