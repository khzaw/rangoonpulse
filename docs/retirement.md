---
title: Retirement
summary: Private retirement-planning dashboard deployment, image promotion, and access boundary.
---

# Retirement

Longview is a private retirement calculator and portfolio-projection web app at `https://retirement.khzaw.dev`.

## Access boundary

- `retirement.khzaw.dev` follows the normal private ingress path and resolves to the shared ingress VIP for LAN and Tailscale clients.
- It has no Cloudflare Tunnel route, public-edge alias, or Exposure Control share entry.
- Remote access therefore requires the tailnet subnet route to `10.0.0.231`.

## Runtime

- Source and image: private `github.com/khzaw/retirement` / `ghcr.io/khzaw/retirement`
- Workload: one Nginx-based `app-template` replica pinned to `${PRIMARY_NODE_NAME}`
- Port and health: `8080` / `/health`
- GitOps: `apps/retirement/` and `flux/kustomizations/retirement.yaml`
- Image promotion: private timestamped commit tags selected by `ImagePolicy/retirement`

The container serves the client-side application and exposes one same-origin proxy path, `/api/yahoo-finance/`, for public quote requests. Portfolio positions remain in browser local storage; the cluster has no retirement database or PVC.

## Deploy latest image now

Use the Retirement card at `https://controlpanel.khzaw.dev/#deploy`, or run:

```bash
make deploy-retirement
```

The target reconciles the private image repository, policy, per-site image writer, Git source, and Retirement app Kustomization.
