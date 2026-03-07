# Transmission Optional VPN Toggle

Transmission can now run in either:
- `direct` mode: normal pod networking, current default behavior
- `vpn` mode: `gluetun` WireGuard sidecar enabled in the same pod

The mode is switched from `https://controlpanel.khzaw.dev` or the control panel API.

## GitOps vs Runtime State

Git-managed files:
- `apps/transmission/helmrelease.yaml`
- `apps/transmission/transmission-vpn-control.yaml`
- `infrastructure/secrets/default/transmission-vpn-secret.yaml`

Runtime-owned state:
- `ConfigMap/default/transmission-vpn-state`
  - key `mode`: `direct` or `vpn`
  - key `values.yaml`: Helm values overlay consumed by Flux `HelmRelease/transmission`

Important:
- `transmission-vpn-state` is operational state and should not be committed or reconciled by Flux.
- Flux watches that ConfigMap via label `reconcile.fluxcd.io/watch: Enabled`, so control panel changes should trigger a near-immediate Helm reconcile.

## Default Behavior

- Current default seed mode is `direct`.
- Change `data.default-mode` in `apps/transmission/transmission-vpn-control.yaml` if you want a new cluster/bootstrap default.
- Existing runtime state is not overwritten by changing the default; use the control panel or delete `ConfigMap/default/transmission-vpn-state` to re-seed.

## Provider Scaffold

Current scaffold assumes:
- `gluetun`
- `VPN_SERVICE_PROVIDER=custom`
- `VPN_TYPE=wireguard`

Placeholders to replace before real VPN use:
- non-secret endpoint/public data in `apps/transmission/helmrelease.yaml`
  - `WIREGUARD_ENDPOINT_IP`
  - `WIREGUARD_ENDPOINT_PORT`
  - `WIREGUARD_PUBLIC_KEY`
  - `WIREGUARD_ADDRESSES`
- secret material in `infrastructure/secrets/default/transmission-vpn-secret.yaml`
  - `WIREGUARD_PRIVATE_KEY`
  - `WIREGUARD_PRESHARED_KEY` (only if required by provider)

## Control Panel API

```bash
curl -s https://controlpanel.khzaw.dev/api/transmission-vpn | jq

curl -s -X POST https://controlpanel.khzaw.dev/api/transmission-vpn \
  -H 'content-type: application/json' \
  -d '{"mode":"vpn"}' | jq

curl -s -X POST https://controlpanel.khzaw.dev/api/transmission-vpn \
  -H 'content-type: application/json' \
  -d '{"mode":"direct"}' | jq
```

## Troubleshooting

```bash
kubectl get configmap -n default transmission-vpn-control transmission-vpn-state -o yaml
kubectl get pods -n default -l app.kubernetes.io/instance=transmission -o wide
kubectl logs -n default deploy/transmission -c gluetun --tail=200
kubectl describe hr -n default transmission
flux reconcile kustomization transmission -n flux-system --with-source
```

Expected signals:
- `desiredMode` from the API reflects the control panel selection.
- `effectiveMode` flips to `vpn` once the running Transmission pod includes container `gluetun`.
- `khzaw.dev/transmission-egress-mode` pod annotation should match the selected mode.

## Networking Notes

- `vpn` mode changes pod DNS to `127.0.0.1` so Transmission uses the sidecar DNS path instead of cluster DNS.
- `gluetun` allows local inbound ports `9091` and `51413`.
- `FIREWALL_OUTBOUND_SUBNETS` currently allows cluster and LAN ranges used by this cluster:
  - `10.96.0.0/12`
  - `10.244.0.0/16`
  - `10.0.0.0/24`

If cluster CIDRs or LAN ranges change, update those values in `apps/transmission/helmrelease.yaml`.
