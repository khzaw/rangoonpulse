---
title: Uptime Kuma Monitoring and Storage
summary: Monitoring coverage, efficient HTTP targets, local SQLite storage, and WAL-safe recovery.
status: active
owner: homelab
last_reviewed: 2026-11-03
---

# Uptime Kuma Monitoring and Storage

## Current State

- source: `apps/uptime-kuma/`
- node: `${UTILITY_NODE_NAME}`
- data PVC: `uptime-kuma-data-local`
- storage class: `local-path`
- database: SQLite

SQLite is intentionally node-local. Uptime Kuma's write and WAL behavior is not suitable for the latency and locking characteristics of the NAS-backed NFS path used elsewhere.

The tradeoff is explicit: routine database operations stay responsive, but the workload is node-affined and the repository defines no automated backup for this PVC.

## Monitoring Contract

Flux owns the deployment and PVC reference. Monitor definitions and heartbeat
history are application-owned SQLite data; edit existing monitors through Kuma's
authenticated API or UI, preserving their IDs and history. Do not replace the
database or introduce another writer to adjust monitor settings.

Keep service checks at 60 seconds with their existing retry, timeout, TLS,
accepted-status, and notification settings. The two AdGuard monitors cover
separate instances. Native gateway, readiness, dashboard, and HTTPS edge monitors
test distinct failure boundaries and must not be deduplicated by host alone.

For HTTP status monitors, these targets use the same final pages previously
reached by following root-page redirects:

| Service | Path on its existing private HTTPS host |
| --- | --- |
| Sonarr, Radarr, Prowlarr | `/login?returnUrl=%2F` |
| Jellyfin | `/web/` |
| Transmission | `/transmission/web/` |
| SABnzbd | `/login/` |
| Seerr | `/login` |
| Speedtest Tracker | `/admin/login` |

This removes eleven redirect requests per healthy polling cycle across eight
monitors. The monitors still GET the final dashboard/login page through the same
DNS, ingress, TLS, and application path. They do not separately test the root
redirect. Recheck final paths when upgrading an application. In particular, keep
Speedtest's dashboard check: its lightweight `/api/healthcheck` response does not
provide equivalent coverage of login-page rendering and database-backed sessions.

Kuma caches domain-expiry lookups by registrable domain for a day; repeated
subdomain settings do not imply an RDAP network request per heartbeat. Certificate
checks belong to individual HTTPS endpoints and are not interchangeable with
domain-expiry checks.

Polling alone does not deliver notifications. Verify configured providers and
monitor-provider assignments before relying on Kuma for outbound alerts; empty
assignments provide dashboard status/history only. Keep failure/retry handling
intact when measuring CPU, and distinguish pre-existing DNS failures from changes
to an HTTP path. Slower polling can hide failures and is not an efficiency fix.

## Recovery

Do not move the node selector or replace the PVC as a normal rollout.

For a manual backup or migration:

1. stop Uptime Kuma so SQLite has no writer
2. preserve `kuma.db` and any `kuma.db-wal`/`kuma.db-shm` companions
3. restore into disposable storage
4. run SQLite integrity checks
5. start one Uptime Kuma writer and verify monitors, history, and notifications

Copying only `kuma.db` while the application is running can omit committed WAL data.

## Verification

```bash
flux get kustomization uptime-kuma -n flux-system
kubectl get pod,pvc -n default | grep uptime-kuma
kubectl get pod -n default -l app.kubernetes.io/name=uptime-kuma -o wide
kubectl logs -n default deploy/uptime-kuma --since=30m
curl -Ik https://uptime.khzaw.dev/
```

After monitor edits, read back the changed monitor and verify that only intended
fields changed. Observe several heartbeats, preserving successful responses and
coverage of each failure boundary. Compare undisturbed cAdvisor CPU windows with
`metrics_path="/metrics/cadvisor"`; API sessions and diagnostic Node processes
temporarily add CPU to the same container. Report a reduction only when it exceeds
the observed sampling variation.
