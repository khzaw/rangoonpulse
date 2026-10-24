---
title: LAN and Tailscale Access
summary: Current private access contract for ingress services, LAN-device proxies, and the Mac mini edge.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# LAN and Tailscale Access

## Contract

Private `*.khzaw.dev` services resolve to the shared ingress VIP and are reachable from the LAN or through the Tailscale subnet router. Tailscale clients use the same destination IPs as LAN clients; there is no separate Tailscale ingress proxy.

The active Connector is `infrastructure/tailscale-subnet-router/connector.yaml`. It advertises narrow `/32` routes for the router, both Talos nodes, NAS, shared ingress VIP, and Mac mini edge VIP, and also acts as an exit node.

## LAN Devices Behind Ingress

`infrastructure/lan-gateway/` exposes NAS and router web interfaces through selectorless Services and static Endpoints. ingress-nginx terminates TLS and forwards to the LAN targets.

This pattern is intentional because the backends are not Kubernetes pods. Keep the Service port, Endpoint port, backend protocol, and redirect behavior aligned.

## Mac Mini Edge

`infrastructure/iris-edge/` owns the dedicated edge:

- `${IRIS_VIP}:443` reaches ingress-nginx and uses host routing:
  - `iris.khzaw.dev` -> `${IRIS_MAC_MINI_IP}:18789` for OpenClaw
  - `athena.khzaw.dev` -> `${IRIS_MAC_MINI_IP}:9119` for Hermes
- `${IRIS_VIP}:22` forwards directly to `${IRIS_MAC_MINI_IP}:22`

DNS ownership for `iris.khzaw.dev` and `athena.khzaw.dev` lives on the dedicated ingress LoadBalancer Service, not on the Ingress objects. Keep `${IRIS_VIP}/32` in the Tailscale Connector.

OpenClaw and Hermes authentication are host-side concerns. A successful ingress response does not prove token, device-pairing, or allowed-origin configuration is correct.

## DNS

LAN clients should use the two AdGuard LoadBalancer IPs published by the router's DHCP configuration. Private records may be rejected by client/router DNS-rebind protection; prefer a scoped `khzaw.dev` exception over disabling rebind protection globally.

Permanent-public Tunnel hostnames are different: they should resolve to Cloudflare edge addresses, not RFC1918 addresses.

## Verification

```bash
kubectl get connector homelab-subnet-router -o yaml
kubectl get svc,endpoints,ingress -n default
kubectl get svc -n ingress-nginx

dig @10.0.0.233 +short <private-host>
dig @10.0.0.234 +short <private-host>
curl -Ik --resolve <private-host>:443:10.0.0.231 https://<private-host>/
```

For the dedicated edge, resolve against `10.0.0.235` instead of the shared ingress VIP.
