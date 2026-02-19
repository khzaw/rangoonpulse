# Storage Sunset Cleanup (PVC/PV + TrueNAS)

## Purpose
After sunsetting services, this runbook helps remove:
- orphan PVCs (PVCs not mounted by any pod)
- released PVs (left behind by reclaim policy behavior)
- optional TrueNAS datasets for released democratic-csi volumes

Script:
- `scripts/storage-sunset-cleanup.sh`

Default behavior:
- dry-run only (no deletions)

## Preconditions
- Service has already been removed/disabled via GitOps and reconciled.
- Any needed backup/inspection has been completed.
- `kubectl` context points to the intended cluster.

## Quick Start
Dry-run across all namespaces:

```bash
scripts/storage-sunset-cleanup.sh
```

Dry-run scoped to namespace + regex:

```bash
scripts/storage-sunset-cleanup.sh --namespace default --match 'default/(booklore|vaultwarden)'
```

Apply Kubernetes cleanup (PVC/PV only):

```bash
scripts/storage-sunset-cleanup.sh --apply --namespace default --match 'default/booklore'
```

Apply Kubernetes cleanup and TrueNAS dataset cleanup:

```bash
scripts/storage-sunset-cleanup.sh --apply --delete-truenas-datasets
```

## What the Script Does
1. Builds candidate PVC inventory (`namespace`/`match` filtered).
2. Finds orphan PVCs by subtracting pod-mounted claims.
3. Finds released PVs (same filter scope by claim/PV name).
4. In `--apply` mode:
   - deletes orphan PVCs
   - waits briefly for PV phase transitions
   - snapshots released PV YAMLs
   - deletes released PV objects
5. If `--delete-truenas-datasets` is set:
   - uses TrueNAS API from in-cluster secret credentials
   - builds dataset delete set from released democratic-csi PV shares
   - excludes any dataset that overlaps current bound TrueNAS-backed PVs
   - deletes safe datasets and verifies they are gone

## Default TrueNAS Parameters
- Host: `10.0.0.210`
- Secret namespace/name: `democratic-csi/truenas-credentials`
- Secret keys: `username`, `password`

Override with:
- `--truenas-host`
- `--truenas-secret-namespace`
- `--truenas-secret-name`

## Output Artifacts
Each run writes reports to:
- `/tmp/storage-sunset-cleanup-<timestamp>/`

Useful files:
- `orphan-pvc.tsv`
- `released-pv.tsv`
- `released-pv-yaml/`
- `truenas-delete-plan.tsv` (when TrueNAS delete enabled)
- `truenas-delete-results.tsv` and `truenas-delete-verify.tsv`

## Notes
- Deleting released PV objects does not always reclaim backend storage for `Retain` volumes.
- For TrueNAS-backed democratic-csi volumes, use `--delete-truenas-datasets` only after backup/verification.
