---
title: Storage Cleanup
summary: Current dry-run-first PVC, PV, and optional TrueNAS dataset cleanup with destructive safety gates.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Storage Cleanup

`scripts/storage-sunset-cleanup.sh` inventories and optionally removes unused PVCs, released PVs, and TrueNAS datasets associated with released democratic-csi volumes.

## Safety Boundary

The script's "orphan PVC" classification means only that no current Pod mounts the claim. It does not prove the data is disposable.

Before apply mode, prove all of the following:

- the service is absent from current Flux desired state or intentionally dormant
- no Deployment, StatefulSet, Job, or CronJob expects the claim
- no restore procedure, migration, or replacement service still references the data
- the namespace, context, and regex select only the intended objects
- required backups or inspections are complete

Always use a narrow filter. Review generated TSV and YAML artifacts before deletion.

## Dry Run

```bash
scripts/storage-sunset-cleanup.sh --namespace <namespace> --match '<exact-pattern>'
```

The script writes its report under `/tmp/storage-sunset-cleanup-<timestamp>/`, including candidate PVCs, released PVs, and saved PV manifests.

## Destructive Modes

Kubernetes object cleanup:

```bash
scripts/storage-sunset-cleanup.sh --apply \
  --namespace <namespace> \
  --match '<exact-pattern>'
```

TrueNAS dataset deletion adds:

```bash
--delete-truenas-datasets
```

TrueNAS deletion uses the SOPS-managed `democratic-csi/truenas-credentials` Secret. The script excludes datasets overlapping current bound TrueNAS-backed PVs, but that is a final guard, not authorization to use an unscoped match.

Deleting a released PV object does not guarantee backend reclamation for `Retain` volumes. Inspect the generated TrueNAS plan and verification output.

## Verification

After cleanup:

```bash
kubectl get pvc -A
kubectl get pv
flux get kustomizations -A
```

Verify surviving workloads, mounts, and TrueNAS datasets. Keep the run artifacts until the intended state is confirmed.

Remove task backups and temporary cleanup artifacts once successful verification makes them unnecessary. Preserve application-protected recovery files and user data.
