# Public Edge Phase 1 Bootstrap

Status:
- Completed on February 19, 2026.

## Purpose
Bootstrap a lean Cloudflare Tunnel foundation for future public exposure control.

Phase 1 goal:
- deploy `cloudflared` on the Raspberry Pi node (`talos-uua-g6r`),
- validate one low-risk public hostname route,
- avoid changing existing LAN + Tailscale private access behavior.

## GitOps Objects Added
- `infrastructure/namespaces/public-edge.yaml`
- `infrastructure/public-edge/helmrelease.yaml`
- `infrastructure/public-edge/kustomization.yaml`
- `flux/kustomizations/public-edge.yaml`
- `infrastructure/secrets/public-edge/cloudflared-tunnel-token.yaml` (SOPS encrypted)
- `infrastructure/secrets/public-edge/kustomization.yaml`

Pilot route configured in cloudflared:
- `share-sponsorblocktv.khzaw.dev` -> `http://isponsorblock-tv.default.svc.cluster.local:8080`

Rationale:
- `isponsorblock-tv` is low risk in this cluster (informational page, no admin surface).

## One-Time Prerequisites (Cloudflare)
1. Create a Cloudflare Tunnel in Zero Trust.
2. Copy:
- tunnel token
- tunnel ID

## Secret Setup (Required)
Update:
- `infrastructure/secrets/public-edge/cloudflared-tunnel-token.yaml`

Set key:
- `stringData.token` to the actual tunnel token, then re-encrypt with SOPS.

Example workflow:
```bash
sops infrastructure/secrets/public-edge/cloudflared-tunnel-token.yaml
```

## DNS Setup For Pilot Hostname
Create proxied CNAME in Cloudflare:
- Name: `share-sponsorblocktv`
- Target: `<tunnel-id>.cfargotunnel.com`
- Proxy status: ON

Note:
- This pilot DNS record is managed in Cloudflare directly for Phase 1.
- Later phases can move public-share DNS management under the control-plane API/controller path.

## Validation Checklist
```bash
# Flux reconciliation
flux reconcile kustomization secrets --with-source
flux reconcile kustomization public-edge --with-source

# Check cloudflared health
kubectl get pods -n public-edge
kubectl logs -n public-edge deploy/cloudflared

# Confirm pilot service still healthy internally
kubectl get pods -n default | rg isponsorblock-tv
```

External validation:
1. Open `https://share-sponsorblocktv.khzaw.dev` from non-tailnet internet.
2. Confirm response is the iSponsorBlockTV info page.
3. Confirm private hostnames and LAN/Tailscale paths still behave as before.

## Rollback
Disable public edge quickly:
```bash
flux suspend kustomization public-edge -n flux-system
```

Or remove pilot DNS CNAME in Cloudflare.
