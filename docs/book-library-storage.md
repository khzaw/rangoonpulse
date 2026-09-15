---
title: Book and Audiobook Library Storage
summary: Generic content claims, separate application state, and retained-volume migration for BookOrbit, Audiobookshelf, and Shelfmark.
status: active
owner: homelab
last_reviewed: 2026-09-16
---

# Book and Audiobook Library Storage

## Naming and Ownership

Content storage uses generic names that remain useful when the managing application changes:

- `books`: ebook files and the shared `bookdrop` intake directory.
- `audiobooks`: audiobook files.
- App-specific state uses an application prefix, such as `bookorbit` or `audiobookshelf-data`.

BookOrbit manages the ebook catalogue and library files. Audiobookshelf manages the audiobook catalogue and playback
state. Shelfmark can deliver downloads to either content library. A shared content claim does not merge their catalogues.

All claims below are in namespace `default` and use expandable TrueNAS-backed `truenas-nfs` storage.

| Claim | Size / access | Contents | Application mounts |
|---|---|---|---|
| `books` | `20Gi` / `ReadWriteMany` | Ebook library and `bookdrop/` | BookOrbit `/books`; Shelfmark `/books` and `/bookdrop` (`subPath: bookdrop`) |
| `audiobooks` | `20Gi` / `ReadWriteMany` | Audiobook library files | Audiobookshelf and Shelfmark `/audiobooks`, both from the volume root |
| `bookorbit` | `5Gi` / `ReadWriteOnce` | Covers, author images, user assets, import staging, migration backups | BookOrbit `/data` |
| `audiobookshelf-data` | `1Gi` / `ReadWriteOnce` | `config/` for SQLite and migrations; `metadata/` for covers, cache, logs, backups, and other app assets | Audiobookshelf `/config` (`subPath: config`) and `/metadata` (`subPath: metadata`) |

BookOrbit's catalogue is a separate database and role on shared `media-postgres`; it is not a second ebook library.
Shelfmark's configuration remains under `app-configs-pvc-nfs` with `subPath: shelfmark`.
There is no configured podcast library, so Audiobookshelf does not mount a `/podcasts` alias.

## GitOps Ownership

- Shared content claims: `infrastructure/storage/media/media-pvc.yaml`, reconciled by `infra-storage-media`.
- BookOrbit app-data claim and mounts: `apps/bookorbit/helmrelease.yaml`.
- Audiobookshelf app-data claim: `apps/audiobookshelf/pvc.yaml`; mounts: `apps/audiobookshelf/helmrelease.yaml`.
- Shelfmark mounts: `apps/shelfmark/helmrelease.yaml`.
- App Flux dependencies: `flux/kustomizations/bookorbit.yaml`, `audiobookshelf.yaml`, and `shelfmark.yaml`.

The retired `infra-storage-calibre` reconciliation unit is no longer needed. A content claim's lifecycle belongs to
shared storage infrastructure, independent of an application's chart release.

## September 2026 Migration

The previous names and contents reflected their history: `calibre-books-nfs` held the active BookOrbit ebook library,
while `books` held both Audiobookshelf content and application state. The migration renames the content claims and
separates Audiobookshelf state without changing the underlying content datasets.

| Previous claim | Current claim | Retained PV |
|---|---|---|
| `calibre-books-nfs` | `books` | `pvc-443b0925-0156-4098-b22b-4080367204e5` |
| `books` | `audiobooks` | `pvc-5073628a-9305-4aa9-bc84-a5b26ab564a7` |

PVC names cannot be edited in place. For this migration, protect both existing PVs with reclaim policy `Retain`,
stop every writer, release the old claims, and bind replacement claims explicitly using `spec.volumeName`.
Do not let the storage provisioner create an empty replacement dataset. The TrueNAS dataset paths, CSI volume
handles, and PV names remain unchanged; only the claim names and friendly comments on the TrueNAS datasets and NFS
shares change to `default/books` and `default/audiobooks`.

Keep application content paths stable: BookOrbit's registered files remain beneath `/books`, and Audiobookshelf's
library remains beneath `/audiobooks`. No catalogue path rewrite is needed. Shelfmark's audiobook mount must use the
volume root to match Audiobookshelf; its old `subPath: audiobooks` exposed a different directory.

### Data preservation and cutover

1. Record PV/claim bindings, mounted paths, file checksums, and application catalogue counts. Stop BookOrbit,
   Audiobookshelf, and Shelfmark before the final snapshot and file copy.
2. Snapshot the existing datasets in TrueNAS before releasing claims or moving files. Capture manifests and runtime
   library settings alongside the snapshot references.
3. Copy Audiobookshelf's SQLite/configuration state into `audiobookshelf-data/config/` and its metadata into
   `audiobookshelf-data/metadata/`, preserving ownership and file contents. Verify copy checksums and SQLite integrity
   before removing those app-state files from the audiobook content volume.
4. Preserve Calibre's old library-root `metadata.db`, `full-text-search.db`, `metadata_db_prefs_backup.json`, `.caltrash`,
   `.calnotes`, and `.DS_Store` under BookOrbit's `/data/migration-backups/calibre-20260916`. Verify the archived copies
   before clearing those artifacts from `books`. Keep dormant `calibre` and `calibre-web-automated` directories on
   `app-configs-pvc-nfs` intact.
5. Rebind both retained content PVs to the explicit new claims, reconcile the Git-managed mounts, update friendly
   comments on the TrueNAS datasets and NFS shares, and resume the applications. Record any temporary Flux suspension
   and clear it after cutover.
6. Verify claim/PV identity, application mounts, file checksums, catalogue state, and actual ebook/audio access.

The observed pre-migration baseline on 2026-09-16 was one BookOrbit library named `Books` with 391 books and registered
files under `/books`; the library excluded `bookdrop` and enabled file renames. Audiobookshelf had three books,
three users, one progress record, one playback record, and zero podcasts. These are migration comparison points,
not permanent expected counts.

### Verification

```bash
kubectl get pvc -n default books audiobooks bookorbit audiobookshelf-data -o wide
kubectl get pv pvc-443b0925-0156-4098-b22b-4080367204e5 pvc-5073628a-9305-4aa9-bc84-a5b26ab564a7
flux get kustomizations | rg 'infra-storage-media|bookorbit|audiobookshelf|shelfmark'
kubectl get hr -n default bookorbit audiobookshelf shelfmark
kubectl get pods -n default | rg 'bookorbit|audiobookshelf|shelfmark'
curl --fail --max-time 20 https://bookorbit.khzaw.dev/api/v1/health
```

Do not use pod readiness alone as application-health evidence. Inspect the mounted paths and application catalogues,
and check the actual HTTP endpoints. Confirm the BookOrbit files are
still available, Audiobookshelf users/progress/playback state survived, and an existing ebook and audiobook can be
opened. Both Shelfmark content paths must show the same files as their managing application. Confirm Calibre's
legacy root artifacts exist in the backup directory and no app-state files remain in the audiobook content root.

### Recorded cutover evidence (2026-09-16)

- Both replacement content claims bound to the original PVs listed above. Their CSI volume handles and NFS share
  paths were preserved. TrueNAS dataset and NFS share comments now identify `default/books` and `default/audiobooks`.
  The `calibre-books-nfs` claim and `infra-storage-calibre` Kustomization were removed.
- All three existing datasets received a `before-generic-book-storage-20260916` snapshot before migration. A protected
  local copy of pre-change manifests and the PostgreSQL dump was captured at `/tmp/books-storage-migration-20260916`;
  this workstation temporary directory is not a durable backup destination.
- Audiobookshelf state copied to `audiobookshelf-data`: 34 files, 754,019 bytes. Legacy Calibre artifacts copied to the
  BookOrbit migration-backup directory: 19 files, 397,631,327 bytes. Source/destination hashes, modes, UIDs, and GIDs
  matched for both copies before the originals were removed from the content volumes.
- Final content verification matched the pre-cutover manifest exactly: 958 ebook-library files including sidecars
  (1,817,743,511 bytes) and six audiobook-library files including sidecars (1,680,478,018 bytes). Every file's SHA-256,
  mode, UID, and GID matched.
- The running Audiobookshelf SQLite integrity check passed. Its three books, three users, one progress record,
  one playback record, and zero podcasts were preserved. Two authenticated audio range requests returned HTTP `206`
  at byte offsets `0` and `1048576`; both responses matched the exact source-file bytes.
- BookOrbit's catalogue retained 391 books and 931 registered files with unchanged `/books` paths. All 931 registered
  paths existed in the verified final ebook manifest.
- An authenticated download through BookOrbit's existing KOReader integration returned HTTP `200` and
  `application/epub+zip`. The 21,183-byte response matched the registered file size and mounted file's SHA-256.
  The direct download and audio range checks did not use reading-progress or playback-session mutation endpoints.
- BookOrbit's HTTPS health endpoint returned HTTP `200` after its startup completed. Shelfmark's health endpoint
  returned HTTP `200`, and its content mounts were writable.
- All affected HelmReleases and Flux Kustomizations were Ready and unsuspended. No temporary migration pods,
  old Calibre claim/Kustomization, or released content PVs remained.

### Rollback

Stop all three applications before rolling back. Keep both content PVs on `Retain`, inspect their current claim
bindings, and restore the previous claim-to-PV mapping using the captured manifests; the old `books` name belongs to
the audiobook PV in that mapping. Restore the matching Git-managed mounts and Flux dependencies together.

If reverting the Audiobookshelf state split, restore the captured configuration and metadata layout to the old
content volume before starting the old mounts. Restore Calibre artifacts from the BookOrbit backup directory only
if the previous library-root layout is needed. Use the pre-cutover snapshots if the copies cannot be verified.
Check for post-cutover changes before restoring a snapshot, since a snapshot rollback can discard newer writes.
Verify the same file/catalogue checks before resuming writers and re-enable any suspended reconciliation.

## Related References

- [BookOrbit runtime and integration](./study-services-livesync-anki-bookorbit.md)
- [Shelfmark mounts and handoff](./shelfmark.md)
- [Historical Calibre migration and retirement](./calibre-storage-migration-to-truenas-nfs.md)
- [NFS connectivity recovery](./truenas-tailscale-accept-routes-caused-democratic-csi-outage.md)
