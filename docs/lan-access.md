---
title: LAN and Tailscale Access
summary: Current private access contract for ingress services, LAN-device proxies, and the Mac mini edge.
status: active
owner: homelab
last_reviewed: 2026-11-16
---

# LAN and Tailscale Access

## Contract

Private `*.khzaw.dev` services resolve to the shared ingress VIP and are reachable from the LAN or through the Tailscale subnet router. Tailscale clients use the same destination IPs as LAN clients; there is no separate Tailscale ingress proxy.

The active Connector is `infrastructure/tailscale-subnet-router/connector.yaml`. It advertises narrow `/32` routes for the router, both Talos nodes, NAS, shared ingress VIP, Mac mini edge VIP, and both AdGuard DNS VIPs, and also acts as an exit node.

`infrastructure/tailscale-dns-backup/` provides an independent Connector on the
primary node, advertising only the two AdGuard DNS `/32` routes. Its ProxyClass
disables accepting subnet routes and reserves 100m CPU and 128Mi memory, with a
256Mi memory limit. It has its own Flux rollout boundary. General LAN routing
and exit-node service remain on the original Connector.

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

Remote Tailscale clients can reach AdGuard at `${ADGUARD_PRIMARY_IP}` and
`${ADGUARD_SECONDARY_IP}` through the Connector's `/32` routes. The routes must
be approved on both Connectors in the tailnet and network policy must allow
TCP/UDP port `53`. Both routers must advertise the same exact DNS `/32` prefixes
for automatic route failover. Keep route acceptance disabled on the backup so
it reaches the LAN directly rather than through its peer.
Advertising these routes provides reachability; selecting AdGuard as a tailnet
nameserver and enabling client DNS settings are separate configuration steps.
With AdGuard configured as the tailnet's global nameservers and DNS override
enabled, clients can opt in or out using **Use Tailscale DNS Settings** while
remaining connected to the tailnet. Without an exit node, opting out uses the
client's local network DNS. Exit-node DNS is a separate policy; enable **Use with
exit node** on the nameservers when AdGuard should also serve exit-node clients.

Permanent-public Tunnel hostnames are different: they should resolve to Cloudflare edge addresses, not RFC1918 addresses.

## Verification

```bash
kubectl get connector homelab-subnet-router -o yaml
kubectl get connector homelab-dns-backup -o yaml
kubectl get svc,endpoints,ingress -n default
kubectl get svc -n ingress-nginx

dig @10.0.0.233 +short <private-host>
dig @10.0.0.234 +short <private-host>
curl -Ik --resolve <private-host>:443:10.0.0.231 https://<private-host>/
```

For the dedicated edge, resolve against `10.0.0.235` instead of the shared ingress VIP.
