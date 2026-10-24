---
title: Networking and Access Topology
summary: Current private ingress, public Tunnel, temporary-share, DNS, and dedicated-edge paths.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Networking and Access Topology

## Shared Settings

Network constants live in `flux/cluster-settings.yaml`. Do not duplicate them into app manifests.

Current roles:

- shared ingress VIP: `${INGRESS_VIP}`
- Transmission peer-to-peer VIP: `${TRANSMISSION_P2P_VIP}`
- Mac mini edge VIP: `${IRIS_VIP}`
- AdGuard DNS VIPs: `${ADGUARD_PRIMARY_IP}` and `${ADGUARD_SECONDARY_IP}`
- Tailscale Connector routes: router, both nodes, NAS, shared ingress VIP, and Mac mini edge VIP as `/32` routes

## Three Access Paths

### Private Services

```text
LAN or Tailscale client
  -> private DNS answer
  -> MetalLB shared ingress VIP
  -> ingress-nginx
  -> Ingress host/path rule
  -> Service
  -> pod or static Endpoint
```

Tailscale remote access uses `infrastructure/tailscale-subnet-router/connector.yaml`. The Connector is also an exit node. Keep the narrow `/32` advertisements unless broad LAN routing is an explicit design change.

### Permanently Public Sites

```text
public DNS
  -> Cloudflare edge
  -> Cloudflare Tunnel
  -> in-cluster Service
```

`infrastructure/public-edge/helmrelease.yaml` owns Tunnel origin routes. `infrastructure/public-edge/share-hosts-cname.yaml` owns the proxied DNS aliases.

Current permanent origins are the `khzaw.dev` apex, `blog.khzaw.dev`, `mmcal.khzaw.dev`, `rangoonmapper.khzaw.dev`, `ericaknight.me`, and `www.ericaknight.me`. `www.khzaw.dev` is an external Cloudflare redirect/DNS concern, not an in-cluster origin.

The public path normally bypasses MetalLB and ingress-nginx.

### Temporary Public Shares

```text
share hostname
  -> Cloudflare edge and Access when configured
  -> Cloudflare Tunnel
  -> exposure-control
  -> allow/expiry/rate-limit checks
  -> selected in-cluster Service
```

A working share requires agreement between the exposure-control catalog, Tunnel route, and public DNS alias. Catalog presence alone is not public wiring.

## DNS Ownership

- Private app hostnames use explicit ExternalDNS annotations and normally resolve to the shared ingress VIP.
- Permanent-public and share hosts use proxied `ExternalName` Services under `infrastructure/public-edge/`.
- ExternalDNS intentionally ignores Ingress rule and TLS host fields. DNS ownership must be explicit.
- ExternalDNS currently reads the repository's `external-dns.alpha.kubernetes.io/` annotations through an explicit compatibility flag. Remove that flag only in the same atomic change that migrates every annotation.

LAN clients use the two AdGuard VIPs. Cluster and node DNS intentionally use public upstream resolution rather than depending on the LAN filtering path.

## Mac Mini Edge

`infrastructure/iris-edge/` exposes:

- `iris.khzaw.dev` to OpenClaw on the Mac mini
- `athena.khzaw.dev` to Hermes on the Mac mini
- SSH on `${IRIS_VIP}:22`

HTTPS uses ingress host routing; SSH uses a dedicated LoadBalancer Service. The Mac mini services remain responsible for their own authentication and origin policy after network routing succeeds.

## LAN Device Proxies

`infrastructure/lan-gateway/` uses selectorless Services plus static Endpoints for the NAS and router. Ingress-nginx terminates TLS and proxies to the LAN devices. Keep the static target IPs in `flux/cluster-settings.yaml`.

## Current Constraints

- Keep TrueNAS Tailscale **Accept Routes** disabled. Enabling it can create asymmetric return paths and break NFS or management API traffic from cluster nodes.
- MetalLB only advertises service IPs. Host and path routing begins in ingress-nginx or Cloudflare Tunnel.
- Do not add another access plane unless it replaces a defined current path. Parallel proxy stacks increase DNS ownership, policy, and failure ambiguity.

## Verification

```bash
kubectl get svc -A | grep -E 'LoadBalancer|ExternalName'
kubectl get ingress -A
kubectl get connector homelab-subnet-router -o yaml
flux get kustomizations -n flux-system

dig @1.1.1.1 +short <host>
curl -I --max-time 20 https://<host>/
```

For a private host with stale local DNS, isolate ingress from resolution:

```bash
curl -Ik --resolve <host>:443:10.0.0.231 https://<host>/
```
