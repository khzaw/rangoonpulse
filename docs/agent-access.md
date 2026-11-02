---
title: Agent host provisioning and cluster access
summary: Provision agent hosts with tailnet identity, Kubernetes RBAC, runtime verification, revocation, and optional Talos access.
status: active
owner: homelab
last_reviewed: 2026-11-02
---

# Agent host provisioning and cluster access

External agents use the existing Tailscale Kubernetes API auth proxy. A Mac,
Linux VM, or VPS follows the same contract: an authorized tailnet device, a
standard kubeconfig, and Kubernetes RBAC. The chat transport only delivers the
task; local CLI requests authenticate using the host's tailnet identity.

For a new host, start with [Enroll a host](#enroll-a-host). The policy maintenance
section is for an existing cluster operator; a new host does not need access to
the operator OAuth Secret or permission to change tailnet policy.

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

Authentication is device-scoped. Every process that reaches the proxy through the
same tailnet device can receive that device's role. Separate OS users and separate
kubeconfig files do not create separate RBAC identities. Use separate tailnet
devices for agents with different trust levels. These profiles govern Kubernetes
API access; the policy fragment does not restrict unrelated tailnet network ACLs.

## Apply access policy

Run this stage from an existing operator/recovery context when the Git-managed
policy changes. Review and publish RBAC changes through Git/Flux, then verify
the proxy and bindings:

```sh
flux reconcile kustomization tailscale-operator -n flux-system --with-source
kubectl -n tailscale get deployment operator
kubectl get clusterrolebinding homelab-agent-operators homelab-agent-observers homelab-agent-diagnostics
```

Apply the tailnet fragment separately. Set `TAILNET` to the tailnet name or
MagicDNS suffix from the Tailscale admin console:

```sh
uv run --no-project python scripts/apply_agent_access_policy.py --tailnet "$TAILNET"
uv run --no-project python scripts/apply_agent_access_policy.py --tailnet "$TAILNET" --apply
```

The helper reuses `tailscale/operator-oauth`, whose provider permissions must
allow policy-file reads/writes. `--kubeconfig` selects an explicit recovery
context's file. Alternatively, supply `TAILSCALE_CLIENT_ID` and
`TAILSCALE_CLIENT_SECRET` through a private execution environment. Credentials
remain in memory and never appear in command arguments, logs, or Git. A policy
ownership conflict or concurrent ETag change fails rather than overwriting it.
New hosts reuse these tags and bindings; adding a host does not require another
RBAC manifest or another policy application.

## Enroll a host

### 1. Prepare the host and agent account

Install [Tailscale](https://tailscale.com/docs/install) and
[`kubectl`](https://kubernetes.io/docs/tasks/tools/). Install the
[Flux CLI](https://fluxcd.io/flux/installation/#install-the-flux-cli) for agents
that inspect or reconcile Flux, and Git for agents that work on IaC. Keep
`kubectl` within the supported [version skew](https://kubernetes.io/releases/version-skew-policy/#kubectl)
of the API server. Talos tooling is optional and covered below.

Use the platform's supported Tailscale installation:

- [Linux](https://tailscale.com/docs/install/linux): enable the persistent
  `tailscaled` service. On systemd hosts, use `sudo systemctl enable --now tailscaled`.
- [macOS](https://tailscale.com/docs/install/mac): use one installed client and
  make its CLI available. With a GUI client and login-based bot services, verify
  their startup behavior for the intended login session.

Choose the OS account and home directory that will run the agent service. The
following kubeconfig commands run as that account, not an unrelated root or SSH
login account. Kubernetes access only needs the proxy's tailnet HTTPS endpoint;
it does not require public Kubernetes ports or accepting the LAN subnet routes.

### 2. Join the tailnet and assign one profile

For interactive enrollment, run `tailscale up` on the new host and finish the
displayed sign-in flow in a browser. Linux normally requires `sudo tailscale up`.
Have a tailnet administrator approve the device if approval is enabled and assign
exactly one tag from the access profile table.

For a headless VM or VPS, a tailnet administrator can instead create a
non-reusable auth key with the selected tag. Use a persistent device enrollment
(not an ephemeral device), a short bootstrap-key lifetime, and pre-approval if
the tailnet requires device approval. Deliver the key through the provisioner's
secret mechanism into a root-owned mode-0600 file. On a Linux host:

```sh
# This variable contains a file path, never the key value.
TAILSCALE_BOOTSTRAP_KEY_FILE="/run/secrets/tailscale-enrollment"
sudo tailscale up --auth-key="file:${TAILSCALE_BOOTSTRAP_KEY_FILE}"
```

Remove the bootstrap file or secret attachment after enrollment succeeds. Do not
put key values in cloud-init user data, shell history, process arguments, Git,
or agent chat. The [`file:` syntax](https://tailscale.com/docs/reference/tailscale-cli/up)
keeps the key value out of the command line.

An access tag replaces user-owned device identity, so review any user-specific
Tailscale access when repurposing an existing machine. For an unattended server,
the administrator must verify that device key expiry is disabled. New tagged
enrollment defaults to disabled expiry; tagging an existing device does not
necessarily change its expiry setting. The enrollment auth key and device key
have separate lifetimes: expiry of the used bootstrap key does not sign out an
already authorized device. See [auth key lifecycle](https://tailscale.com/docs/features/access-control/auth-keys).

On the host, verify `tailscale status` reports a connected device, and check
device approval, the selected tag, and key-expiry settings in the admin console.
Keep Tailscale's device state persistent across reboots or container restarts.

### 3. Configure Kubernetes as the agent's OS user

Run in the agent account's environment:

```sh
command -v tailscale kubectl
tailscale status
tailscale configure kubeconfig tailscale-operator
kubectl config current-context
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}{"\n"}'
kubectl auth whoami
kubectl get nodes
```

The CLI discovers the proxy's MagicDNS name; a full FQDN can also be supplied.
The selected server must be `https://tailscale-operator.<tailnet-DNS-suffix>`.
The resulting kubeconfig contains no Kubernetes client private key or usable bearer
credential. The generated `token: unused` is a placeholder, not a secret.
The host's Tailscale daemon and device authorization supply authentication,
so no Kubernetes certificate renewal job or OS-specific scheduler is needed.
Each device retains its own tailnet identity and can be revoked independently.

The default file is `~/.kube/config` for that account. Check any `KUBECONFIG`
override in the agent service before assuming it uses this file. Preserve
unrelated contexts and keep private direct-LAN recovery credentials separate.
If an existing checkout has an ignored `kubeconfig`, inspect its context too:
Make prefers that file unless an explicit `KUBECONFIG` overrides it.

### 4. Give the agent its repository and execution environment

For an agent that works on IaC, clone the public repository under its own account:

```sh
mkdir -p "$HOME/Code"
git clone https://github.com/khzaw/rangoonpulse.git "$HOME/Code/rangoonpulse"
cd "$HOME/Code/rangoonpulse"
```

Have it read `AGENTS.md` before making changes. A fresh clone uses the host's
default kubeconfig without creating a repo-local credential file. GitHub write
access is a separate setup step; use [credential ownership and permissions](./github-credentials.md)
before provisioning another credential.

Configure the agent service with the intended home directory and tool `PATH`.
All local agents using that account can read the same kubeconfig. Containers or
remote execution backends need the configuration and their own working network
path; their effective identity is the tailnet device carrying their requests.
Confirm Hermes's terminal backend or OpenClaw's exec host/sandbox matches the
intended location. Tool execution approvals remain agent configuration, separate
from Kubernetes authorization.

Run the following through the actual agent terminal/exec tool as well as the
provisioning shell:

```sh
id -un
command -v tailscale kubectl
kubectl config current-context
kubectl auth whoami
kubectl get nodes
```

If Flux is installed, also run `flux get kustomizations -A`. At the next planned
restart, confirm both Tailscale and the agent service return with the same access.

## Verification and revocation

Check the real host through the proxy, including the agent execution environment:

```sh
kubectl auth whoami
kubectl auth can-i get nodes
kubectl auth can-i get pods/log -n flux-system
kubectl auth can-i get secrets -A
kubectl auth can-i create pods/exec -n default
kubectl auth can-i patch deployments.apps -n default
```

Both profiles must allow node inventory and pod logs. Observers must be denied
the last three capabilities; operators are allowed. `can-i` prints `no` and exits
with status 1 for an expected denial, so an observer check is not a failed setup
merely because those commands return nonzero.

Provisioning is complete when the caller is the device FQDN, its group matches
the selected access tag, the expected allowed and denied checks pass, and the
agent itself can list nodes. The caller must not have `system:masters`. An
unassigned identity must be denied node listing. Granting another profile means
changing the authorized device tag, not editing the client's kubeconfig.

### Troubleshooting

| Symptom | Check and correction |
| --- | --- |
| `Forbidden` | Check `kubectl auth whoami`, the assigned tag, and the Git-managed bindings. Observer write denials are expected. Do not replace working authentication to fix an RBAC decision. |
| `Unauthorized` or an expired certificate | Inspect the selected server/context, `KUBECONFIG`, and any ignored repository kubeconfig. The normal agent context uses the tailnet proxy rather than a copied administrator certificate. |
| Wrong username or missing tag group | Check device tags and application grants that override Kubernetes groups. User-owned devices authenticate as the tailnet user until tagged. |
| Timeout, DNS failure, or TLS `EOF` | Check Tailscale is running, the proxy peer is online, HTTPS/network policy, and operator logs. First-use certificate issuance can take time; retry after checking the proxy. Keep certificate verification enabled. |
| Works over SSH but fails in the bot | Compare the actual tool's user, `HOME`, `PATH`, `KUBECONFIG`, sandbox, and terminal backend. A remote sandbox does not inherit the provisioning shell's kubeconfig or network identity. |

### Revocation and replacement

To revoke one host, remove the device from the tailnet, or remove its access tags
while retaining an approved non-access device identity. To downgrade an operator,
replace its operator tag with the observer tag; adding the observer tag while
keeping the operator tag does not reduce permissions. To revoke an entire
profile, remove its Git-managed ClusterRoleBindings and reconcile the operator
Kustomization. Revocation affects subsequent API requests; terminate existing
interactive sessions separately when required.

Provision a replacement VM as a new device and revoke the retired entry. Keep
each host's Tailscale state private and unique; cloned VM images must not reuse
an enrolled device's state directory.

## Talos and recovery

Kubernetes RBAC does not authenticate Talos. Talos uses its own client
certificates and roles over the node API. Use `os:reader` for node-level
diagnostics and issue `os:admin` only for explicitly trusted node operators.
Do not distribute Talos administrator credentials merely to onboard a cloud
Kubernetes agent. Talos certificate expiry remains an independent lifecycle.

When a host is assigned a Talos investigation, an existing Talos administrator
can issue a bounded reader credential. Set `CONTROL_PLANE_IP` from
`flux/cluster-settings.yaml` and run on the existing administrator host:

```sh
umask 077
mkdir -p "$HOME/.config/rangoonpulse/private"
TALOS_READER_CONFIG="$HOME/.config/rangoonpulse/private/agent-reader.talosconfig"
talosctl -e "$CONTROL_PLANE_IP" -n "$CONTROL_PLANE_IP" config new "$TALOS_READER_CONFIG" --roles=os:reader --crt-ttl=24h
```

Transfer the generated file through a private secret channel to the intended
host/account at the same home-relative path, owned by the agent account with
mode 0600. Do not put it in the repository or chat. Give that host a network
path to the Talos node API; the Kubernetes auth proxy does not forward Talos
requests. Remote clients may need the existing advertised node routes described
in [LAN access](./lan-access.md). Use a checksum-verified `talosctl` compatible
with the installed Talos release. On the recipient, select the transferred file
with `TALOSCONFIG`, and set `NODE_IP` to the investigation target:

```sh
export TALOSCONFIG="$HOME/.config/rangoonpulse/private/agent-reader.talosconfig"
talosctl config info
talosctl -e "$CONTROL_PLANE_IP" -n "$NODE_IP" version --short
talosctl -e "$CONTROL_PLANE_IP" -n "$NODE_IP" logs kubelet --tail=50
```

Confirm `config info` reports `os:reader` and the intended expiry before use.
Reissue the bounded credential when needed. Node upgrades or machine-config
changes require an explicitly assigned Talos administrator identity; a Kubernetes
operator tag does not grant it.

The auth proxy shares the Tailscale operator's lifecycle. A proxy, tailnet, or
cluster outage can prevent this access even when the underlying nodes are up.
Maintain private direct-LAN operator/Talos recovery credentials separately from
the default agent kubeconfig; see [Kubernetes upgrades](./kubernetes-upgrade.md).
The native sentinel retains its independent health-only identity and direct LAN
API check, as described in [native operations](./iris-operations.md).

Reference: [Tailscale API proxy RBAC](https://tailscale.com/docs/kubernetes-operator/api-server-access/auth-and-rbac).
