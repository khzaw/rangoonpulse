---
name: rangoonpulse-access-and-edge
description: "Use when touching access paths in /Users/khz/Code/rangoonpulse: Tailscale subnet routing, ingress VIP access model, lan-gateway, public-edge, exposure-control, share hosts, Transmission VPN routing, or special hostname exceptions."
---

# Rangoonpulse Access And Edge

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

## Read First

Open the smallest relevant subset:
- `/Users/khz/Code/rangoonpulse/docs/networking-current-state-and-simplification.md`
- `/Users/khz/Code/rangoonpulse/docs/lan-access-current-state-and-lean-plan.md`
- `/Users/khz/Code/rangoonpulse/docs/public-exposure-control-panel-plan.md`
- `/Users/khz/Code/rangoonpulse/docs/exposure-control-phase2-phase3-mvp.md` when touching implemented public-share behavior
- `/Users/khz/Code/rangoonpulse/docs/public-edge-phase1-bootstrap.md` only for historical rollout context
- `/Users/khz/Code/rangoonpulse/docs/cloudflare-access-share-hosts-email-otp-plan.md` when share-host auth changes
- `/Users/khz/Code/rangoonpulse/docs/travel-center.md` when the operator cockpit travel flow changes
- `/Users/khz/Code/rangoonpulse/docs/transmission-optional-vpn.md` when touching Gluetun or Transmission routing

## Current Baseline

- LAN and remote Tailscale clients usually target the same ingress VIP: `10.0.0.231`.
- Remote access uses Tailscale subnet routing, not a separate Tailscale ingress proxy.
- The active `Connector` lives at `/Users/khz/Code/rangoonpulse/infrastructure/tailscale-subnet-router/connector.yaml`.
- It acts as both subnet router and exit node and advertises `/32` routes for the primary node, utility node, ingress VIP, NAS, and router.
- Public internet share-host exposure routes through Cloudflare Tunnel via `/Users/khz/Code/rangoonpulse/infrastructure/public-edge/`.
- `controlpanel.khzaw.dev` is the combined operator cockpit for exposure control, travel readiness, Transmission VPN control, image updates, and tuning UI entry.
- `iris.khzaw.dev` is the private exception:
  - dedicated VIP `10.0.0.235`
  - `443` fronts ingress-nginx for OpenClaw web
  - `22` forwards directly to the Mac mini SSH service
  - OpenClaw still enforces token auth, device pairing, and per-origin Control UI settings after the network path is correct

## Guardrails

- Do not reintroduce the retired Tailscale ingress-proxy plus custom DNS model unless the user explicitly asks for a redesign.
- For NAS and router hostname access, keep using `/Users/khz/Code/rangoonpulse/infrastructure/lan-gateway/` selectorless Services plus ingress TLS termination.
- If NFS-backed PVCs suddenly fail after Tailscale changes, check the TrueNAS Tailscale app's "Accept Routes" setting first.
- Share-host changes often touch both `apps/exposure-control/` and `infrastructure/public-edge/`.
- Keep the public-edge and exposure-control split intact:
  - `apps/exposure-control/` owns operator write actions and cockpit shell
  - `infrastructure/resource-advisor/` remains a separate backend/exporter

## Important Exceptions

- `blog.khzaw.dev` is permanently public and bypasses exposure-control.
  - DNS ownership lives in `/Users/khz/Code/rangoonpulse/infrastructure/public-edge/share-hosts-cname.yaml`.
  - Do not add `external-dns.alpha.kubernetes.io/hostname: blog.khzaw.dev` to the blog Ingress or it will publish the private ingress VIP.
- `calibre-manage.khzaw.dev:9090/content` is the explicit-port exception.
  - Use ingress class `nginx-calibre`.
  - Do not add `external-dns` or `cert-manager` annotations on that `nginx-calibre` Ingress.
- `iris.khzaw.dev` is the dedicated-VIP exception.
  - DNS ownership lives on `Service/ingress-nginx-iris-controller`, not the Ingress.
  - Keep `10.0.0.235/32` advertised in the Tailscale subnet-router.
  - Do not point the hostname back at the shared ingress VIP `10.0.0.231`.
  - Do not misdiagnose OpenClaw login failures as ingress failures before checking token state, device approval, and `gateway.controlUi.allowedOrigins`.
- Transmission VPN routing has GitOps control config plus runtime-owned state:
  - GitOps control file: `/Users/khz/Code/rangoonpulse/apps/transmission/transmission-vpn-control.yaml`
  - runtime-owned ConfigMap: `default/transmission-vpn-state`
  - do not make Flux own the runtime ConfigMap

## Verification

Validate the real access path, not just manifests:

```bash
flux get kustomizations -n flux-system | rg 'lan-access|public-edge|exposure-control'
kubectl get ingress -A
kubectl get svc -A | rg 'ingress-nginx|lan-gateway|public-edge'
curl -I --max-time 20 https://<host>/
dig +short <host>
```

If the hostname still fails, debug in order:
- DNS target
- ingress presence and class
- service or endpoint wiring
- pod readiness and logs
- Tailscale route advertisement or client routing
