---
title: Canal Networking
summary: Talos-owned Canal bootstrap, pinned image compatibility, controlled updates, and network verification.
status: active
owner: homelab
last_reviewed: 2026-11-04
---

# Canal networking

[`infrastructure/canal/bootstrap.yaml`](../infrastructure/canal/bootstrap.yaml)
is the canonical custom CNI bundle. It retains the complete Calico v3.28.0
Canal bootstrap inventory, with Flannel v0.24.4 and an HTTP Felix liveness probe.
All RBAC, CRDs, resources, networking configuration, and controller images
otherwise match the upstream v3.28.0 bundle.

## Ownership and reconciliation

Talos owns these objects through `talos-bootstrap-manifests-inventory`.
This file deliberately has no Flux Kustomization. Do not add a second owner or
remove bootstrap objects to make a smaller patch: Kubernetes upgrades can prune
objects removed from the Talos inventory.

Both secure machine configs set `cluster.network.cni.name: custom` and a single
URL of this form, pinned to the reviewed commit containing the bundle:

```text
https://raw.githubusercontent.com/khzaw/rangoonpulse/<commit-sha>/infrastructure/canal/bootstrap.yaml
```

Git publication alone does not update the cluster. Talos v1.13's ordinary
bootstrap controller creates missing objects and skips existing inventory
members. Updating the source URL refreshes Talos's stored manifest without
rolling existing Canal pods. `talosctl upgrade-k8s` reads that stored manifest
and reapplies it through the same inventory. Keep the promoted bootstrap source
and the live configuration aligned before completing maintenance.

Renovate excludes this path. Image changes require a manual compatibility review
and promotion of a new immutable source URL on both nodes.

## Image and health constraints

Flannel v0.24.4 contains the [IPv6-disabled iptables fix](https://github.com/flannel-io/flannel/pull/1914)
that prevents repeated failed rule installation on this IPv4 cluster. Keep the
IPv4 masquerade, forwarding, subnet, and policy configuration intact.

Calico v3.28.0's [`-felix-live` implementation](https://github.com/projectcalico/calico/blob/v3.28.0/node/pkg/health/health.go)
only checks the local `/liveness` HTTP endpoint. The kubelet HTTP probe uses that
same endpoint at `localhost:9099`, preserving the existing loopback listener,
10-second initial delay, period and timeout, and failure threshold of six.
The existing HTTP readiness probe remains unchanged.

Verify Linux AMD64 and ARM64 manifests for every image, including init containers,
before an update. The canonical v3.28.0 bundle has `install-cni` and `mount-bpffs`
init containers. The live DaemonSet also retains a legacy `flexvol-driver` init
container using the ARM64-compatible `calico/pod2daemon-flexvol:v3.28.0` image and
its host volumes. Preserve these live fields during narrow patches. An old
amd64-only flexvol image prevents pod sandbox creation on the utility node.

## Controlled maintenance

Use the matching, checksum-verified Talos CLI and explicitly select private
direct-LAN recovery credentials; the normal agent auth proxy can restart during
network maintenance. Follow [the access boundary](./agent-access.md#talos-and-recovery).

1. Capture the live DaemonSet, node/pod readiness, bootstrap object identities,
   PVC identities, endpoint responses and a representative per-node CPU window.
   Keep machine configs and recovery credentials private, with mode 0600.
2. Review upstream changes and architecture support. Preserve all bootstrap
   identities and compare the full old/new bundle semantically. A narrow update
   must not implicitly change live init containers, resources, CRDs or RBAC.
3. The bundle is already rendered YAML. Run the Git capacity gate, explicitly
   run the [live capacity preflight](./cpu-headroom-validation.md) against this
   file, and server-side dry-run the bundle and exact live patch. Older field
   ownership can retain an executable probe when server-side apply adds HTTP;
   use an exact whole-probe replacement for that transition and verify the full
   bundle again after staging it. The Flux-only Git capacity render does not
   discover this bootstrap file. Validate the repo,
   publish, and verify the immutable remote artifact matches the reviewed file.
4. Save the current secure machine configs for recovery. Temporarily set the
   DaemonSet to `OnDelete` and stage only the intended template fields with a
   guarded JSON patch as a controlled operator action. Confirm existing pod UIDs
   remain unchanged. For the complete no-force server-side dry run while paused,
   use a temporary validation copy differing only in `updateStrategy: OnDelete`;
   the canonical `RollingUpdate` value conflicts with this deliberate temporary
   ownership change. Do not apply the entire bundle to perform a narrow update.
5. Change only the CNI URL with
   `talosctl patch machineconfig --mode=no-reboot`, one node at a time. Verify
   each persisted configuration and the control plane's stored CNI manifest,
   including the complete object inventory. Existing Canal pod UIDs must still
   be unchanged. Then replace the primary node's Canal pod first,
   verify health and networking, then replace the utility node's pod. Never
   replace both together. Restore the original `RollingUpdate` strategy with
   `maxUnavailable: 1` and `maxSurge: 0` after both pass. Then require the exact
   canonical bundle to pass server-side dry run without forcing conflicts, with
   no differences from the final live DaemonSet spec.
6. Verify both nodes and Canal pods, liveness/readiness, new pod sandboxes on both
   architectures, bidirectional pod traffic, Kubernetes Service access, internal
   and external DNS, HTTPS endpoints, storage attachments and PVC identities.
   Inspect Flannel logs and IPv4 rules, and compare matched CPU windows after
   startup activity settles. Report any pre-existing network failure separately.
7. Export the final machine configs to the secure local source files. Remove
   temporary probe pods, task credentials, backups and install artifacts after
   successful verification.

If verification fails, stop before replacing the next node. Restore the previous
two live fields and source URL from the task recovery material, then verify the
same node before resuming. Do not revert unrelated live or machine-config fields.

See [Kubernetes upgrades](./kubernetes-upgrade.md) for the broader bootstrap and
DNS reconciliation contract.
