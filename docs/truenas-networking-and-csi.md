---
title: TrueNAS Networking and CSI Recovery
summary: TrueNAS console policy, asymmetric-routing constraint, NFS settings, management API callers, middlewared restart cadence, and diagnostic split.
status: active
owner: homelab
last_reviewed: 2026-11-23
---

# TrueNAS Networking and CSI Recovery

## Current Constraints

- Keep **Accept Routes** disabled in the TrueNAS Tailscale application.
- Cluster NFS mounts use NFSv4.1.
- democratic-csi uses the TrueNAS API for dataset and share lifecycle.
- `truenas-management-plane-refresh` restarts middlewared, nginx, and Netdata on Monday and Thursday at 04:40 Asia/Singapore; see [Middlewared Memory and Restart Cadence](#middlewared-memory-and-restart-cadence).
- Every authenticated TrueNAS API request is a full login; keep cluster callers to the budget in [Management API Callers](#management-api-callers).
- Monitoring alerts cover TrueNAS and CSI management failures.

Accepting Tailscale routes on the NAS can send replies for cluster-originated NFS/API traffic through the wrong interface. The resulting asymmetric path looks like a storage outage even when the NAS and datasets are healthy.

## Local Console

The NAS uses a standard login prompt on its local console with
`system.advanced.consolemenu=false`. This avoids keeping the Python console menu
resident on the low-memory host. Local shell access remains available after
authentication; retain a local administrator account with a usable password and
shell for recovery.

This is a persistent appliance setting in the TrueNAS configuration database,
managed through the TrueNAS UI or middleware API rather than Flux. In
**System > Advanced > Console**, clear **Show Text Console without Password
Prompt**. The equivalent command below runs on the NAS over SSH; changing the
setting automatically restarts the local console session:

```bash
sudo midclt call system.advanced.update '{"consolemenu": false}' >/dev/null
```

Verify the saved setting is `False`, `getty@tty1.service` is active, and its
running process is `agetty` at the idle login prompt:

```bash
sudo midclt call system.advanced.config | python3 -c 'import json, sys; print(json.load(sys.stdin)["consolemenu"])'
systemctl is-active getty@tty1.service
pid=$(systemctl show getty@tty1.service --property=MainPID --value)
ps -p "$pid" -o comm=
systemctl show getty@tty1.service --property=MemoryCurrent
```

The unit's configured `ExecStart` can still show `/usr/bin/cli --menu --pager`:
the launcher replaces itself with `agetty` when the menu is disabled. Inspect
the running process rather than changing or disabling the systemd unit. To
restore the automatic menu, set `consolemenu` to `true` through the same API.

## Management API Callers

On TrueNAS 25.04 every authenticated REST request (`/api/v2.0`, HTTP Basic) is a
separate middleware login: about 0.9 seconds of NAS work and one `AUTHENTICATION`
record in the middleware audit log, whatever method it calls. An unauthenticated
request is rejected in about 10 ms without a login. Cluster traffic leaves through
the primary node address, so the audit log attributes the exporter and both
controllers to that one source; tell them apart by method and timing.

| Caller | Requests | Logins per day |
| --- | --- | --- |
| democratic-csi HDD and NVMe controllers | CSI `Probe` from the 60-second liveness check calls `GET /system/version/`; the driver caches the answer for 60 seconds, so each controller logs in about every 120 seconds. Provisioning, expansion, and snapshot RPCs log in on demand. | ~1,440 |
| `truenas-pvc-dataset-exporter` `/metrics` | One flat `pool.dataset.query` limited to `usedbydataset`, `available`, `refquota`, and `quota`, without user properties or snapshots (about 90 KB), reused by scrapes for 15 minutes. A newly listed democratic-csi PV refreshes it sooner, at most once per 110 seconds. | ~96 |
| `truenas-pvc-dataset-exporter` `/power` | `/disk` inventory hourly. `/proc/stat` through `core.download` every 10 minutes; each download also creates a middleware job. Both are re-read on the next two polls after any failure or restart. Disk busy counters come from Netdata every 120 seconds without middleware. | ~168 |
| democratic-csi node plugins | None. Kubelet volume stats run `findmnt` and `df` locally on each node. | 0 |
| Blackbox `truenas-ui` and `truenas-api`, Gatus, Dynacat, refresh preflight | Unauthenticated `/ui/` or a `401` from `/api/v2.0/system/version/`. | 0 |

Operator and agent sessions add logins only while they work. Do not add a
per-scrape or per-minute authenticated caller; cache slowly changing NAS state,
read host counters from Netdata where its values are exact, and prefer
unauthenticated reachability probes. Count audit records read-only before and
after a caller change:

```bash
# democratic-csi API credentials in the environment; the password stays off the
# command line. Returns a count, not records.
printf 'user = "%s:%s"\n' "$TRUENAS_USERNAME" "$TRUENAS_PASSWORD" |
  curl -sS -K - -H 'Content-Type: application/json' \
    -d '{"services":["MIDDLEWARE"],"query-filters":[["event","=","AUTHENTICATION"]],"query-options":{"count":true}}' \
    "http://${NAS_IP}/api/v2.0/audit/query"
```

Audit retention is five days. The audit handler (`tnaudit`) is a separate
service that the refresh does not restart.

## Middlewared Memory and Restart Cadence

The NAS has 3.7 GiB of RAM, no swap, and a 1 GiB ZFS ARC ceiling.
`TrueNASMemoryHeadroomLow` uses the kernel's `MemAvailable`, which excludes ARC.
Middlewared's main process grows linearly between restarts and squeezes ARC;
available memory also dips for tens of minutes during TrueNAS's own daily jobs
(update check at 01:21, directory-cache refresh at 03:30, certificate and catalog
jobs at 04:00).

Growth rises with authenticated API traffic, and download jobs cost the most. With
about 2,200 logins a day middlewared grew about 55 MiB a day; when the exporter
also polled `/disk` and `core.download` every 120 seconds (about 3,600 logins and
720 download jobs a day) it grew about 76 MiB a day. Measured in isolation, one
download cycle retains about 50 KiB and a bare login about 8 KiB. TrueNAS's own
04:00 jobs add another 10–30 MiB step each day. A restart frees 550–770 MiB, but
about 300 MiB returns within the first day as middlewared warms up, so restarting
more often than every other day gains little. At about 55 MiB a day the lowest
available memory stayed at or above 11 percent through day four of a cycle; at
76 MiB a day it fell below 10 percent from day three.

To re-check the rate, fit middlewared memory (Netdata `services.mem_usage`,
dimension `system-slice_middlewared-service`) from 24 hours after a restart to
the next restart. Treat a rate well above 55 MiB a day as a new caller to find.

`truenas-management-plane-refresh` restarts middlewared, nginx, and Netdata on
Monday and Thursday at 04:40 Asia/Singapore, so no cycle exceeds four days. The
slot follows TrueNAS's 04:00 daily jobs, so it also clears that day's step, and it
avoids the 03:30 Monday Resource Advisor apply job. A restart makes the API
unavailable for about a minute:

- democratic-csi management RPCs in that minute fail and are retried by the
  external sidecars; existing NFS mounts are unaffected
- the controllers' liveness check tolerates one failed `Probe`
- Netdata restarts between 60-second scrapes, so `TrueNASNetdataUnavailable`
  (two minutes) does not fire
- the power endpoint fails closed for about two polls, below the ten-minute
  `TrueNASPowerSampleUnavailable` hold; `/metrics` keeps serving cached datasets
- open TrueNAS UI sessions reconnect

Do not lower the alert threshold to hide growth. If available memory still dips
below 10 percent late in a cycle, look for a new authenticated caller first, then
shorten the cadence.

## CSI Health Checks

The registrars use their built-in `/healthz` endpoint on `127.0.0.1:9809` (HDD)
and `127.0.0.1:9810` (NVMe).
The node pods use host networking, so the endpoint binds only to loopback and
the kubelet probe explicitly targets that address. Reserve a distinct port for
each driver running on the same node.

The HTTP check verifies that the registration socket exists and answers the
registrar RPC. It runs every ten seconds with the existing one-second timeout
and three-failure threshold. The chart's deprecated
`--mode=kubelet-registration-probe` only exits successfully and incurs a fresh
process launch on each check. The CSI driver has a separate liveness check.

The HDD and NVMe controller and node drivers use the standard Kubernetes CSI
`livenessprobe` helper. Its `/healthz` handler connects to
`/csi-data/csi.sock.internal` and calls CSI `Identity.Probe`; it does not cache
health between requests. The HTTP liveness probe belongs to `csi-driver`, so
three failed checks restart the driver. Helper process exits are independently
restarted by the pod restart policy. Initial delay is 10 seconds, cadence 60
seconds, timeout 15 seconds, and failure threshold three. The helper's connection
and RPC share a 15-second deadline. It reconnects on each check, including after
the driver replaces its socket.

Reserve these host-network loopback listeners across both releases:

| Release | Registrar | Controller helper | Node helper |
| --- | --- | --- | --- |
| HDD | `9809` | `9811` | `9812` |
| NVMe | `9810` | `9813` | `9814` |

Helper endpoints bind explicitly to `127.0.0.1`, and driver HTTP probes target
loopback. Controllers use `Recreate` so old and new pods cannot share the same health endpoint
or collide on its port. Controller replacement briefly pauses management RPCs;
existing NFS mounts remain independent. Keep one controller replica per release.
Both controllers are placed on the primary node explicitly so replacement does
not shift management work between architectures.

The helper is pinned to a multi-architecture image digest; the driver is pinned
to its existing `next` digest so a health-check rollout cannot silently upgrade
it. Each helper requests 5m CPU and 32Mi memory, with 100m/64Mi limits. It runs as
root only to connect to the driver's mode-0600 internal socket, with a read-only
socket mount/root filesystem, no capabilities, no privilege escalation, and
RuntimeDefault seccomp.

CSI semantics are `ready=true` or omitted readiness → HTTP 200, and
`ready=false`, RPC error, missing socket, or timeout → failure. The installed
Node exec probe mishandles the protobuf readiness wrapper; use the CSI semantics
when verifying a replacement. The helper's exact pinned binary must pass isolated
true/false/omitted/error/timeout and socket-reconnection fixtures and real-socket
checks on both architectures. This driver currently reports ready once its RPC
server responds; it is not an NFS or TrueNAS API end-to-end test. Keep storage
operation and management-plane monitoring enabled.

Each cleanup container sleeps continuously; its chart-provided `preStop`
socket cleanup is preserved. Chart `0.15.1` supports controller `extraContainers`
but hardcodes probes/cleanup and lacks node `extraContainers`; narrow inline
post-renderers supply those overrides and the controller rollout strategy.
On chart upgrades, render and verify probes, socket mounts, cleanup hooks,
loopback port uniqueness, deployment strategy, and node registration. Roll out
HDD and NVMe separately, verifying existing reads, disposable provisioning/mounts,
and fresh volume-stat metrics between releases. Compare equal steady-state
cAdvisor windows with `metrics_path="/metrics/cadvisor"`, including every CSI pod
container and the helpers' resident memory; do not infer savings from requests.

## Diagnose By Failure Boundary

### NFS and API Fail Together

1. Verify node-to-NAS routing and source address.
2. Check the TrueNAS Tailscale application's Accept Routes setting.
3. Test NFS port and TrueNAS API reachability from the affected node.
4. Inspect democratic-csi controller and node logs.
5. Confirm existing mounts and new provisioning separately.

Do not change StorageClasses or recreate PVCs before routing is proven.

### Existing NFS Mounts Work But Management Actions Fail

This points to the TrueNAS API or CSI management plane rather than the NFS data path.

Check:

- maintenance CronJob status and logs
- democratic-csi controller memory, restarts, and API errors
- TrueNAS API reachability and credentials without printing values
- whether only provisioning/expansion/stats calls fail while mounted I/O remains healthy

Controller OOM or API timeout recovery should target the management component, not running application PVCs.

## Verification

```bash
kubectl get sc,pv,pvc -A
kubectl get pods -n democratic-csi -o wide
kubectl logs -n democratic-csi -l app.kubernetes.io/name=democratic-csi --since=30m
kubectl get cronjob,job -A | grep truenas-management-plane-refresh
kubectl get prometheusrule -n monitoring | grep -i truenas
```

A healthy PVC status alone does not prove fresh provisioning or volume-stat collection works. Test the exact operation that failed.
