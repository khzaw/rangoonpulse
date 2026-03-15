# Shared Cluster Settings

## Purpose

This repository now keeps cluster-wide non-secret constants in one GitOps-managed place:

- `/Users/khz/Code/rangoonpulse/flux/cluster-settings.yaml`

The goal is to avoid redeclaring the same base domain, node names, node IPs, ingress VIP, and similar values across
many manifests.

## Source Of Truth

- Git file: `flux/cluster-settings.yaml`
- In-cluster object: `ConfigMap/flux-system/cluster-settings`

Current keys:
- `BASE_DOMAIN`
- `TIMEZONE`
- `PRIMARY_NODE_NAME`
- `UTILITY_NODE_NAME`
- `PRIMARY_NODE_IP`
- `UTILITY_NODE_IP`
- `INGRESS_VIP`
- `NAS_IP`
- `ROUTER_IP`
- `ADGUARD_PRIMARY_IP`
- `ADGUARD_SECONDARY_IP`
- `LAN_CIDR`
- `POD_CIDR`
- `SERVICE_CIDR`

## How Manifests Consume It

Flux child `Kustomization` objects now use:

```yaml
postBuild:
  substituteFrom:
    - kind: ConfigMap
      name: cluster-settings
```

This means Flux substitutes `${VAR}` placeholders in rendered manifests using the values from
`ConfigMap/flux-system/cluster-settings`.

Examples:
- `${BASE_DOMAIN}`
- `${TIMEZONE}`
- `${PRIMARY_NODE_NAME}`
- `${INGRESS_VIP}`

## Important Escaping Rule

Some app configs intentionally need literal `${...}` at runtime:
- Glance secret placeholders such as `${JELLYFIN_API_KEY}`
- shell/runtime placeholders such as `${TRACERR_DB_PASSWORD}`
- JavaScript template literals inside `apps/exposure-control/server.js`

Because Flux post-build substitution would otherwise consume those, keep them escaped in repo source as:

```text
$${VAR}
```

Flux renders `$${VAR}` back to literal `${VAR}` in the applied manifest.

Files that already rely on this pattern:
- `apps/exposure-control/server.js`
- `apps/glance/helmrelease.yaml`
- `apps/media-postgres/helmrelease.yaml`

## Scope Rules

Good candidates for `cluster-settings`:
- base domain and shared hostname suffixes
- timezone
- node names used in selectors and dashboards
- stable LAN IPs and shared CIDRs
- ingress VIP and LAN-service IPs

Do not put these in `cluster-settings`:
- secrets or credentials
- controller-owned runtime state
- app-local feature flags or chart-only settings
- internal identifier strings that only happen to contain the current domain

Intentional example that stays literal today:
- `khzaw.dev/transmission-egress-mode` in `apps/transmission/transmission-vpn-control.yaml`

That key is acting as an internal annotation namespace, not a public hostname.

## Non-Flux Files

Some repo files are not rendered by Flux:
- `Makefile`
- `talos/*.yaml`
- tests and local helper scripts

Current handling:
- `Makefile` reads node IPs directly from `flux/cluster-settings.yaml`.
- Talos machine configs remain explicit today and must still be updated manually if node IPs or control-plane endpoint
  values change.

Talos was intentionally left out of the first centralization pass to avoid changing how machine configs are consumed.

## Validation

When changing shared settings:

```bash
kubectl apply --dry-run=client -f flux/cluster-settings.yaml
kubectl kustomize flux | kubectl apply --dry-run=client -f -
flux reconcile kustomization flux-system -n flux-system --with-source
flux get kustomizations -n flux-system
```

For a specific child path, verify the rendered output before pushing:

```bash
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux build kustomization <name> \
  --path <local-path> \
  --kustomization-file flux/kustomizations/<name>.yaml \
  --local-sources GitRepository/flux-system/flux-system=.
```

## Operational Notes

- A shared-settings refactor should be rendered-equivalent before you change actual values. Prefer:
  1. add the variable reference,
  2. verify rendered output is unchanged,
  3. only later change the value in `flux/cluster-settings.yaml`.
- If a change is expected to be no-op but Helm still rolls a pod, verify readiness and logs before proceeding.
