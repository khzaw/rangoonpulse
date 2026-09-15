---
title: Historical Calibre Storage Migration to TrueNAS NFS
summary: February 2026 NFS migration, Calibre retirement, and the later transition to generic book storage names.
status: historical
owner: homelab
last_reviewed: 2026-09-16
---

# Calibre Storage Migration to `truenas-nfs`

## Summary
Calibre and Calibre Web Automated were migrated off `truenas-hdd-config` to `truenas-nfs` to ensure future PVC expansion support.

Date: 2026-02-18

## PVC State After the February Migration
- `default/calibre-books-nfs` (`20Gi`, `RWX`, storageClass `truenas-nfs`)
- `default/app-configs-pvc-nfs` (`1Gi`, `RWX`, storageClass `truenas-nfs`)

## Ownership After Calibre Retirement

Calibre and Calibre Web Automated were retired on 2026-08-01. Their Deployments, Services, Ingresses, Flux
Kustomizations, dashboard entries, and public-share routes were removed, but no storage data was deleted.

At retirement, `calibre-books-nfs` remained an independently managed claim under `infrastructure/storage/calibre/`:
- BookOrbit mounted it read-write at `/books` and owned library browsing and metadata write-back.
- Shelfmark mounted it read-write at `/books` and `/bookdrop` for downloaded files.

The old `calibre` and `calibre-web-automated` subpaths on `app-configs-pvc-nfs` are retained but no longer mounted.
Keeping those dormant config directories is deliberate rollback safety; their eventual deletion is a separate destructive
cleanup task.

### Generic content names from September 2026

The ebook content claim is now `books`, managed under `infrastructure/storage/media/` by `infra-storage-media`.
It retains the original PV `pvc-443b0925-0156-4098-b22b-4080367204e5` and CSI dataset identity; BookOrbit and Shelfmark
still mount it at `/books`. The old `infra-storage-calibre` Kustomization and Calibre-named claim are retired.
The former audiobook claim named `books` is now `audiobooks`, with Audiobookshelf app state on `audiobookshelf-data`.

Calibre's legacy library-root artifacts (`metadata.db`, `full-text-search.db`, `metadata_db_prefs_backup.json`,
`.caltrash`, `.calnotes`, and `.DS_Store`) belong in BookOrbit's app-data backup directory
`/data/migration-backups/calibre-20260916`, separate from the ebook content. Dormant Calibre configuration directories
on `app-configs-pvc-nfs` remain preserved.

See [book library storage](./book-library-storage.md) for the current mapping, migration procedure, and rollback checks.

Historical app mappings before retirement:
- Calibre mounted `/books` from `calibre-books-nfs` and `/config` from the `calibre` subpath of `app-configs-pvc-nfs`.
- Calibre Web Automated mounted `/calibre-library` from `calibre-books-nfs` and `/config` from the
  `calibre-web-automated` subpath of `app-configs-pvc-nfs`.

## February Migration Data Safety Checks
- Initial pre-seed copy to new PVCs with migration pod.
- Final cutover copy with apps stopped (`rsync --delete`).
- Checksum parity dry-run after final copy:
  - `rsync --dry-run --checksum` returned zero diff lines for books and config.
- `metadata.db` hash matched source and destination.

## Historical Calibre Database Location
Calibre kept `metadata.db` in the library volume (`/books` / `/calibre-library`), not in `/config`. BookOrbit uses
PostgreSQL for its catalogue; the legacy Calibre database is retained as a migration backup as described above.

## StorageClass Retirement
- Removed `truenas-hdd-config` from:
  - `infrastructure/storage/democratic-csi/hr-hdd.yaml`
- Old claims on `truenas-hdd-config` were removed as part of the migration cutover.
