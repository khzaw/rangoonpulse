# Calibre Storage Migration to `truenas-nfs`

## Summary
Calibre and Calibre Web Automated were migrated off `truenas-hdd-config` to `truenas-nfs` to ensure future PVC expansion support.

Date: 2026-02-18

## Final PVC State
- `default/calibre-books-nfs` (`20Gi`, `RWX`, storageClass `truenas-nfs`)
- `default/app-configs-pvc-nfs` (`1Gi`, `RWX`, storageClass `truenas-nfs`)

## Current Ownership After Calibre Retirement

Calibre and Calibre Web Automated were retired on 2026-08-01. Their Deployments, Services, Ingresses, Flux
Kustomizations, dashboard entries, and public-share routes were removed, but no storage data was deleted.

`calibre-books-nfs` remains an independently managed claim under `infrastructure/storage/calibre/`:
- BookOrbit mounts it read-write at `/books` and owns library browsing and metadata write-back.
- Shelfmark mounts it read-write at `/books` and `/bookdrop` for downloaded files.

The old `calibre` and `calibre-web-automated` subpaths on `app-configs-pvc-nfs` are retained but no longer mounted.
Keeping those dormant config directories is deliberate rollback safety; their eventual deletion is a separate destructive
cleanup task.

Historical app mappings before retirement:
- Calibre mounted `/books` from `calibre-books-nfs` and `/config` from the `calibre` subpath of `app-configs-pvc-nfs`.
- Calibre Web Automated mounted `/calibre-library` from `calibre-books-nfs` and `/config` from the
  `calibre-web-automated` subpath of `app-configs-pvc-nfs`.

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
