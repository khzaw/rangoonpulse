---
name: rangoonpulse-upgrade
description: "Use for rangoonpulse chart, image, controller, or service upgrades with current ownership, release-note, data-risk, GitOps, and rollout verification."
---

# Rangoonpulse Upgrade

Read `docs/dependency-updates-renovate-and-flux-image-automation.md`, `docs/data-protection.md`, and the affected service/platform doc.

## Determine Ownership First

Identify whether the version is controlled by:

- Renovate
- Flux image automation
- Helm chart version
- manual image pin or compatibility exception
- generated controller manifest

The control panel image-updates view is supporting evidence, not a hard gate. It compares live images with registry tags and can disagree with Git ownership, policy, or chart-managed images.

## Current-State Risk Analysis

Inspect current manifests and authoritative upstream release notes for:

- database/schema migrations
- PVC or storage changes
- architecture support
- companion images and sidecars
- API/CRD compatibility
- destructive reconciliation behavior
- backup and rollback evidence

Known history is not itself a blocker. Current data layout and release requirements determine risk.

Establish authorization before a destructive migration, reset, incompatible database jump, or irreversible state change; honor approval already given in the session. Routine compatible patches can proceed through the normal GitOps path.

## Implement

Change only the actual owner field. Do not make Renovate and Flux image automation own the same version.

For controllers such as ExternalDNS, validate behavior changes that can delete external state with non-destructive/dry-run policy before restoring sync mode.

For Flux controllers, remember that `flux/flux-system/gotk-components.yaml` is not in the ordinary root reconciliation path; follow `docs/flux-web-ui.md`.

## Validate And Publish

Render and dry-run the affected app/platform tree, then run `make validate-all`. Commit and push the exact change.

For live upgrade requests:

1. reconcile source and owning Kustomization/HelmRelease
2. verify rollout and exact image/chart revision
3. inspect events/logs and persistent dependencies
4. test the real service endpoint
5. check stability, restarts, and data behavior

If the change is risky or ownership is ambiguous, stop with the concrete blocker rather than performing a speculative version edit.
