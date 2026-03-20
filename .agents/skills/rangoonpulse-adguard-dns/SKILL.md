---
name: rangoonpulse-adguard-dns
description: "Use when touching the dual AdGuard Home deployments or LAN DNS behavior in /Users/khz/Code/rangoonpulse. Covers rollout safety, service IPs, PVC handling, router integration, and common failure modes."
---

# Rangoonpulse AdGuard DNS

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

## Read First

Open:
- `/Users/khz/Code/rangoonpulse/docs/adguard-dns-stack-overview.md`
- `/Users/khz/Code/rangoonpulse/docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md` when DNS or storage failures line up with Tailscale changes

## Layout

- Primary deployment: `/Users/khz/Code/rangoonpulse/apps/adguard/primary/helmrelease.yaml`
- Secondary deployment: `/Users/khz/Code/rangoonpulse/apps/adguard/secondary/helmrelease.yaml`
- Separate Flux rollout units:
  - `flux/kustomizations/adguard-primary.yaml`
  - `flux/kustomizations/adguard-secondary.yaml`
- Router/client DNS endpoints:
  - `Service/adguard-dns` -> `10.0.0.233`
  - `Service/adguard-secondary-dns` -> `10.0.0.234`

## Safety Rules

- Do not reconcile both AdGuard Flux kustomizations at the same time unless there is an explicit maintenance window.
- Keep primary and secondary as separate rollout units with gating and health checks.
- Both DNS Services should keep `externalTrafficPolicy: Local` so query logs preserve source IP.
- Router DHCP remains the active DHCP authority. AdGuard built-in DHCP stays disabled.
- Do not point LAN clients at Kubernetes `ClusterIP` addresses for DNS.

## State And Mount Rules

- Keep separate writable PVCs:
  - `PersistentVolumeClaim/adguard-data`
  - `PersistentVolumeClaim/adguard-secondary-data`
- Those PVCs are GitOps-managed outside the HelmRelease and should keep prune disabled.
- Mount the PVC at a neutral path (`/adguard-data`), not split `conf/` and `work/` via `subPath`.
- Do not let two live AdGuard instances share one writable data directory.
- Startup should fail fast if the PVC is not a real mount.
- If `AdGuardHome.yaml` is missing, startup seeds a minimal working config instead of dropping into the first-run wizard.

## Runtime Expectations

- Web UIs:
  - `https://adguard.khzaw.dev`
  - `https://adguard2.khzaw.dev`
- Runtime tuning is enforced at startup:
  - web UI on `:80`
  - DNS listeners on `:53`
  - DHCP disabled
- If the UI or probes stop matching, check whether runtime config drifted from Helm values.

## Verification

```bash
flux get kustomizations -n flux-system | rg 'adguard'
kubectl get svc -n default | rg 'adguard'
kubectl get pvc -n default | rg 'adguard'
kubectl get pods -n default -o wide | rg 'adguard'
kubectl logs -n default deploy/adguard
kubectl logs -n default deploy/adguard-secondary
```

If DNS failures and PVC mount failures happen together, investigate asymmetric routing before changing storage manifests.
