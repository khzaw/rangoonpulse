---
name: rangoonpulse-service-deploy
description: "Use when adding, deploying, exposing, or materially changing an app or service in /Users/khz/Code/rangoonpulse. This skill is only for the rangoonpulse GitOps repo and covers the full workflow: app manifests, Flux wiring, Glance/dashboard links, image automation, resource-advisor integration, docs, README/AGENTS updates, commit/push, reconcile, and live verification until the service is actually reachable."
---

# Rangoonpulse Service Deploy

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

This repo is GitOps-first. "Done" does not mean "files changed". It means:
- Git changes are committed and pushed.
- Flux has reconciled the change.
- The relevant HelmRelease/Kustomization is ready.
- The workload is healthy.
- If the service is meant to be reachable, the hostname actually works.

## Core Rules

- Read `/Users/khz/Code/rangoonpulse/AGENTS.md` before making service changes.
- Work on the current branch. Do not create a side branch unless the user explicitly asks.
- For this repo, if you are already on `master`, commit and push to `master`.
- Use GitOps manifests for permanent changes. Do not rely on direct `kubectl apply` as the final state.
- Prefer `HelmRelease` edits over raw manifests.
- Do not stop after manifests validate. Reconcile and verify the live result.

## Service Change Checklist

When adding or materially changing a service, update every applicable surface in the same change.

Required app wiring:
- `apps/<name>/helmrelease.yaml`
- `apps/<name>/kustomization.yaml`
- `flux/kustomizations/<name>.yaml`
- `flux/kustomization.yaml`

Required access wiring when externally reachable:
- ingress class `nginx` unless an existing exception applies
- `external-dns.alpha.kubernetes.io/hostname`
- `cert-manager.io/cluster-issuer: letsencrypt-prod`
- matching TLS hosts

Required operator surfaces:
- Glance links and monitors in `apps/glance/helmrelease.yaml`
- Exposure-control catalog in `apps/exposure-control/services.json` if the service should be share-managed
- Public share-host plumbing in:
  - `infrastructure/public-edge/helmrelease.yaml`
  - `infrastructure/public-edge/share-hosts-cname.yaml`
- Resource advisor integration in:
  - `infrastructure/resource-advisor/advisor.py`
  - `infrastructure/resource-advisor/cronjob-apply-pr.yaml`
  - related docs if the apply scope changes
- Image updater integration:
  - exposure-control image tracker eligibility if relevant
  - Flux image automation in `infrastructure/image-automation/` when the workload should have managed image updates

Required documentation surfaces:
- `AGENTS.md`
- `README.md`
- the most relevant focused doc under `docs/`

## Workflow

### 1. Build Context

Before editing:
- inspect the closest existing service in the same category
- inspect Glance, exposure-control, image-automation, and resource-advisor surfaces
- inspect storage and hostname patterns used by adjacent apps

For book/media/study services especially, compare against:
- `apps/calibre/`
- `apps/calibre-web-automated/`
- `apps/booklore/`
- `apps/audiobookshelf/`
- `apps/glance/helmrelease.yaml`
- `apps/exposure-control/services.json`
- `infrastructure/resource-advisor/`
- `infrastructure/image-automation/`

### 2. Implement GitOps State

Add or update the service manifests and all required side surfaces together.

Default expectations:
- pin userland workloads to `talos-7nf-osf` unless the ARM allowlist in `AGENTS.md` says otherwise
- set explicit requests and limits
- keep storage choices consistent with repo conventions
- keep secrets out of plaintext manifests

### 3. Validate Locally

Run the cheapest checks first:

```bash
kubectl apply --dry-run=client -f <file>
kubectl kustomize apps/<name> >/tmp/<name>.yaml
kubectl apply --dry-run=client -f /tmp/<name>.yaml
```

Also validate any additional changed objects, for example:
- Flux kustomizations
- image automation objects
- public-edge manifests
- JSON files with `jq`

If the chart is complex or storage/mount behavior is fragile, render it with Helm and inspect the pod spec.

### 4. Commit And Push

Do not leave the work uncommitted.

Stage only the intended files.

Commit format:
- `<service>: <message>`

Push the current branch after the commit.

### 5. Reconcile

Reconcile the live cluster after the push. Use the smallest relevant scope first.

Typical commands:

```bash
flux reconcile kustomization <name> -n flux-system --with-source
flux get kustomizations -n flux-system | rg '<name>|public-edge|image-automation|external-dns'
kubectl get hr -A | rg '<name>'
kubectl get pods -n <ns> -o wide | rg '<name>'
kubectl get ingress -n <ns> | rg '<name>'
```

If supporting surfaces changed, reconcile them too:
- `public-edge`
- `image-automation`
- `glance`
- `resource-advisor`

### 6. Verify Live Behavior

This is mandatory.

For a normal app deployment, verify:
- Flux kustomization is `Ready=True`
- HelmRelease is `Ready=True`
- rollout completed
- pod is `Running` and ready
- ingress/service endpoints exist if applicable
- DNS resolves if a hostname was added
- the actual URL responds successfully

Typical checks:

```bash
kubectl rollout status deployment/<name> -n <ns> --timeout=180s
curl -I --max-time 20 https://<host>/
curl -I --max-time 20 https://<host>/api/health
dig +short <host> A
```

If the hostname does not work, debug the real boundary instead of guessing:
- DNS resolution
- ingress presence
- service/endpoints
- pod events and logs
- kubelet/runtime logs when a pod is stuck in `ContainerCreating`

Do not declare success until the reachable path actually works for the intended access model.

## Done Criteria

A service change is only complete when all of the following are true:
- manifests and side surfaces are updated together
- docs are updated where the change affects future operations
- commit exists
- push succeeded
- cluster reconcile succeeded
- workload is healthy
- intended URL/path works live

If one of those is still failing, the task is still in progress.
