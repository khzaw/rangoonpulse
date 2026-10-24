---
name: rangoonpulse-cluster-conventions
description: "Use for ordinary rangoonpulse manifests, placement, storage, shared settings, ingress/DNS/TLS, secrets, and platform security defaults."
---

# Rangoonpulse Cluster Conventions

## Read First

Use the smallest relevant docs:

- `docs/architecture.md`
- `docs/shared-cluster-settings.md`
- `docs/networking.md`
- `docs/secrets-management.md`
- `docs/data-protection.md` for persistent-data risk

## GitOps

- Permanent desired state comes from Git and Flux.
- Prefer the existing HelmRelease/app-template pattern over raw objects when it fits.
- Keep app values inline unless separation solves a concrete maintenance problem.
- Put shared non-secret constants in `flux/cluster-settings.yaml`.
- Escape runtime-literal placeholders as `$${VAR}`.
- Keep credentials SOPS-encrypted under `infrastructure/secrets/`.

Read the target HelmRelease's pinned chart version and inspect a current sibling and that version's schema. Do not assume all releases use one chart version.

## Placement

Do not maintain a copied node allowlist in docs or skills. Inspect current node selectors in the nearest sibling workloads and measure capacity.

Default decision factors:

- image architecture support
- local-path PVC affinity
- device access such as `/dev/dri`
- network and storage throughput
- critical-service redundancy
- current node headroom

A local-path PVC makes a node move a data migration, not a selector edit.

## Storage

- `truenas-nfs`: relocatable file/config state
- `truenas-hdd-media`: large media
- `truenas-nvme-downloads`: downloads
- `local-path`: databases, SQLite, TSDB, and latency-sensitive caches

Check `docs/data-protection.md` before describing persistence as protected. Most PVCs do not have repository-defined automated backups.

## Ingress, DNS, And TLS

For the normal private hostname pattern, align:

- ingress class `nginx`
- explicit ExternalDNS hostname annotation
- `letsencrypt-prod` issuer
- TLS hosts and secret
- SSL redirect

ExternalDNS intentionally ignores Ingress rules/TLS fields. Public-edge hostnames own DNS through `ExternalName` Services instead.

## Security

For ordinary workloads prefer non-root execution, RuntimeDefault seccomp, no privilege escalation, and all capabilities dropped. Apply exceptions only after inspecting the workload's real device, networking, or storage requirements.

app-template v5 disables service-account token automounting by default. Set `defaultPodOptions.automountServiceAccountToken: true` only for workloads that call the Kubernetes API.

## Validation

```bash
kubectl apply --dry-run=client -f <file>
kubectl kustomize <path> >/tmp/rendered.yaml
kubectl apply --dry-run=client -f /tmp/rendered.yaml
make validate-all
```

For resource, replica, placement, or new-workload changes, follow `docs/cpu-headroom-validation.md`: render the actual workloads, check Git/CI capacity, and run the live `make check-capacity FILE=<rendered.yaml>` preflight plus server-side dry run. Check an HPA's intended maximum separately. The cluster has no live admission webhook.
