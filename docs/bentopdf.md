---
title: BentoPDF
summary: Private browser-based PDF toolbox deployment, resource bounds, and access path.
status: active
owner: homelab
last_reviewed: 2026-09-15
---

# BentoPDF

[BentoPDF](https://github.com/alam00000/bentopdf) provides PDF tools at
`https://bento.khzaw.dev`. PDF processing runs in the browser; the container serves
the application and its static assets.

## Access boundary

- `bento.khzaw.dev` resolves to the shared ingress VIP, `10.0.0.231`.
- LAN clients connect directly; remote clients need the Tailscale subnet route to
  the ingress VIP.
- Ingress class `nginx` terminates HTTPS using `letsencrypt-prod`.
- The hostname has no Cloudflare Tunnel route, public-edge alias, or
  Exposure Control share entry.

## Runtime and GitOps

- Manifests: `apps/bentopdf/`
- Flux Kustomization: `flux/kustomizations/bentopdf.yaml`
- HelmRelease, Deployment, and Service: `bentopdf` in namespace `default`
- Chart: `app-template` `5.1.0`
- Image: `ghcr.io/alam00000/bentopdf-simple:2.8.8`
- Runtime: NGINX on port `8080`, with HTTP probes against `/`
- Placement: `${PRIMARY_NODE_NAME}` (`talos-7nf-osf`)
- Persistence: none; there is no database or PVC to back up
- Upstream includes the HTTPS cross-origin isolation headers needed by
  LibreOffice WASM. Some processing libraries load from upstream CDNs; private
  ingress does not make this an air-gapped deployment.
- Glance includes the private URL and checks the cluster-local service at
  `http://bentopdf.default.svc.cluster.local:8080`

## Resource bounds

Each replica requests `50m` CPU and `64Mi` memory, with limits of `250m` CPU and
`128Mi` memory. The HPA maintains one to two replicas with a target average CPU
utilization of 70% of the request and a 300-second scale-down stabilization window.

These limits cover static asset serving. PDF size and conversion cost primarily
affect the browser device's CPU and memory. The service is stateless, so multiple
replicas do not need shared storage or session affinity.

The chart's `controllers.main.horizontalPodAutoscaler` generates the HPA and
omits `Deployment.spec.replicas`, leaving replica management to the autoscaler.
Resource Advisor discovers BentoPDF for reporting, but it is excluded from the
resource auto-apply allowlist. Adjust requests manually: changing the CPU request
also changes the amount of CPU at which the utilization-based HPA scales.

## Image updates

The image uses an explicit stable version. Existing Renovate rules and the
control panel's image discovery cover this HelmRelease automatically; BentoPDF
does not need a per-service Flux image policy or image writer.

## Verification

After committing, pushing, and reconciling the GitOps change:

```bash
flux get kustomization bentopdf -n flux-system
flux get helmrelease bentopdf -n default
kubectl rollout status deployment/bentopdf -n default --timeout=180s
kubectl get hpa bentopdf -n default
dig +short bento.khzaw.dev A
curl -I --max-time 20 https://bento.khzaw.dev/
```

Check that the HPA has CPU metrics, the certificate is valid, and the browser can
load a tool and process a small local PDF. A healthy static landing page alone
does not prove that the browser's PDF-processing assets loaded successfully.
