---
title: Book and Audiobook Library Storage
summary: Generic content claims, separate application state, and retained-volume migration for BookOrbit, Audiobookshelf, and Shelfmark.
status: active
owner: homelab
last_reviewed: 2026-10-25
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

Content claim lifecycles belong to shared storage infrastructure, independent of an application's chart release.

## Data-Preserving Storage Changes

Before renaming, rebinding, or moving a claim, inspect its live PV, CSI volume handle, NAS dataset, and every consumer. A PVC name cannot be edited in place. Protect retained content PVs with reclaim policy `Retain`; explicitly bind a replacement to the intended existing PV rather than provisioning an empty dataset.

Keep BookOrbit's `/books` and Audiobookshelf's `/audiobooks` paths stable unless catalogue references are migrated deliberately. Shelfmark must see the same volume roots as the managing apps. Runtime library settings, users, and catalogue counts must be inspected at the time of the change.

1. Stop all writers and record claim/PV identities, mounted paths, file checksums, ownership, and application catalogue state.
2. Obtain an application-consistent recovery set and NAS snapshots when needed. SQLite copies require a stopped writer or a proper backup API; PostgreSQL needs its own consistent backup.
3. Copy app state separately from content and verify checksums and database integrity before cutover.
4. Change claims, mounts, and Flux dependencies together, preserving intended bindings and paths.
5. Verify file/catalogue consistency and real ebook downloads and audio range requests before removing temporary resources or task backups.

Application-owned recovery files and user data are not disposable cleanup artifacts. Do not remove them as part of a claim rename. Before any snapshot restore, account for newer writes that rollback would discard.

## Verification

```bash
kubectl get pvc -n default books audiobooks bookorbit audiobookshelf-data -o wide
kubectl get pv
flux get kustomizations | rg 'infra-storage-media|bookorbit|audiobookshelf|shelfmark'
kubectl get hr -n default bookorbit audiobookshelf shelfmark
curl --fail --max-time 20 https://bookorbit.khzaw.dev/api/v1/health
```

Readiness alone does not prove content access. Check catalogue references, an existing ebook download, audiobook seeking, users/progress, and the same files through Shelfmark's content mounts.

## Related References

- [BookOrbit runtime and integration](./study-services-livesync-anki-bookorbit.md)
- [Shelfmark mounts and handoff](./shelfmark.md)
- [NFS connectivity recovery](./truenas-networking-and-csi.md)
