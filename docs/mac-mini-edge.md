---
title: Mac Mini Dedicated Edge
summary: Current Iris OpenClaw, Athena Hermes, SSH, VIP announcement and failover, DNS ownership, and host-authentication boundary.
status: active
owner: homelab
last_reviewed: 2026-11-23
---

# Mac Mini Dedicated Edge

`infrastructure/iris-edge/` exposes services hosted on the Mac mini through a dedicated MetalLB VIP.

## Current Paths

- `iris.khzaw.dev` -> ingress HTTPS -> OpenClaw at `${IRIS_MAC_MINI_IP}:18789`
- `athena.khzaw.dev` -> ingress HTTPS -> Hermes at `${IRIS_MAC_MINI_IP}:9119`
- `${IRIS_VIP}:22` -> Mac mini SSH at `${IRIS_MAC_MINI_IP}:22`

The two HTTPS hosts use ingress host routing on the same VIP. SSH uses a separate LoadBalancer Service that shares the VIP.

## Announcement And Failover

Two LoadBalancer Services share `${IRIS_VIP}` through `metallb.io/allow-shared-ip`:
`ingress-nginx/ingress-nginx-iris-controller` (80/443) and the selectorless
`default/iris-ssh-edge` (22). MetalLB only shares an address between Services that
both use `externalTrafficPolicy: Cluster`, or both use `Local` with identical pod
selectors. The SSH Service has no pods, so both Services stay `Cluster`, and both
nodes are eligible to announce. `default-l2` prefers the primary, which also runs
the pinned ingress-nginx controller. See
[networking](./networking.md#private-services) for the election rule.

- Primary up: the primary answers ARP. Web traffic enters on the controller's node,
  and SSH is forwarded from the primary to `${IRIS_MAC_MINI_IP}:22`.
- Primary down: the utility node announces the address, and SSH keeps working
  through it. Web ingress is down because the controller stays Pending until the
  primary returns.
- Primary back: the announcement returns to the primary.

Each move resets TCP sessions through the VIP, including SSH and long-lived
OpenClaw or Hermes connections, because kube-proxy NAT state belongs to the node
that forwarded them. A restart of the primary's MetalLB speaker moves the address
away and back.

The ARP owner does not affect tailnet clients. The Tailscale Connector runs on the
utility node, and kube-proxy there forwards its traffic for `${IRIS_VIP}` directly.

## DNS Ownership

ExternalDNS annotations live on the dedicated ingress LoadBalancer Service. Do not add competing DNS ownership to the Ingress objects or point these hosts at the shared ingress VIP.

Keep `${IRIS_VIP}/32` in the Tailscale Connector so remote tailnet clients can reach the edge.

## Repository Boundary

Kubernetes owns routing to the Mac mini. OpenClaw and Hermes remain responsible for host-side process availability, tokens, device approval, session policy, and allowed origins.

[Iris native operations](./iris-operations.md) owns launchd supervision, private host metrics/readiness, and the independent cluster sentinel. A network-route change does not install or reconfigure those host processes.

A working TLS/ingress path does not prove application authentication is correct. Diagnose in order:

1. DNS to the dedicated VIP
2. MetalLB and Service reachability
3. Ingress host routing and Endpoint target
4. Mac mini process/listener
5. application token, pairing, and origin policy

## OpenClaw Proxy Attribution

The host-side `gateway.trustedProxies` must contain both exact cluster node
addresses (`PRIMARY_NODE_IP` and `UTILITY_NODE_IP` in `flux/cluster-settings.yaml`).
Ingress traffic to the external Mac mini endpoint is source-NATed to the node
running ingress-nginx, so trusting only one node breaks access when the controller
moves. Keep this list aligned with node address changes; do not trust the entire
LAN or pod CIDR.

Keep ingress-nginx's `use-forwarded-headers` and `compute-full-forwarded-for`
disabled so it overwrites `X-Forwarded-For` and `X-Real-IP` with the observed client
address. Proxy trust supplies client attribution; OpenClaw token authentication,
device pairing, and allowed origins still apply.

An HTTP `403` with `proxy_attribution_required` indicates the request reached
OpenClaw but failed this attribution check. Compare the source in the native
gateway log with the trusted proxy list and the controller's current node.

## Verification

Both edge Services should show the primary in `servicel2statuses`. On a LAN host,
the ARP entry for `10.0.0.235` should carry the primary's MAC, the same MAC as the
shared ingress VIP `10.0.0.231`.

```bash
kubectl get svc,ingress,endpoints -n default | grep -E 'iris|hermes|athena'
kubectl -n metallb-system get servicel2statuses
arp -n 10.0.0.235; arp -n 10.0.0.231
kubectl get connector homelab-subnet-router -o yaml
dig @1.1.1.1 +short iris.khzaw.dev
dig @1.1.1.1 +short athena.khzaw.dev
curl -Ik --resolve iris.khzaw.dev:443:10.0.0.235 https://iris.khzaw.dev/
curl -Ik --resolve athena.khzaw.dev:443:10.0.0.235 https://athena.khzaw.dev/
```
