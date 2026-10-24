---
name: rangoonpulse-adguard-dns
description: "Use for rangoonpulse dual AdGuard Home rollout, persistence, service IPs, router integration, and LAN DNS behavior."
---

# Rangoonpulse AdGuard DNS

Read `docs/adguard-dns-stack-overview.md`. Also read `docs/truenas-networking-and-csi.md` when storage or Tailscale routing is involved.

## Current Layout

- primary: `apps/adguard/primary/helmrelease.yaml`
- secondary: `apps/adguard/secondary/helmrelease.yaml`
- Flux units: `adguard-primary` and `adguard-secondary`
- client DNS services: `${ADGUARD_PRIMARY_IP}` and `${ADGUARD_SECONDARY_IP}`
- separate local-path PVCs: `adguard-data` and `adguard-secondary-data`

Primary and secondary have independent writable state. Router DHCP remains authoritative; AdGuard DHCP stays disabled.

## Safety

- Reconcile one AdGuard instance at a time.
- Require the first instance to be healthy before touching the second.
- Keep `externalTrafficPolicy: Local` so query logs preserve client IPs.
- Do not point LAN clients at ClusterIP addresses.
- Keep each PVC outside the HelmRelease with prune protection.
- Mount one neutral data root; do not split writable config/work paths with fragile subPath layouts.
- If DNS and NFS fail together after Tailscale changes, investigate asymmetric routing before changing storage.

## Validation

```bash
flux get kustomizations -n flux-system | grep adguard
kubectl get svc,pvc,pod -n default | grep adguard
kubectl logs -n default deploy/adguard --since=30m
kubectl logs -n default deploy/adguard-secondary --since=30m
dig @10.0.0.233 example.com
dig @10.0.0.234 example.com
```

For changes, roll out and verify one instance before reconciling the other.
