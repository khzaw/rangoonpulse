---
title: RomM
summary: Private ROM library with shared PostgreSQL, expandable NAS storage, and app-owned database provisioning.
status: active
owner: homelab
last_reviewed: 2026-09-15
---

# RomM

[RomM](https://romm.app) manages ROM libraries, metadata, saves, and in-browser
emulation at `https://roms.khzaw.dev`.

## Access and first use

- Private LAN/Tailscale access through the shared ingress VIP (`10.0.0.231`).
- Ingress `nginx`, external-dns, and `letsencrypt-prod` provide DNS and HTTPS.
- There is no public-edge route or Exposure Control share entry.
- Open the first-run wizard to create the administrator, then upload ROMs or
  populate `library/roms/<platform>` and scan the library. BIOS files belong in
  `library/bios/<platform>`. Platform names follow the
  [upstream folder structure](https://docs.romm.app/latest/getting-started/folder-structure/).
- Hasheous metadata lookup is enabled and needs no personal API key. Other
  providers can be added through the SOPS-managed `romm-secret` using the
  [upstream provider configuration](https://docs.romm.app/latest/getting-started/metadata-providers/).
- Session cookies are secure; username/password authentication and CSRF
  protection retain their upstream defaults.

## Runtime

- GitOps path: `apps/romm/`; Flux definition: `flux/kustomizations/romm.yaml`.
- HelmRelease, Deployment, and Service: `default/romm`.
- Chart: `app-template` `5.1.0`; image: `rommapp/romm:5.2.0`.
- One replica on `${PRIMARY_NODE_NAME}` with `Recreate` upgrades.
- UID/GID `1000`, no privilege escalation, all capabilities dropped.
- API and scan concurrency both start at one worker.
- ROM patching is limited to one operation and 256MiB input files to fit the
  memory budget; this does not limit ordinary ROM uploads or downloads.
- Requests: `250m` CPU / `1Gi` memory; limits: `2` CPU / `3Gi` memory.
- Startup/readiness/liveness use `/api/heartbeat` on port `8080`; this endpoint
  queries the database and inspects the library directories.
- The ingress permits large uploads, disables request/response buffering, and
  allows 600-second proxy timeouts.

## Database

RomM 5.2.0 [supports PostgreSQL](https://docs.romm.app/latest/install/databases/).
It uses database/role `romm` on `media-postgres.default.svc.cluster.local:5432`.
`ROMM_DB_DRIVER=postgresql` and `DB_PORT=5432` are explicit because the default
driver and port target MariaDB.

The app-owned Helm pre-install/pre-upgrade Job `romm-database` provisions the
database without changing or restarting the shared PostgreSQL release. It uses
the PostgreSQL superuser secret only in that short-lived Job; the application
receives only its own database password and authentication signing key from
`default/romm-secret`.

The job is idempotent, serializes provisioning with a session advisory lock,
quotes the password through psql variables, and limits the RomM role to 30
connections. The role owns only its own database and has no superuser, role
creation, database creation, replication, or row-security bypass rights. RomM's
migrations create the trusted `pg_trgm` extension in this database.

The shared server retains its 100-connection limit. RomM uses SQLAlchemy's
default pool per Python process; increasing scan/API worker counts also grows
potential connection demand. Inspect actual usage before increasing concurrency.

### Credential rotation and recovery

Secrets are encrypted with SOPS under
`infrastructure/secrets/default/romm-secret.yaml` (`DB_PASSWD`,
`ROMM_AUTH_SECRET_KEY`). After changing the database password, reconcile secrets,
then force the release so the provisioning hook updates the role:

```bash
flux reconcile kustomization secrets -n flux-system --with-source
flux reconcile helmrelease romm -n default --force
kubectl rollout restart deployment/romm -n default
kubectl rollout status deployment/romm -n default --timeout=180s
```

The restart loads updated environment credentials. A fresh installation runs
the hook automatically. After a shared database restore/rebuild, force the RomM
Helm release as above; a pod restart alone does not rerun Helm hooks.

Provisioning restores the database/role structure, not lost metadata. Back up
the `romm` database along with the NAS volume and encrypted secrets. The repo's
centralized database backup plan remains unimplemented; NAS files alone do not
protect users, collections, or database metadata from primary-node disk loss.

## Storage

| Claim | Class | Initial size | Mount and contents |
| --- | --- | --- | --- |
| `romm-data` | `truenas-nfs` | **20Gi**, expandable | `/romm`: ROMs, BIOS, artwork, saves, configuration, upload staging, generated ZIPs |
| `romm-redis` | `local-path` | 2Gi | `/redis-data`: bundled Valkey queue/cache persistence |

One NAS filesystem preserves hardlinks and keeps large temporary uploads and
ZIP downloads off the node disk. `TMPDIR=/romm` also puts generic archive hashing
and patching temporary files on NAS. RomM creates its directory layout beneath
`/romm`. ROMs go under `/romm/library/roms/<platform>/`; the NAS dataset path is
available from the bound PV. The Helm claims are retained on uninstall and the
NAS StorageClass also uses `Retain`.

The 20Gi quota includes artwork and generated downloads, so leave some free
space beyond the ROM files. To expand, increase
`spec.values.persistence.data.size` in `apps/romm/helmrelease.yaml`, commit/push,
and reconcile `romm`. `truenas-nfs` supports online expansion; shrinking is not
supported. Verify both PVC capacity and the NAS filesystem after expansion.

```bash
kubectl get pvc romm-data romm-redis -n default
kubectl get storageclass truenas-nfs
kubectl exec deployment/romm -n default -- df -h /romm /redis-data
```

## Operator integration and updates

- Dynacat has the private URL, cluster-local heartbeat monitors, and upstream releases.
- Resource Advisor can propose upsizing. Downscaling is excluded until scans
  and file hashing establish a representative resource floor.
- Renovate handles the explicit image/chart versions. The control panel discovers
  the workload and HelmRelease automatically; no Flux image writer is needed.

## Verification

```bash
flux get kustomization romm -n flux-system
flux get helmrelease romm -n default
kubectl rollout status deployment/romm -n default --timeout=180s
kubectl get pvc romm-data romm-redis -n default
kubectl get certificate romm-tls -n default
dig +short roms.khzaw.dev A
curl --fail https://roms.khzaw.dev/api/heartbeat
```

Also open the application in a browser to confirm that the setup/login screen
and its assets load over HTTPS. An empty library is expected before the first
ROM upload; runtime health alone does not verify game compatibility.
