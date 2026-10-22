# Kubernetes upgrades on Talos

Kubernetes and Talos have separate versions and upgrade operations. Use
`talosctl upgrade-k8s` to update Kubernetes. `talosctl upgrade` replaces the Talos
operating system and is not part of a Kubernetes-only upgrade.

## Choose the supported target

Read the [Talos support matrix](https://docs.siderolabs.com/talos/v1.13/getting-started/support-matrix)
for the installed Talos minor version, then check the latest patch release of
each Kubernetes minor in the upgrade path. Upgrade one minor at a time and
verify the cluster between steps.

On 2026-10-22, Talos v1.13.5 supported Kubernetes through 1.36. The selected path
from this cluster's v1.33.13 was v1.34.12, v1.35.9, then v1.36.5. Talos itself
remains v1.13.5. Recheck these versions for subsequent maintenance.

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
- Export each node's live machine config into a private directory under the
  ignored `talos/backups/` tree. Also copy the existing local source configs.
- Record workload and storage identities, CoreDNS configuration, and HTTPS
  endpoint responses for comparison after the upgrade.
- Check Kubernetes release notes, removed APIs and custom kubelet arguments.

Use `umask 077` for backups and logs. Machine configs contain credentials, and
even the upgrade dry run can print bootstrap Secret contents. Do not commit
these files or paste complete dry-run output into a chat.

The 2026-10-22 backup is stored locally at
`talos/backups/kubernetes-20261022.VX8Fjt/`. It includes the validated pre-upgrade
etcd snapshot, live and source machine configs, and verification evidence.

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
includes a targeted kubelet restart for this condition. All three minor steps
encountered this condition during API-server replacement. Restarting kubelet
restored API service; the 1.34 command also needed to be resumed after its
scheduler wait timed out. Preserve
the existing API-server, controller-manager and scheduler memory limits.

If the command exits partway through, diagnose the failed stage and rerun the
same target to resume. Do not skip a minor because a command failed. Kubernetes
downgrades are not the normal recovery path.

## Bootstrap manifests and Flux

Talos reapplies bootstrap manifests during `upgrade-k8s`. Review the dry run:
it can update CoreDNS and kube-proxy and reapply the custom Canal manifests.
The machine config must retain the ARM64-compatible Canal source documented in
[the Canal incident](./arm64-node-canal-flexvol-exec-format-error.md).

Talos' default CoreDNS ConfigMap overwrites this repo's explicit upstream DNS
settings. Restore the GitOps configuration after every completed minor step:

```sh
flux reconcile kustomization dns-reliability -n flux-system
kubectl -n kube-system rollout status deployment/coredns
```

Compare the live Corefile with
`infrastructure/dns-reliability/coredns-configmap.yaml`. Follow
[the DNS reliability runbook](./dns-reliability-flux-gitrepository-timeouts.md)
if Flux cannot fetch its source. Do not disable CoreDNS in Talos without first
planning ownership of its deployment, Service and RBAC; bootstrap pruning can
remove resources.

If dependent Flux Kustomizations remain unready, trace the dependency to its
root and read the kustomize-controller logs. During the 1.36 upgrade,
`local-path-provisioner`, `ingress-nginx`, `metallb-config`, and `prowlarr` failed
to update their status during an API interruption. Their next retry was 24
hours away, leaving `Ready=Unknown` and blocking dependent reconciliations even
though the workloads were healthy. Request fresh reconciliation of those root
objects, then verify their dependents. Do not diagnose a `Building manifests`
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

The source configs saved before the 2026-10-22 upgrade still referenced
Kubernetes v1.32.3. They were backed up and refreshed from the final live
v1.36.5 configs with mode `0600`. Comparison with the live pre-upgrade configs
confirmed that only Kubernetes image fields changed, apart from omission of an
empty registry mapping on the utility node.

## 2026-10-22 verification

The upgrade completed through all three minors. Both nodes and all control-plane
components and kube-proxy reached v1.36.5 while Talos remained v1.13.5.
Verification covered Talos health, API readiness, etcd health, all 88 workload
controllers, 127 Flux Kustomizations/HelmReleases, and 36 Prometheus targets.
All 49 PVC identities and volume bindings matched the pre-upgrade snapshot.
Temporary pods on both architectures passed internal/external DNS, Kubernetes
Service connectivity, and pod-to-pod HTTP in both directions, then were deleted.

All 52 ingress HTTPS responses matched their baseline with valid TLS, including
the expected Anki root-path 404. Jellyfin, Immich, Vaultwarden, BookOrbit and
LiveSync health endpoints passed. The Immich, shared-media and Vaultwarden
PostgreSQL instances accepted connections and returned `SELECT 1` successfully.
Both AdGuard DNS addresses answered external lookups. CoreDNS matched its Git
configuration after reconciliation.

Kubelet restarts briefly produced out-of-order cAdvisor samples. Inspect the
last warning timestamp and the five-minute rate before changing monitoring
settings. Control-plane restart alerts intentionally look back 15 minutes;
allow the maintenance events to age out while checking that restart counts
remain stable.

The 15:30 UTC capacity-snapshot Job published its records, but the API outage
prevented timely completion reporting and the Job controller subsequently
marked it `DeadlineExceeded`. Its logs and status were retained in the private
upgrade backup. A capacity-checked manual run of the same CronJob completed and
published a fresh snapshot; the failed Job and temporary verification Job were
then removed. Check Job conditions as well as `status.succeeded`: a published
snapshot or succeeded pod alone does not prove the Job reached `Complete`.
The next scheduled run at 15:45 UTC completed normally. At the final check,
all warning and critical alerts had cleared, all 127 Flux resources were Ready,
and all 36 Prometheus targets were healthy.
