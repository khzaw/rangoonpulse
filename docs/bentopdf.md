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
- Control Panel lists BentoPDF in Exposure as `bento`, disabled by default.
- Optional `share-bento.khzaw.dev` uses the existing Cloudflare Tunnel and
  exposure-control gate with Cloudflare Access protection. The canonical
  hostname remains private when temporary sharing is enabled.

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
- Dynacat includes the private URL and checks the cluster-local service at
  `http://bentopdf.default.svc.cluster.local:8080`

## Resource bounds

Each replica requests `50m` CPU and `64Mi` memory, with limits of `250m` CPU and
`128Mi` memory. The HPA maintains one to two replicas with a target average CPU
usage of `35m` per replica and a 300-second scale-down stabilization window.

These limits cover static asset serving. PDF size and conversion cost primarily
affect the browser device's CPU and memory. The service is stateless, so multiple
replicas do not need shared storage or session affinity.

The chart's `controllers.main.horizontalPodAutoscaler` generates the HPA and
omits `Deployment.spec.replicas`, leaving replica management to the autoscaler.
Resource Advisor includes BentoPDF in reporting and the resource auto-apply
mapping. The absolute CPU target preserves the original threshold (70% of `50m`)
while allowing request tuning without moving the HPA trigger. Normal data
maturity, minimum-change, and node-capacity gates still apply. Run a fresh report
after onboarding so the Tuning page shows the workload immediately.
Before the advisor's first hourly p95 sample, the row displays `awaiting metrics`
and keeps current resources. Missing history must not hide the app from Tuning.

## Image updates

The image uses an explicit stable version. Existing Renovate rules and the
control panel's image discovery cover this HelmRelease automatically; BentoPDF
does not need a per-service Flux image policy or image writer.

Force-refresh both `/api/image-updates?force=1` and `/api/helm-updates?force=1`
after onboarding and verify BentoPDF in both Control Panel lists. Their cached
snapshots can predate the deployment even when the update policy is configured.

## Secrets

BentoPDF has no application credentials, database password, or API key. Its only
service-specific Secret is `default/bentopdf-tls`, issued and renewed by
cert-manager. It is not an editable SOPS credential in the Secrets page; do not
create a placeholder credential. The cluster Secrets page must still be checked
for healthy inventory during onboarding, and any future application credential
must be SOPS-managed, documented, and visible there.

The dashboard's release watcher uses the shared Dynacat integration credential
`default/dynacat-github`, encrypted in Git and listed on the Secrets page. It is
an operator integration credential, not a BentoPDF application password.

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
