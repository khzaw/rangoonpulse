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

## Node Health Checks

The HDD registrar uses its built-in `/healthz` endpoint on `127.0.0.1:9809`.
The node pods use host networking, so the endpoint binds only to loopback and
the kubelet probe explicitly targets that address. Reserve a distinct port for
each driver running on the same node.

The HTTP check verifies that the registration socket exists and answers the
registrar RPC. It runs every ten seconds with the existing one-second timeout
and three-failure threshold. The chart's deprecated
`--mode=kubelet-registration-probe` only exits successfully and incurs a fresh
process launch on each check. The CSI driver's separate liveness check remains
enabled.

The HDD cleanup container sleeps continuously; its chart-provided `preStop`
socket cleanup is preserved. Helm post-renderers own these two overrides because
chart `0.15.1` hardcodes the probe and idle loop. On chart upgrades, render and
verify both overrides, the cleanup hook, loopback listeners, and node registration.

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
