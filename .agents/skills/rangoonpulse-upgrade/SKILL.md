---
name: rangoonpulse-upgrade
description: "Use whenever the user asks to upgrade, update, bump, or move a service to a newer version in /Users/khz/Code/rangoonpulse. Treat the service name in the request as the parameter. First check https://controlpanel.khzaw.dev/api/image-updates for that service, then analyze the repo's manifests plus README.md, AGENTS.md, and the docs corpus before making any change. This skill is for safe GitOps upgrades with explicit data-loss checks and user confirmation when stateful or risky migrations are involved."
---

# Rangoonpulse Upgrade

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

This skill is implicit for upgrade work in this repo. If the user asks to `upgrade`, `update`, `bump`, or move a service to a newer version, apply this workflow immediately.

The service name in the request is the parameter. If the request is ambiguous, resolve the intended service from the repo and the control panel update list before editing anything.

## Non-Negotiable Rules

- Use GitOps. Permanent changes must land in repo manifests, not ad hoc `kubectl apply`.
- Read `/Users/khz/Code/rangoonpulse/AGENTS.md`, `/Users/khz/Code/rangoonpulse/README.md`, and `/Users/khz/Code/rangoonpulse/docs/README.md` first.
- Consult the docs corpus before changing the service. Use repo-wide search across `docs/` to find all service mentions and upgrade-risk docs, then read the matched files and the core operational docs below.
- Always check the control panel image-updates source before planning an upgrade:

```bash
curl -s https://controlpanel.khzaw.dev/api/image-updates | jq
```

- If the control panel does not show an update for the requested service, stop and tell the user unless they explicitly want a manual version jump that bypasses the updates view.
- Never assume the correct edit path. First determine whether the service version is controlled by:
  - an inline image tag in `helmrelease.yaml`
  - a separate values file
  - a chart version
  - Flux image automation markers
  - a multi-release layout with sidecars or companion databases
- If there is any plausible risk of data loss, schema breakage, PVC migration, DB upgrade work, or state reset, do not proceed silently. Explain the risk and let the user make the final call.

## Required Reading For Upgrade Work

Always read:
- `/Users/khz/Code/rangoonpulse/AGENTS.md`
- `/Users/khz/Code/rangoonpulse/README.md`
- `/Users/khz/Code/rangoonpulse/docs/README.md`
- `/Users/khz/Code/rangoonpulse/docs/backup-plan.md`
- `/Users/khz/Code/rangoonpulse/docs/ops-command-cheatsheet.md`
- `/Users/khz/Code/rangoonpulse/docs/secrets-inventory.md`

Then consult the full `docs/` corpus pragmatically:
- run a repo-wide search over every file in `docs/` for the service name and common upgrade-risk terms such as `upgrade`, `update`, `migration`, `backup`, `restore`, `sqlite`, `postgres`, `mariadb`, `pvc`, `storageClass`, and `state`
- read every matched doc, plus any service-specific doc linked from `docs/README.md`
- if the service touches storage, databases, or data migration patterns, also read the owning incident/runbook docs before changing manifests

For common repo risk patterns, prioritize these docs when relevant:
- `/Users/khz/Code/rangoonpulse/docs/media-postgres.md`
- `/Users/khz/Code/rangoonpulse/docs/vaultwarden-db-timeouts-and-postgres-reset.md`
- `/Users/khz/Code/rangoonpulse/docs/uptime-kuma-sqlite-on-nfs-timeouts.md`
- `/Users/khz/Code/rangoonpulse/docs/study-services-livesync-anki-booklore.md`
- `/Users/khz/Code/rangoonpulse/docs/calibre-storage-migration-to-truenas-nfs.md`
- `/Users/khz/Code/rangoonpulse/docs/reactive-resume.md`
- `/Users/khz/Code/rangoonpulse/docs/transmission-optional-vpn.md`
- `/Users/khz/Code/rangoonpulse/docs/resource-advisor-phase1-phase2.md`

## Workflow

### 1. Preflight The Upgrade

Check the control panel first:

```bash
curl -s https://controlpanel.khzaw.dev/api/image-updates | jq
```

Match the requested service against the control panel payload or the `#updates` page before editing anything.

Then inspect the repo directly:

```bash
rg -n "<service>|upgrade|update|migration|backup|restore|sqlite|postgres|mariadb|pvc|storageClass|state" docs apps infrastructure flux README.md AGENTS.md
```

Use those results to answer these questions before editing:
- Does `controlpanel.khzaw.dev/api/image-updates` show `updateAvailable=true` for this service?
- What are the current and latest versions according to the control panel?
- Which manifests, values files, Flux objects, and docs mention this service?
- Are there persistence or database signals such as `local-path`, `truenas-*`, `postgres`, `sqlite`, `mariadb`, `couchdb`, `existingClaim`, or `/data` mounts?
- Does the service have sidecars, companion releases, or shared database dependencies that also need review?

If the control panel does not give a unique or obvious match:

```bash
curl -s https://controlpanel.khzaw.dev/api/image-updates | jq
```

Inspect the `#updates` page manually when the JSON payload alone is not enough:

```text
https://controlpanel.khzaw.dev/#updates
```

### 2. Analyze Upgrade Risk Before Editing

Produce a concise analysis in your working notes or user update:
- source of truth for the version bump
- whether the service is stateless, stateful, or mixed
- storage class and persistence layout
- database/backing service dependencies
- likely rollback path
- whether the change is a routine patch/minor bump or a potentially breaking jump

Treat these as confirmation-required by default:
- Postgres, TimescaleDB, MariaDB, Redis, CouchDB, SQLite, or schema-dependent apps
- any service on `local-path` where rollback may involve node-local state
- upgrades involving storage class changes, PVC moves, migration docs, or reset runbooks
- services with known historical incidents around state handling
- multi-container apps where the requested service update implies coordinated companion image changes

When confirmation is required, stop and present:
1. the requested target version
2. the specific risk to state/data
3. what backup or snapshot evidence exists in docs
4. the safest next action

Proceed only after the user chooses.

### 3. Implement The GitOps Change

Update only the real source of truth. Common cases:
- inline image tag in `apps/<service>/helmrelease.yaml`
- separate values file such as `apps/<service>/values.yaml`
- companion release in another path, for example `apps/vaultwarden-postgres/helmrelease.yaml`
- chart version if the service is packaged as a chart and the version change belongs there

Check surrounding release structure before editing:
- service directory under `apps/`
- related Flux kustomization under `flux/kustomizations/`
- secret or migration dependencies under `infrastructure/`
- docs or README references if the change alters operating guidance

Do not introduce new persistence layouts or reset workflows as part of a normal upgrade unless the user explicitly approves that migration.

### 4. Validate Before And After

Before committing:

```bash
kubectl apply --dry-run=client -f <changed-file>
kubectl kustomize apps/<service-dir> >/tmp/<service>.yaml
kubectl apply --dry-run=client -f /tmp/<service>.yaml
```

After the repo change:
- reconcile the smallest relevant Flux kustomization
- check the HelmRelease and pods
- inspect logs/events if rollout fails
- verify the service endpoint if it has one

Useful commands:

```bash
flux reconcile kustomization <name> -n flux-system --with-source
flux get kustomizations -n flux-system | rg '<name>'
flux get hr -A | rg '<service>'
kubectl get pods -A -o wide | rg '<service>'
kubectl get events -n <ns> --sort-by=.lastTimestamp
curl -I --max-time 20 https://<hostname>
```

If the control panel owns the update signal, re-check it after rollout when useful:

```bash
curl -s https://controlpanel.khzaw.dev/api/image-updates?force=1 | jq
```

### 5. Close Out Correctly

In the final response, include:
- what version changed
- where the source-of-truth edit lived
- what validation you ran
- whether there are residual risks or follow-up checks

If you intentionally did not proceed because the upgrade looked risky, say so plainly and explain what blocked safe automation.
