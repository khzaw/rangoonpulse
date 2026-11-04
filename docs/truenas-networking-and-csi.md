---
title: TrueNAS Networking and CSI Recovery
summary: Current asymmetric-routing constraint, NFS settings, management-plane refresh, and diagnostic split.
status: active
owner: homelab
last_reviewed: 2026-11-04
---

# TrueNAS Networking and CSI Recovery

## Current Constraints

- Keep **Accept Routes** disabled in the TrueNAS Tailscale application.
- Cluster NFS mounts use NFSv4.1.
- democratic-csi uses the TrueNAS API for dataset and share lifecycle.
- `truenas-management-plane-refresh` runs Monday at 04:00 Asia/Singapore to refresh the management path.
- Monitoring alerts cover TrueNAS and CSI management failures.

Accepting Tailscale routes on the NAS can send replies for cluster-originated NFS/API traffic through the wrong interface. The resulting asymmetric path looks like a storage outage even when the NAS and datasets are healthy.

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

The HDD controller and node drivers use the standard Kubernetes CSI
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
| NVMe | `9810` | `9813` (reserved) | `9814` (reserved) |

NVMe currently retains the chart's driver exec probe. Helper endpoints bind
explicitly to `127.0.0.1`, and driver HTTP probes target loopback. Controllers with
helpers use `Recreate` so old and new pods cannot share the same health endpoint
or collide on its port. Controller replacement briefly pauses management RPCs;
existing NFS mounts remain independent. Keep one controller replica per release.

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
