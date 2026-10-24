---
title: Kubernetes Upgrades on Talos
summary: Safe Kubernetes-only upgrades, recovery data, bootstrap ownership, and per-node verification.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Kubernetes upgrades on Talos

Kubernetes and Talos have separate versions and upgrade operations. Use
`talosctl upgrade-k8s` to update Kubernetes. `talosctl upgrade` replaces the Talos
operating system and is not part of a Kubernetes-only upgrade.

## Choose the supported target

Read the [Talos support matrix](https://docs.siderolabs.com/talos/v1.13/getting-started/support-matrix)
for the installed Talos minor version, then check the latest patch release of
each Kubernetes minor in the upgrade path. Upgrade one minor at a time and
verify the cluster between steps.

Use a checksum-verified `talosctl` matching the installed Talos release. Set
`KUBECONFIG="$PWD/kubeconfig"` explicitly; a working Talos connection does not
prove that the shell's default Kubernetes credentials are correct.

## Preserve the recovery state

Before the first mutation:

- Check API `/readyz`, Talos health, etcd health, node conditions, Flux readiness,
  all container readiness states, PVC bindings, monitoring targets and alerts.
- Save an etcd snapshot with `talosctl -n 10.0.0.197 etcd snapshot <path>` and
  confirm successful snapshot validation in the command output. Record its
  SHA-256 checksum. An etcd snapshot contains
  cluster objects and secrets, not application data stored on PVCs.
- Export each node's live machine config into an ignored private backup directory beneath `talos/`. Also copy the existing local source configs.
- Record workload and storage identities, CoreDNS configuration, and HTTPS
  endpoint responses for comparison after the upgrade.
- Check Kubernetes release notes, removed APIs and custom kubelet arguments.

Use `umask 077` for backups and logs. Machine configs contain credentials, and
even the upgrade dry run can print bootstrap Secret contents. Do not commit
these files or paste complete dry-run output into a chat.

Keep task recovery material only while it is needed to complete or recover the upgrade. After successful verification, remove temporary backups and logs; preserve protected recovery files and user data.

## Upgrade each minor

Follow the [Sidero Labs upgrade procedure](https://docs.siderolabs.com/kubernetes-guides/advanced-guides/upgrading-kubernetes).
The node argument identifies the control plane used to orchestrate the upgrade;
the command updates kubelets on both nodes.

```sh
export KUBECONFIG="$PWD/kubeconfig"
talosctl -n 10.0.0.197 upgrade-k8s --to <next-minor-patch> --dry-run > /private/path/dry-run.log 2>&1
talosctl -n 10.0.0.197 upgrade-k8s --to <next-minor-patch> > /private/path/upgrade.log 2>&1
```

This cluster has one control-plane node. API interruptions during static-pod
replacement are expected; dependent controllers may restart while the API is
unavailable. Inspect actual runtime state before treating a stale mirror pod or
a temporary monitoring alert as a failed upgrade.

If a static pod remains `Pending` after Talos renders its replacement, inspect
Talos static-pod status, kubelet and CRI logs, and OOM actions. The existing
[control-plane recovery procedure](./talos-userspace-oom-control-plane-cgroups.md)
includes a targeted kubelet restart for this condition. Preserve
the existing API-server, controller-manager and scheduler memory limits.

If the command exits partway through, diagnose the failed stage and rerun the
same target to resume. Do not skip a minor because a command failed. Kubernetes
downgrades are not the normal recovery path.

## Bootstrap manifests and Flux

Talos reapplies bootstrap manifests during `upgrade-k8s`. Review the dry run:
it can update CoreDNS and kube-proxy and reapply the custom Canal manifests.
The secure machine config must retain an ARM64-compatible Canal source. Inspect every init-container image, especially `pod2daemon-flexvol`; an amd64-only image causes `exec format error` and prevents pod networking on the utility node. Verify image manifests and sandbox creation on both architectures rather than copying an old init-container index or tag.

Talos' default CoreDNS ConfigMap overwrites this repo's explicit upstream DNS
settings. Restore the GitOps configuration after every completed minor step:

```sh
flux reconcile kustomization dns-reliability -n flux-system
kubectl -n kube-system rollout status deployment/coredns
```

Compare the live Corefile with
`infrastructure/dns-reliability/coredns-configmap.yaml`. Follow
[the DNS reliability runbook](./dns-reliability.md)
if Flux cannot fetch its source. Do not disable CoreDNS in Talos without first
planning ownership of its deployment, Service and RBAC; bootstrap pruning can
remove resources.

If dependent Flux Kustomizations remain unready, trace the dependency to its
root and read the kustomize-controller logs. A controller can fail to report status during an API interruption and leave dependencies blocked until a long retry interval expires. Request fresh reconciliation of the affected root objects, then verify their dependents. Do not diagnose a `Building manifests`
status as an active build without checking the controller's final log message.

## Verify and sync the local source

At each minor, check API readiness, component images, both kubelet versions,
node readiness, Canal/CoreDNS/kube-proxy, Flux and application readiness. Create
temporary, capacity-checked probe pods on each architecture to test internal
and external DNS, the Kubernetes Service, and pod traffic in both directions.
Delete the probes afterward.

At the final target, also verify:

- Talos and etcd health, with the Talos OS version unchanged.
- Every PVC remains bound to the same volume and retains its original UID.
- Desired replicas and container readiness across the cluster.
- Prometheus targets and warning/critical alerts after recovery windows expire.
- HTTPS/TLS responses against the baseline, plus application-specific health
  endpoints where available. A successful landing page alone does not prove
  every authenticated application workflow.

Export the final live machine configs to the secure local source files after
preserving their old copies. This keeps future Talos maintenance from restoring
old Kubernetes images or losing live DNS, resource and node settings. Do not
reapply stale generated configs just to update their version fields. Configs
under `talos/` remain ignored; only the non-secret procedure belongs in Git.

## Monitoring And Job Recovery

Kubelet restarts can briefly produce out-of-order cAdvisor samples. Inspect the last warning and recent rate before changing monitoring. Allow maintenance events to age out of restart-alert windows while verifying that counts stabilize.

A Job can publish its output yet fail to reach `Complete` because the API interruption prevents completion reporting. Check Job conditions as well as pod success and published artifacts. If necessary, run a capacity-checked replacement, verify its output and completion, then remove task verification Jobs.
