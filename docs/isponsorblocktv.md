---
title: iSponsorBlockTV
summary: Current headless service, device setup, host-networking, persistence, and info-page contract.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# iSponsorBlockTV

## Runtime

- source: `apps/isponsorblock-tv/`
- hostname: `sponsorblocktv.khzaw.dev`
- app: headless iSponsorBlockTV process
- web surface: nginx info sidecar
- persistence: `truenas-nfs` mounted at `/app/data`
- networking: `hostNetwork: true` remains enabled continuously for device discovery

The main process stays idle until at least one device is configured. A one-minute loop detects configuration and starts the service.

Both container images use mutable tags. Treat rollout verification by digest as necessary because the tag alone does not identify the deployed build.

## Device Setup

Run the upstream setup CLI in the existing pod. It writes the device configuration to the persistent `/app/data` mount.

```bash
kubectl exec -n default -it deploy/isponsorblock-tv -c main -- \
  python3 -m iSponsorBlockTV --data /app/data setup-cli
```

## Integration

The service is linked and monitored in Dynacat and mapped in Resource Advisor. It is not managed by exposure-control and has no public share host.

## Verification

```bash
flux get kustomization isponsorblock-tv -n flux-system
kubectl get pod,pvc,svc,ingress -n default | grep isponsorblock
kubectl logs -n default deploy/isponsorblock-tv -c main --since=30m
curl -Ik https://sponsorblocktv.khzaw.dev/
```
