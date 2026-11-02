---
title: Agent cluster access
summary: Portable tailnet authentication, Git-managed Kubernetes RBAC, host enrollment, and recovery boundaries.
status: active
owner: homelab
last_reviewed: 2026-11-02
---

# Agent cluster access

External agents use the existing Tailscale Kubernetes API auth proxy. A Mac,
Linux VM, or VPS follows the same contract: an authorized tailnet device, a
standard kubeconfig, and Kubernetes RBAC. The chat transport only delivers the
task; local CLI requests authenticate using the host's tailnet identity.

## Sources of truth

- `infrastructure/tailscale-operator/helmrelease.yaml` enables the authenticated
  in-process API proxy on the operator's tailnet device.
- `infrastructure/tailscale-operator/agent-access-rbac.yaml` owns Kubernetes
  access for the agent device tags.
- `infrastructure/tailscale-operator/agent-access-policy.json` declares the
  administrator-owned tags and network grant to the proxy.
- `scripts/apply_agent_access_policy.py` merges that fragment into the external
  tailnet policy without replacing unrelated ACLs, SSH rules, or grants. Apply
  uses the current ETag and verifies read-back. The API validates the policy
  before accepting it. Unrelated policy remains externally managed.

The operator's `apiServerProxyConfig.mode` must remain `"true"`. Its proxy tag
is `tag:k8s-operator`. The proxy authenticates the originating device and sets
Kubernetes impersonation headers; the client does not choose its own RBAC group.
For tagged devices, the device FQDN identifies the caller and tags become groups.
Application grants that override Kubernetes groups must not replace these groups
with `system:masters` or unrelated elevated groups.

## Access profiles

| Device tag | Kubernetes access |
| --- | --- |
| `tag:homelab-agent-observer` | Built-in `view` plus node/storage inventory, Metrics API, Flux status, and health endpoints. No Secret reads, pod exec, or writes. |
| `tag:homelab-agent-operator` | `cluster-admin`, including exec, temporary workloads, Secrets, RBAC, and recovery operations. Assign only to fully trusted operator hosts. |

Only tailnet administrators own these tags. Tailnet membership alone grants no
agent RBAC role. The tailnet's other network ACLs can allow reaching the proxy;
Kubernetes still authorizes each request. Tags are additive, so do not put both
profiles on a host expecting observer restrictions. Operator access is deliberately
powerful: permanent desired-state changes still go through Git/Flux, and RBAC
does not enforce that workflow.

## Apply access policy

From an existing operator/recovery context, after reviewing the Git fragment:

```sh
# Use the tailnet name or MagicDNS suffix from the Tailscale admin console.
python3 scripts/apply_agent_access_policy.py --tailnet "$TAILNET"
python3 scripts/apply_agent_access_policy.py --tailnet "$TAILNET" --apply
```

The helper reuses `tailscale/operator-oauth`, whose provider permissions must
allow policy-file reads/writes. `--kubeconfig` selects an explicit recovery
context's file. Alternatively, supply `TAILSCALE_CLIENT_ID` and
`TAILSCALE_CLIENT_SECRET` through a private execution environment. Credentials
remain in memory and never appear in command arguments, logs, or Git. A policy
ownership conflict or concurrent ETag change fails rather than overwriting it.

## Enroll a host

1. Install Tailscale and the required Kubernetes tools, then join the tailnet.
2. Have a tailnet administrator assign one access tag. A tag replaces user-owned
   device identity, so review any user-specific Tailscale access the host needs.
3. For an unattended server, verify device approval and disabled device key
   expiry in the admin console. Tagged enrollment defaults to disabled expiry,
   but tagging an existing device does not necessarily change its expiry setting.
4. Run as the OS account that runs the agents:

```sh
tailscale configure kubeconfig tailscale-operator
kubectl auth whoami
kubectl get nodes
flux get kustomizations -A
```

The CLI discovers the proxy's MagicDNS name; a full FQDN can also be supplied.
The resulting kubeconfig contains no Kubernetes client private key or usable bearer
credential. The host's Tailscale daemon and device authorization supply authentication,
so no Kubernetes certificate renewal job or OS-specific scheduler is needed.
Each device retains its own tailnet identity and can be revoked independently.

All agents running under that OS account can use the kubeconfig. Separate users,
containers, and sandboxed agents need explicit access to the configuration and
the Tailscale network interface. Tool executables must be on their `PATH`.

## Verification and revocation

Check the real host through the proxy, not just an administrator impersonation:

```sh
kubectl auth whoami
kubectl auth can-i get nodes
kubectl auth can-i get secrets -A
kubectl auth can-i create pods/exec -n default
kubectl auth can-i patch deployments.apps -n default
```

Observers must be denied the last three capabilities; operators are allowed.
An unassigned identity must not receive either role. The proxy caller should
have its assigned tag group, without `system:masters`.

To revoke one host, remove its access tag or remove the device from the tailnet.
Reassigning the observer tag reduces its permissions. To revoke an entire
profile, remove its Git-managed ClusterRoleBindings and reconcile the operator
Kustomization. Revocation affects subsequent API requests; terminate existing
interactive sessions separately when required.

## Talos and recovery

Kubernetes RBAC does not authenticate Talos. Talos uses its own client
certificates and roles over the node API. Use `os:reader` for node-level
diagnostics and issue `os:admin` only for explicitly trusted node operators.
Do not distribute Talos administrator credentials merely to onboard a cloud
Kubernetes agent. Talos certificate expiry remains an independent lifecycle.

The auth proxy shares the Tailscale operator's lifecycle. A proxy, tailnet, or
cluster outage can prevent this access even when the underlying nodes are up.
Maintain private direct-LAN operator/Talos recovery credentials separately from
the default agent kubeconfig; see [Kubernetes upgrades](./kubernetes-upgrade.md).
The native sentinel retains its independent health-only identity and direct LAN
API check, as described in [native operations](./iris-operations.md).

Reference: [Tailscale API proxy RBAC](https://tailscale.com/docs/kubernetes-operator/api-server-access/auth-and-rbac).
