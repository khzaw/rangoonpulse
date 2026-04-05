# Iris Dedicated VIP

## Purpose

Document the dedicated-VIP exception for `iris.khzaw.dev`.

Unlike ordinary private app hostnames in this cluster, `iris.khzaw.dev` must support both:

- `https://iris.khzaw.dev` for the OpenClaw Control UI
- `ssh iris@iris.khzaw.dev` for direct host management

That requirement means `iris.khzaw.dev` cannot share the ordinary ingress VIP with every other hostname, because SSH
does not route by HTTP host headers.

## Current Model

- Dedicated VIP: `10.0.0.235`
- Backend host: Mac mini `10.0.0.66`
- OpenClaw UI backend: `10.0.0.66:18789`
- SSH backend: `10.0.0.66:22`

GitOps source of truth:

- `infrastructure/iris-edge/`
- `flux/kustomizations/iris-edge.yaml`
- `infrastructure/tailscale-subnet-router/connector.yaml`
- `flux/cluster-settings.yaml`

## Traffic Layout

### Web

```mermaid
flowchart LR
  A["Browser"] --> B["DNS: iris.khzaw.dev -> 10.0.0.235"]
  B --> C["MetalLB VIP 10.0.0.235:443"]
  C --> D["Service/ingress-nginx-iris-controller"]
  D --> E["ingress-nginx controller"]
  E --> F["Ingress lan-gateway-iris"]
  F --> G["Service/Endpoints iris-openclaw-lan"]
  G --> H["Mac mini 10.0.0.66:18789"]
```

### SSH

```mermaid
flowchart LR
  A["SSH client"] --> B["DNS: iris.khzaw.dev -> 10.0.0.235"]
  B --> C["MetalLB VIP 10.0.0.235:22"]
  C --> D["Service/Endpoints iris-ssh-edge"]
  D --> E["Mac mini 10.0.0.66:22"]
```

## Why This Is An Exception

Most private hostnames in this cluster resolve to the shared ingress VIP `10.0.0.231` and rely on hostname-based HTTP
routing. That works for web traffic only.

`iris.khzaw.dev` is different because:

- the same hostname must terminate HTTPS and SSH,
- SSH needs a unique destination IP on port `22`,
- remote Tailscale clients still need the same destination IP as LAN clients.

The dedicated VIP avoids per-client SSH config while preserving the normal browser hostname.

## DNS Ownership

DNS for `iris.khzaw.dev` is intentionally owned by the dedicated LoadBalancer Service:

- `Service/ingress-nginx-iris-controller` carries the `external-dns` hostname annotation

The `Ingress/lan-gateway-iris` does **not** carry an `external-dns` hostname annotation. That prevents a conflicting
record target back to the shared ingress VIP.

## Tailscale

Remote tailnet clients reach `iris.khzaw.dev` through subnet routing to the dedicated VIP:

- `10.0.0.235/32` is advertised by `Connector/homelab-subnet-router`

This keeps the outside-Tailscale and inside-LAN destination identical.

## OpenClaw Host Settings

The Mac mini remains a private backend. OpenClaw itself should stay in the simple backend role:

- `gateway.bind = "lan"`
- `gateway.tailscale.mode = "off"`
- `gateway.controlUi.allowedOrigins` includes `https://iris.khzaw.dev`

OpenClaw does not need to own the certificate or the public hostname edge.

## Operational Notes

- `IRIS_MAC_MINI_IP` must stay stable; use a DHCP reservation.
- `IRIS_VIP` must stay unique in the MetalLB pool and must not overlap existing LoadBalancer Services.
- If `iris.khzaw.dev` web breaks, check:
  - DNS answer for `iris.khzaw.dev`
  - `Service/ingress-nginx-iris-controller`
  - `Ingress/lan-gateway-iris`
  - `Service/Endpoints iris-openclaw-lan`
  - Mac mini reachability on `10.0.0.66:18789`
- If SSH breaks but web works, check:
  - `Service/Endpoints iris-ssh-edge`
  - Mac mini `sshd`
  - Tailscale route advertisement for `10.0.0.235/32`
