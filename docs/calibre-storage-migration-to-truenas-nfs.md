# Calibre Storage Migration to `truenas-nfs`

## Summary
Calibre and Calibre Web Automated were migrated off `truenas-hdd-config` to `truenas-nfs` to ensure future PVC expansion support.

Date: 2026-02-18

## Final PVC State
- `default/calibre-books-nfs` (`20Gi`, `RWX`, storageClass `truenas-nfs`)
- `default/app-configs-pvc-nfs` (`1Gi`, `RWX`, storageClass `truenas-nfs`)

App mappings:
- `apps/calibre/values.yaml`
  - `/books` -> `calibre-books-nfs`
  - `/config` (subPath `calibre`) -> `app-configs-pvc-nfs`
- `apps/calibre-web-automated/helmrelease.yaml`
  - `/calibre-library` -> `calibre-books-nfs`
  - `/config` (subPath `calibre-web-automated`) -> `app-configs-pvc-nfs`

## Data Safety Checks Performed
- Initial pre-seed copy to new PVCs with migration pod.
- Final cutover copy with apps stopped (`rsync --delete`).
- Checksum parity dry-run after final copy:
  - `rsync --dry-run --checksum` returned zero diff lines for books and config.
- `metadata.db` hash matched source and destination.

## Important Clarification
`metadata.db` is in the library volume (`/books` / `/calibre-library`), not in `/config`.

## StorageClass Retirement
- Removed `truenas-hdd-config` from:
  - `infrastructure/storage/democratic-csi/hr-hdd.yaml`
- Old claims on `truenas-hdd-config` were removed as part of the migration cutover.
