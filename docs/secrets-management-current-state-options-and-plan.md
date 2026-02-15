# Secrets Management: Current State, Options, and Agreed Plan

## Purpose
This document captures the current state of secrets handling in the homelab cluster, evaluates practical options under budget and resource constraints, and records the agreed plan for later implementation.

## Current State
- Secrets are currently managed as native Kubernetes `Secret` objects.
- Secret creation and updates are mostly CLI-driven.
- No SOPS, Sealed Secrets, or external secret manager is currently in place.
- Flux CD is already used for GitOps delivery, but secret encryption/decryption flow is not configured.
- A centralized UI for secret management is not currently in use.
- Lens is available, but secret visibility appears limited (likely RBAC-related for the current kube context/account).

## Constraints and Requirements
- Budget-constrained: avoid paid secret platforms and expensive managed services.
- Resource-constrained: keep memory/CPU overhead low.
- Prefer GitOps-compatible workflows.
- Desire for centralized management UX (ideally UI), even if introduced in phases.
- Avoid introducing high operational complexity for marginal benefit.

## Options

### Option 1: Flux + SOPS (`age`) for Git-encrypted secrets
What it is:
- Encrypt secret manifests in Git with SOPS.
- Flux decrypts at reconcile time and applies plain Kubernetes `Secret` objects to the cluster.

Pros:
- Strong fit for current GitOps model.
- No paid dependency.
- Very low runtime overhead.
- Clear audit trail in Git without storing plaintext secrets.

Cons:
- No built-in centralized UI for secret editing.
- Requires key lifecycle handling (`age` private key).

Best fit:
- Baseline security improvement with minimal operational cost.

### Option 2: Keep native Kubernetes Secrets + add UI (Headlamp or Kubernetes Dashboard)
What it is:
- Continue using Kubernetes `Secret` objects.
- Add an in-cluster UI for viewing/editing resources.

Pros:
- Fastest way to gain a centralized UI.
- Low to moderate overhead.
- No mandatory change to existing secret architecture.

Cons:
- Secret model remains native K8s (base64 data in etcd unless etcd encryption-at-rest is configured).
- Requires tight RBAC controls to avoid excessive exposure.

Best fit:
- Immediate operator UX improvement while larger secret architecture remains unchanged.

### Option 3: External Secrets Operator + Vaultwarden/Bitwarden integration path
What it is:
- Manage source secrets outside K8s and sync into cluster through ESO.
- Can be done through Bitwarden/Vaultwarden-compatible patterns.

Pros:
- Centralized secret source and optional UI workflow.
- Better separation between secret source and runtime cluster objects.

Cons:
- More components and moving parts.
- Higher setup and troubleshooting complexity than Option 1.
- Vaultwarden integration is workable but not as straightforward as native enterprise secret manager providers.

Best fit:
- Phase 2+ if centralized UI-driven secret lifecycle becomes a priority.

### Option 4: Full secret platform with UI (for example Infisical or OpenBao)
What it is:
- Deploy and operate a dedicated secrets platform.

Pros:
- Rich policy, UI, API, and secret lifecycle features.

Cons:
- Heavier resource usage.
- More operational burden.
- Overkill for current scale and constraints.

Best fit:
- Not recommended now for this homelab profile.

## Comparison Summary
- Best immediate security/effort: Option 1 (Flux + SOPS).
- Best immediate UX with low change risk: Option 2 (native secrets + UI).
- Best future centralized model: Option 3 (ESO + external source), if needed later.

## Agreed Plan (Shelved for Later)
The agreed direction is:
1. Phase 1 (next implementation window): adopt `SOPS + age` with Flux.
2. Phase 2 (optional, UX-focused): add lightweight UI for cluster resource ops (Headlamp or Dashboard) with strict RBAC.
3. Phase 3 (optional, if needed): evaluate ESO with Vaultwarden/Bitwarden path for centralized source-of-truth secrets.

## Phase 1 Outline (When Resumed)
1. Generate and securely store an `age` keypair.
2. Store the decryption key in-cluster for Flux (`flux-system`).
3. Configure SOPS creation rules for this repo.
4. Convert existing plaintext secret manifests to encrypted SOPS manifests.
5. Reconcile Flux and verify decryption/apply success.
6. Remove plaintext secret material from repo history going forward.

## Operational Notes
- For Lens secret visibility, verify RBAC before assuming product limitation:
  - `kubectl auth can-i list secrets -A`
  - `kubectl auth can-i get secrets -n default`
- Even after SOPS adoption, runtime secrets are still Kubernetes `Secret` objects in-cluster.
- Keep this document as the canonical checkpoint for resuming secrets work.
