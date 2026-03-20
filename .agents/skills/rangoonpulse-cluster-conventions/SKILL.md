---
name: rangoonpulse-cluster-conventions
description: "Use when editing ordinary GitOps manifests or answering repo architecture questions in /Users/khz/Code/rangoonpulse. Covers shared cluster settings, node placement, storage defaults, ingress/DNS/TLS patterns, secrets handling, PodSecurity baseline, and validation."
---

# Rangoonpulse Cluster Conventions

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

## When To Use

Use this skill when the task involves:
- ordinary app or infrastructure manifest edits
- shared constants in `flux/cluster-settings.yaml`
- node placement or storage choices
- ingress, DNS, TLS, or secrets wiring
- repo questions about default deployment conventions

## Read First

Open the smallest relevant subset:
- `/Users/khz/Code/rangoonpulse/docs/shared-cluster-settings.md`
- `/Users/khz/Code/rangoonpulse/docs/secrets-management-current-state-options-and-plan.md`
- `/Users/khz/Code/rangoonpulse/docs/networking-current-state-and-simplification.md` when hostnames, ingress VIP, or access path matter
- `/Users/khz/Code/rangoonpulse/docs/README.md` for any deeper domain doc routing

## Core Rules

- Flux GitOps is the source of truth. Validation-only `kubectl apply --dry-run=client` is fine; permanent state must come from Git.
- Prefer `HelmRelease` edits over raw manifests.
- Keep app values inline in `helmrelease.yaml` unless a separate file is clearly justified.
- Put cluster-wide non-secret constants in `/Users/khz/Code/rangoonpulse/flux/cluster-settings.yaml`.
- When Flux post-build substitution is active, escape runtime-literal placeholders as `$${VAR}`.
- Keep credentials out of plaintext manifests. Git-managed secrets stay SOPS-encrypted under `/Users/khz/Code/rangoonpulse/infrastructure/secrets/`.

## Placement

- Default policy: pin userland workloads to `talos-7nf-osf`.
- For `bjw-s-charts/app-template` v4, use:
  - `values.defaultPodOptionsStrategy: merge`
  - `values.defaultPodOptions.nodeSelector.kubernetes.io/hostname: talos-7nf-osf`
- Utility-node allowlist today:
  - `infrastructure/public-edge`
  - `apps/exposure-control`
  - `apps/glance`
  - `apps/profilarr`
  - `apps/adguard`
  - `apps/chartsdb`
  - `apps/uptime-kuma`
  - `apps/speedtest`
  - `apps/actualbudget`
  - `apps/reactive-resume`
  - `apps/anki-server`
  - `apps/autobrr`
  - `apps/prowlarr`
  - `apps/jackett`
  - `apps/flaresolverr`
- `local-path` volumes are node-affined. Moving those apps between nodes usually means PVC recreation or storage migration.

## Storage

- Default storage intent for app/config PVCs: `truenas-nfs`.
- Use `local-path` intentionally for low-latency or node-local state such as databases, Prometheus TSDB, and hot caches.
- Before changing storage for stateful services, read the focused doc for that service or storage pattern from `/Users/khz/Code/rangoonpulse/docs/README.md`.

## Ingress, DNS, And TLS

- Normal externally reachable or tailnet-only hostname pattern:
  - ingress class `nginx`
  - annotation `external-dns.alpha.kubernetes.io/hostname`
  - annotation `cert-manager.io/cluster-issuer: letsencrypt-prod`
  - annotation `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
  - matching `tls.hosts`
- external-dns ignores `spec.rules[].host` and `spec.tls[].hosts` on Ingress resources in this repo. Declare hostnames through the annotation or DNS will not be published.
- external-dns also watches Services, so `ExternalName` CNAME alias patterns are valid where already used.

## Security Baseline

- For ordinary userland workloads, prefer:
  - pod `runAsNonRoot: true`
  - pod `seccompProfile.type: RuntimeDefault`
  - container `allowPrivilegeEscalation: false`
  - container `capabilities.drop: ["ALL"]`
- Add `fsGroup` only when writable PVC access actually needs it.
- Do not force this baseline onto networking, storage, or node-level daemons without verifying capability requirements first.

## Validation

Use the smallest meaningful checks for the touched scope:

```bash
kubectl apply --dry-run=client -f <file>
kubectl kustomize <path> >/tmp/rendered.yaml
kubectl apply --dry-run=client -f /tmp/rendered.yaml
```

When shared settings are involved, also use the focused validation flow in:
- `/Users/khz/Code/rangoonpulse/docs/shared-cluster-settings.md`

## Done Criteria

The change should leave these repo defaults intact unless the task explicitly changes a convention:
- shared constants stay centralized
- node placement is intentional
- storage choice matches workload behavior
- ingress/DNS/TLS wiring is aligned
- secrets remain encrypted in Git
