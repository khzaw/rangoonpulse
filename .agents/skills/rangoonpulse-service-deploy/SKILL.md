---
name: rangoonpulse-service-deploy
description: "Use when adding, deploying, moving, renaming, exposing, or materially changing a service in /Users/khz/Code/rangoonpulse. Complete app GitOps wiring and its dashboard, Control Panel, update management, exposure, tuning, and secrets surfaces through commit, push, reconciliation, and live verification."
---

# Rangoonpulse Service Deploy

Use this skill only in `/Users/khz/Code/rangoonpulse`.

## Read First

Complete the repo bootstrap and follow the shared-worktree skill. Read
[`docs/service-onboarding.md`](../../../docs/service-onboarding.md) before implementing a new app; it owns the
completion checklist, concrete file/API contracts, and evidence requirements. Read its linked focused docs for
the affected domains, including Dynacat, access/exposure, update management, resource advisor, and secrets.

For an existing service change, inspect the same surfaces and keep every affected integration consistent. Do not
expand an unrelated narrow fix into a fleet-wide onboarding exercise.

## Completion Contract

A new app deployment includes all of these in the same task:

- App HelmRelease/manifests, Flux wiring, placement, probes, storage, explicit requests/limits, and appropriate HPA.
- A Dynacat bookmark and relevant Health monitor, verified on the configured dashboard at `rangoonpulse.khzaw.dev`.
- Control Panel image and Helm update rows, refreshed and checked against the deployed versions, plus the intended
  Renovate or selected self-built Flux image maintenance path. Automatic discovery alone is not verification.
- Exposure catalog registration and disabled-by-default share DNS/tunnel plumbing. The canonical app remains
  private unless the user requests public access. A no-share exception must be explicit and documented.
- Resource-advisor integration, a fresh report containing the actual workload/container, and a visible Tuning row.
  Define an intentional apply policy compatible with the HPA; do not omit tuning to avoid deciding that policy.
- Every introduced credential encrypted under `infrastructure/secrets/**`, connected to its consumers, documented,
  and visible with correct ownership and reveal/edit behavior on the Secrets page. Managed TLS stays cert-manager
  owned; inventory its metadata separately where supported. An app with no application credentials needs no fake Secret.
- Focused app documentation and the relevant README/docs/AGENTS routing updates.
- Committed/pushed Git state, reconciled supporting components, and live verification of every required surface.

Mark a surface `N/A` only when it is actually unsupported or inapplicable, and record the technical reason and
evidence. A missing row, stale cache, failed API refresh, or arbitrary scope choice is unfinished work. Preserve
explicit user exceptions and existing session authorization; do not introduce another permission gate for
already authorized deployment work.

## Workflow

### Establish the operating contract

Inspect the closest existing service and all onboarding surfaces before editing. Determine:

- Canonical hostname, private access path, disabled share hostname, and any explicit access exception.
- Container/chart version, architecture, port, runtime user, writable paths, probes, and browser requirements.
- Storage/backup requirements and real credentials, including bootstrap, database, API, widget, and signing secrets.
- Resource limits, bounded replicas, maximum node footprint, and which actor owns resource changes.
- Maintenance path and the exact workload/release identities expected in dashboard and Control Panel rows.

### Implement and validate

Use permanent GitOps state; prefer a HelmRelease and inline app configuration. Do not rely on live-only patches.
Use shared cluster constants and Flux-safe `$${VAR}` for runtime literals. Preserve concurrent edits and use the
current branch unless the user explicitly asks for another flow.

Add the app and supporting integrations together. Inspect current source contracts rather than copying stale
paths or assuming discovery. Validate changed Kustomizations, rendered Helm/pod specs where relevant, embedded
Dynacat configuration, JSON, encrypted Secret wiring, and applicable code checks. Confirm update managers cover
the chosen version representation and that the HPA and tuning policy have compatible scaling semantics.

### Commit, push, and reconcile

Stage only this task's hunks, commit with `<service>: <message>`, and push the current branch. If working on
`master`, commit and push there. Reconcile the app and every changed supporting Flux component: for example
`secrets`, `dynacat`, `exposure-control`, `public-edge`, `resource-advisor`, or `image-automation`.

Wait for ready Flux/Helm objects and completed rollouts. Refresh Control Panel inventory/update caches and run a
fresh advisor report so scheduled jobs or old snapshots cannot hide the new deployment. Follow the advisor doc
when its exporter needs a process restart after a ConfigMap change.

### Verify the real result

Follow the evidence checklist and safe API examples in
[`docs/service-onboarding.md`](../../../docs/service-onboarding.md). Verify:

- Intended DNS, valid TLS, private canonical access, ready endpoints, and a representative app operation.
- The actual Dynacat bookmark and healthy monitor.
- Fresh image and chart rows and the configured update-maintenance policy in Control Panel Updates.
- The Exposure Control row, matching share route, and disabled share state without activating public access.
- Fresh resource-advisor workload/container data, visible Tuning row, correct apply policy, and live HPA metrics/conditions.
- Actual encrypted credential inventory rows, live key/consumer agreement, and appropriate ownership/revealability,
  without printing or capturing secret values. Record cert-manager TLS metadata separately.

Do not stop at manifest validation, a successful HTTP status, or discovery assumptions. Debug the failing boundary
and finish the affected integration. If a real external limitation remains, identify exactly what is unsupported
and what has been verified; do not describe the missing surface as complete.

## Final Handoff

Report the service URL/access model, pushed revision, resources/HPA, and concise live evidence for the required
operator surfaces. Include the shared-worktree skill's operator-learning summary and any explicit, justified
exception. The task is complete only when its app and required integrations work in the intended runtime.
