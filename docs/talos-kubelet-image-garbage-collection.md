---
title: Talos Kubelet Image Garbage Collection
summary: Cluster policy and verification runbook for bounding container-image growth on Talos EPHEMERAL filesystems.
status: active
owner: homelab
last_reviewed: 2026-08-29
---

# Talos Kubelet Image Garbage Collection

## Policy

Both Talos nodes should run kubelet with:

```yaml
machine:
  kubelet:
    extraConfig:
      imageGCHighThresholdPercent: 75
      imageGCLowThresholdPercent: 70
      imageMaximumGCAge: 168h
```

This means:

- threshold-based image garbage collection starts at 75% filesystem use and reclaims toward 70%
- an image unused for seven days becomes eligible for age-based garbage collection
- images referenced by running containers remain protected
- an old rollback image can be repulled instead of being retained indefinitely

Do not add a privileged cleanup CronJob. Kubelet owns CRI image lifecycle and should enforce the policy directly.

## Why The Defaults Are Wrong Here

The Kubernetes defaults observed on both nodes were:

- high threshold: 85%
- low threshold: 80%
- maximum image age: disabled (`0s`)

On the primary node's approximately 511 GB EPHEMERAL partition, those defaults allowed old image versions to accumulate until less than 15% remained free.

The 2026-08-29 investigation found:

- `/var` at 83.26% with about 85.5 GB available
- about 175 GB under `/var/lib/containerd`
- about 4,600 overlay snapshot directories
- 756 unique CRI image digests, of which only 70 were referenced by current pods
- 686 unused digests with 131.8 GB of logical image size
- no image removals during a 14-day window in which `/var` grew by 19.7 GB

Image-list size is a logical estimate, not exact reclaimable storage, because image layers are shared.

## Applying The Policy

The full Talos machine configurations contain sensitive material and are intentionally ignored by Git. Update the secure source machine configurations with the YAML policy above whenever they are regenerated.

For a live node whose `machine.kubelet.extraConfig` is currently empty, apply the policy without rebooting:

```bash
NODE_IP=10.0.0.197

talosctl --talosconfig ./talos/talosconfig \
  -e "$NODE_IP" -n "$NODE_IP" \
  patch machineconfig --mode no-reboot \
  --patch '[{"op":"add","path":"/machine/kubelet/extraConfig","value":{"imageGCHighThresholdPercent":75,"imageGCLowThresholdPercent":70,"imageMaximumGCAge":"168h"}}]'
```

Primary node: `10.0.0.197` (`talos-7nf-osf`).
Utility node: `10.0.0.38` (`talos-uua-g6r`).

Before reusing that exact JSON patch, inspect the live `extraConfig`. If it already contains unrelated keys, merge the three image-GC keys instead of replacing the whole object.

Changing kubelet configuration restarts kubelet but does not reboot the node. Apply and verify one node at a time.

## Verification

Check the live policy:

```bash
kubectl get --raw /api/v1/nodes/<node-name>/proxy/configz \
  | jq '.kubeletconfig | {
      imageGCHighThresholdPercent,
      imageGCLowThresholdPercent,
      imageMaximumGCAge
    }'
```

Check filesystem reclamation:

```bash
kubectl get --raw /api/v1/nodes/<node-name>/proxy/stats/summary \
  | jq '.node.fs, .node.runtime.imageFs'
```

Check service and workload health:

```bash
talosctl -n <node-ip> service kubelet
kubectl get node <node-name>
kubectl get pods -A -o wide
```

After threshold-triggered collection, verify:

- filesystem use falls to the configured low target or lower
- CRI image and overlay-snapshot counts decrease
- kubelet is healthy
- the node remains Ready with `DiskPressure=False`
- no pods or containers become unready

Kubelet can overshoot the low target because reclaim planning uses logical image sizes while physical layers may be shared. Falling below 70% is healthy and not evidence of over-deletion; currently referenced images remain protected.

Kubelet tracks maximum image age locally. Restarting kubelet resets that age tracking, so the lower high/low thresholds provide immediate cleanup while the seven-day age cap bounds future accumulation.

## Accounting Pitfall

Do not trust recursive `talosctl usage /var` totals when `/var/lib/kubelet` contains mounted NFS or CSI volumes. Those traversals can report many terabytes that are not on the local EPHEMERAL filesystem. Use kubelet `stats/summary` for real filesystem capacity and use focused Talos usage checks for local directories such as:

```bash
talosctl -n <node-ip> usage -H -d 2 /var/lib/containerd
talosctl -n <node-ip> usage -H -d 2 /var/mnt/local-path-provisioner
talosctl -n <node-ip> usage -H -d 2 /var/lib/longhorn
talosctl -n <node-ip> usage -H -d 2 /var/log
```
