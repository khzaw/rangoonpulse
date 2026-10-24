---
name: rangoonpulse-access-and-edge
description: "Use for rangoonpulse private ingress, Tailscale, public-edge, exposure-control, share hosts, Transmission VPN routing, and Mac mini edge changes."
---

# Rangoonpulse Access And Edge

## Read First

Open the smallest relevant set:

- `docs/networking.md`
- `docs/lan-access.md`
- `docs/public-edge-and-exposure-control.md`
- `docs/share-host-authentication.md`
- `docs/travel-center.md`
- `docs/transmission-optional-vpn.md`
- `docs/mac-mini-edge.md`

## Current Paths

1. Private: LAN/Tailscale -> shared ingress VIP -> ingress-nginx -> Service.
2. Permanent public: Cloudflare -> Tunnel -> in-cluster Service.
3. Temporary share: Cloudflare -> Tunnel -> exposure-control -> selected Service.

Do not add a parallel access plane unless it replaces a defined current path.

## Current Ownership

- Tailscale subnet/exit routing: `infrastructure/tailscale-subnet-router/connector.yaml`
- LAN device proxies: `infrastructure/lan-gateway/`
- Mac mini OpenClaw/Hermes/SSH edge: `infrastructure/iris-edge/`
- temporary-share catalog and state: `apps/exposure-control/`
- public Tunnel routes and DNS aliases: `infrastructure/public-edge/`
- shared addresses: `flux/cluster-settings.yaml`

A working share requires the catalog, Tunnel route, and DNS alias to agree. Catalog-only entries are not public.

## Guardrails

- Keep narrow `/32` Tailscale routes unless broad LAN routing is explicit.
- Keep TrueNAS Tailscale Accept Routes disabled.
- Keep private canonical hostnames separate from public share hosts unless a current override is deliberate.
- Preserve runtime-owned ConfigMaps outside Flux ownership.
- Do not put ExternalDNS ownership on private app Ingresses whose public DNS is owned by public-edge.
- Treat Cloudflare Access configuration as external state and verify it separately.

## Exceptions

- `iris.khzaw.dev` and `athena.khzaw.dev` use the dedicated Mac mini edge VIP.
- Iris SSH uses the same VIP through a separate LoadBalancer Service.
- Transmission mode is runtime-owned; Flux owns only the control shape.

## Verification

Validate the actual boundary, not just YAML:

```bash
flux get kustomizations -n flux-system
kubectl get connector homelab-subnet-router -o yaml
kubectl get ingress,svc,endpointslices -A
dig @1.1.1.1 +short <host>
curl -I --max-time 20 https://<host>/
```

For private ingress, use `curl --resolve`; for public paths, verify public DNS and Cloudflare behavior from outside the private network when required.
