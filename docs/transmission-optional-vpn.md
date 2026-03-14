# Transmission Optional VPN Toggle

Transmission can now run in either:
- `direct` mode: normal pod networking, current default behavior
- `vpn` mode: `gluetun` WireGuard sidecar enabled in the same pod

The mode is switched from `https://controlpanel.khzaw.dev` or the control panel API.
The Gluetun sidecar is monitored and controlled through `https://torrent-vpn.khzaw.dev`.

## What You Actually Need

Plain-English answer:

- If you leave Transmission in `direct` mode, you do **not** need to buy anything. The app already works without a VPN.
- If you want Transmission to actually route through a VPN, you need **one real VPN endpoint**. In practice that means one of:
  - a VPN subscription that supports `WireGuard` and gives you usable WireGuard credentials/profile details
  - your own WireGuard server/VPS that you manage
- Gluetun, the control panel toggle, and the Gluetun WebUI are already deployed in the cluster. Those pieces are **not** the missing part.
- The missing part is the **real provider/server credentials** that replace the placeholder values in this repo.
- A provider that only gives you its own desktop/mobile app, but not WireGuard connection details, is **not enough** for the current setup.

### Minimum Inputs Required for `vpn` Mode to Really Work

You need a real WireGuard profile or provider settings that give you:

- VPN server endpoint host or IP
- VPN server port
- server public key
- client private key
- client tunnel address(es)
- optional preshared key if your provider uses one

Without those values:

- you can still turn `vpn` mode on in the control panel
- the `gluetun` container can start
- but it will **not** connect to a real VPN successfully because the repo still contains placeholder endpoint/key values

### Current Repo Status

Right now this repo is in a **scaffolded but not fully activated** state:

- `direct` mode is the safe working default
- `vpn` mode wiring exists
- Gluetun auth/UI wiring exists
- the actual VPN provider details are still placeholders

So the answer to "what do I need to have it up and running?" is:

1. Nothing else, if you only want normal non-VPN Transmission.
2. A real WireGuard-capable VPN provider or your own WireGuard endpoint, if you want actual VPN routing.

## GitOps vs Runtime State

Git-managed files:
- `apps/transmission/helmrelease.yaml`
- `apps/transmission/transmission-vpn-control.yaml`
- `apps/transmission/vpn-ui-service.yaml`
- `apps/transmission/vpn-ui-ingress.yaml`
- `infrastructure/secrets/default/transmission-gluetun-control-secret.yaml`
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
- `gluetun-webui`
- `VPN_SERVICE_PROVIDER=custom`
- `VPN_TYPE=wireguard`
- Gluetun HTTP control server on `127.0.0.1:8000` with API-key auth
- placeholder WireGuard endpoint/profile values in the HelmRelease

Placeholders to replace before real VPN use:
- non-secret endpoint/public data in `apps/transmission/helmrelease.yaml`
  - `WIREGUARD_ENDPOINT_IP`
  - `WIREGUARD_ENDPOINT_PORT`
  - `WIREGUARD_PUBLIC_KEY`
  - `WIREGUARD_ADDRESSES`
- secret material in `infrastructure/secrets/default/transmission-vpn-secret.yaml`
  - `WIREGUARD_PRIVATE_KEY`
  - `WIREGUARD_PRESHARED_KEY` (only if required by provider)

## What You Do Not Need

- You do **not** need to deploy another Kubernetes app for the VPN toggle. That part already exists.
- You do **not** need another WebUI; `https://torrent-vpn.khzaw.dev` is already deployed.
- You do **not** need a VPN subscription if you are happy with `direct` mode.
- You do **not** need to change Cloudflare, the control panel host, or the WebUI host just to activate a real VPN provider.
- You do **not** need to store plaintext VPN credentials in Git; use the SOPS secret already in this repo.

## Gluetun WebUI

- Hostname: `https://torrent-vpn.khzaw.dev`
- Container wiring:
  - `gluetun-webui` is always present in the Transmission pod
  - it calls Gluetun on `http://127.0.0.1:8000`
  - Gluetun control-server auth is configured from `infrastructure/secrets/default/transmission-gluetun-control-secret.yaml`
- In `direct` mode, the WebUI still loads but will report that the Gluetun control API is unreachable because the `gluetun` container is intentionally absent.
- In `vpn` mode, the WebUI can start/stop the Gluetun VPN process without changing the desired pod mode.

Operational distinction:
- control panel (`controlpanel.khzaw.dev`)
  - chooses `direct` vs `vpn` pod shape for Transmission
- Gluetun WebUI (`torrent-vpn.khzaw.dev`)
  - inspects the running Gluetun sidecar and can pause/resume the VPN process only when `vpn` mode is already active

## After You Buy a VPN Subscription

Choose one of these setup paths:
- provider-native `gluetun` mode
  - preferred when `gluetun` already supports the provider directly
  - better when the provider rotates endpoints or uses provider-specific auth fields
- current `custom` WireGuard mode
  - use this when the provider gives you a raw WireGuard config and you only need a single endpoint/profile

Recommended approach:
1. Pick a provider that supports `WireGuard`.
2. Keep Transmission in `direct` mode until credentials are in place.
3. Decide whether the provider should stay on `custom` or be switched to provider-native config.
4. Update secrets with `sops`.
5. Update non-secret provider values in the HelmRelease.
6. Reconcile `secrets` and `transmission`.
7. Turn on VPN mode from `controlpanel.khzaw.dev`.

### Fast Checklist

Use this checklist before switching to `vpn` mode:

- I have a VPN subscription or my own WireGuard server.
- I have the endpoint host/IP and port.
- I have the server public key.
- I have the client private key.
- I have the client tunnel address.
- I have updated the SOPS secret for private material.
- I have updated the HelmRelease for public endpoint/public-key values.
- I have reconciled `secrets` and `transmission`.

If any of those are missing, stay on `direct` mode.

### If Staying on the Current `custom` WireGuard Scaffold

Edit the secret with `sops`:

```bash
sops /Users/khz/Code/rangoonpulse/infrastructure/secrets/default/transmission-vpn-secret.yaml
```

Set these secret values in `infrastructure/secrets/default/transmission-vpn-secret.yaml`:
- `WIREGUARD_PRIVATE_KEY`
- `WIREGUARD_PRESHARED_KEY` only if your provider gives one

Then update `apps/transmission/helmrelease.yaml` with the provider's non-secret values:
- `WIREGUARD_ENDPOINT_IP`
- `WIREGUARD_ENDPOINT_PORT`
- `WIREGUARD_PUBLIC_KEY`
- `WIREGUARD_ADDRESSES`

Typical mapping from a provider WireGuard profile:
- `PrivateKey` -> `WIREGUARD_PRIVATE_KEY`
- `PresharedKey` -> `WIREGUARD_PRESHARED_KEY`
- `Address` -> `WIREGUARD_ADDRESSES`
- `Peer PublicKey` -> `WIREGUARD_PUBLIC_KEY`
- `Endpoint` host:port -> `WIREGUARD_ENDPOINT_IP` and `WIREGUARD_ENDPOINT_PORT`

### If Switching to a Provider-Native `gluetun` Config

Update `apps/transmission/helmrelease.yaml` so `gluetun` no longer uses:
- `VPN_SERVICE_PROVIDER=custom`
- raw `WIREGUARD_*` endpoint/public-key fields intended for the custom profile

Instead, configure the provider-specific environment variables required by `gluetun` for that provider.

Use this path when:
- the provider is directly supported by `gluetun`
- the provider gives hostnames instead of a stable endpoint IP
- the provider uses credentials/tokens rather than a simple WireGuard profile
- you want provider-specific features such as built-in server selection or better port-forward integration

### Reconcile and Verify

```bash
flux reconcile kustomization secrets -n flux-system --with-source
flux reconcile kustomization transmission -n flux-system --with-source
kubectl logs -n default deploy/transmission -c gluetun --tail=200
curl -I --max-time 20 https://torrent-vpn.khzaw.dev
```

After the configuration is in place, enable VPN mode:
- control panel: `https://controlpanel.khzaw.dev`
- or API:

```bash
curl -s -X POST https://controlpanel.khzaw.dev/api/transmission-vpn \
  -H 'content-type: application/json' \
  -d '{"mode":"vpn"}' | jq
```

### Decision Notes

Stay on `custom` when:
- you have a plain WireGuard profile
- the endpoint IP is stable
- you want the smallest manifest change

Refactor to provider-native config when:
- the provider is already supported by `gluetun`
- the provider gives a hostname endpoint that may rotate
- the provider needs provider-specific auth variables
- you want me to model port-forwarding or region/server selection cleanly

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
kubectl logs -n default deploy/transmission -c gluetun-webui --tail=200
kubectl describe hr -n default transmission
flux reconcile kustomization transmission -n flux-system --with-source
```

Expected signals:
- `desiredMode` from the API reflects the control panel selection.
- `effectiveMode` flips to `vpn` once the running Transmission pod includes container `gluetun`.
- `khzaw.dev/transmission-egress-mode` pod annotation should match the selected mode.
- `https://torrent-vpn.khzaw.dev` returns `200` and `/api/health` returns healthy when the WebUI container is up.

## Networking Notes

- `vpn` mode changes pod DNS to `127.0.0.1` so Transmission uses the sidecar DNS path instead of cluster DNS.
- `gluetun` allows local inbound ports `9091` and `51413`.
- `FIREWALL_OUTBOUND_SUBNETS` currently allows cluster and LAN ranges used by this cluster:
  - `10.96.0.0/12`
  - `10.244.0.0/16`
  - `10.0.0.0/24`

If cluster CIDRs or LAN ranges change, update those values in `apps/transmission/helmrelease.yaml`.
