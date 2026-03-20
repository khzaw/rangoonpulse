---
name: rangoonpulse-shared-worktree
description: "Mandatory for every new session, takeover, and work cycle in /Users/khz/Code/rangoonpulse after bootstrap reading. This skill sets the default shared-worktree behavior: expect concurrent edits, stay calm around unrelated changes, touch only your scope, stage only your hunks, commit on the current branch, push, and verify."
---

# Rangoonpulse Shared Worktree

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

This repo may have multiple agents or a human editing different files at the same time. A dirty worktree is not an incident by itself. Do not stop just because `git status` shows unrelated changes. First determine whether those changes overlap your task. If they do not, leave them alone and proceed.

## When To Use This Skill

Use this skill for every session in this repo after the startup reading is complete.

It remains especially relevant when:
- the user asks for normal repo work plus `commit`, `push`, or `verify`
- `git status` shows changes that may belong to someone else
- you need to finish work without staging unrelated edits
- you are operating in a shared branch or shared worktree

## Non-Negotiable Rules

- Read `/Users/khz/Code/rangoonpulse/AGENTS.md`, `/Users/khz/Code/rangoonpulse/README.md`, and `/Users/khz/Code/rangoonpulse/docs/README.md` first, then any focused docs for the touched domain.
- Do not revert, overwrite, or restage someone else's work just to make the tree look clean.
- Treat unrelated modified files as normal background noise unless they block your task directly.
- If another agent or the user changed the same file, inspect the actual hunks before editing or staging. Work with the current file contents instead of assuming your earlier snapshot is still current.
- Stage only the hunks that belong to your task. Use `git add -p` whenever a file contains mixed ownership or unrelated edits.
- Commit on the current branch unless the user explicitly asks for a different branch flow.
- If you are already on `master`, commit and push to `master`.
- Verification is required. At minimum, prove the commit exists locally, the push succeeded, and the expected task-specific validation passed.

## Workflow

### 1. Inspect The Shared State

Before editing or staging:

```bash
git status --short --branch
git diff --stat
git diff
```

Use that inspection to separate:
- files you own for this task
- files modified by others but unrelated to your task
- files with mixed hunks that need patch staging

If a file overlaps your task and also contains unrelated edits, do not panic. Read the current contents, make the smallest safe change, and plan to stage only your hunks.

### 2. Implement Only Your Scope

- Edit only the files required for the assigned task.
- Keep changes narrow so they are easy to separate from neighboring work.
- If you discover direct overlap that makes ownership ambiguous, pause and reason from the current file state before continuing.

### 3. Validate Before Staging

Run the smallest meaningful checks for your task before committing. Examples:

```bash
kubectl apply --dry-run=client -f <file>
kubectl kustomize <path> >/tmp/rendered.yaml
git diff -- <path>
```

If the task has a repo-specific skill with stronger validation requirements, follow that skill too.

### 4. Stage Only Your Hunks

Prefer explicit file staging when the whole file is yours:

```bash
git add path/to/file
```

When a file contains mixed changes, use patch mode:

```bash
git add -p path/to/file
```

Before committing, verify the staged set exactly matches your task:

```bash
git diff --cached --stat
git diff --cached
```

If unrelated hunks are staged, unstage them before continuing.

### 5. Commit And Push

Use the repo commit convention:

```bash
git commit -m "<scope>: <message>"
git push
```

Do not leave your work as uncommitted local edits when the user asked for a completed change.

### 6. Verify The Finish

After push, verify:

```bash
git status --short --branch
git log -1 --stat
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-list --left-right --count HEAD...@{u}
```

Interpretation:
- `git status` should show only unrelated remaining changes, or be clean if none exist
- `git log -1 --stat` should show your new commit
- upstream should exist
- `git rev-list --left-right --count HEAD...@{u}` should report `0 0` after a successful push

Also run the task-specific verification that proves the change actually worked. For GitOps/service work, that usually means reconcile plus live checks from the relevant repo-local skill.

## Done Criteria

The task is not done until all of these are true:
- only the intended hunks were staged
- the commit contains only your work
- the push completed successfully
- post-push verification passed
- unrelated concurrent edits, if any, were left untouched
