---
title: Mac Mini Dedicated Edge
summary: Current Iris OpenClaw, Athena Hermes, SSH, DNS ownership, and host-authentication boundary.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Mac Mini Dedicated Edge

`infrastructure/iris-edge/` exposes services hosted on the Mac mini through a dedicated MetalLB VIP.

## Current Paths

- `iris.khzaw.dev` -> ingress HTTPS -> OpenClaw at `${IRIS_MAC_MINI_IP}:18789`
- `athena.khzaw.dev` -> ingress HTTPS -> Hermes at `${IRIS_MAC_MINI_IP}:9119`
- `${IRIS_VIP}:22` -> Mac mini SSH at `${IRIS_MAC_MINI_IP}:22`

The two HTTPS hosts use ingress host routing on the same VIP. SSH uses a separate LoadBalancer Service that shares the VIP.

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

## Verification

```bash
kubectl get svc,ingress,endpoints -n default | grep -E 'iris|hermes|athena'
kubectl get connector homelab-subnet-router -o yaml
dig @1.1.1.1 +short iris.khzaw.dev
dig @1.1.1.1 +short athena.khzaw.dev
curl -Ik --resolve iris.khzaw.dev:443:10.0.0.235 https://iris.khzaw.dev/
curl -Ik --resolve athena.khzaw.dev:443:10.0.0.235 https://athena.khzaw.dev/
```
