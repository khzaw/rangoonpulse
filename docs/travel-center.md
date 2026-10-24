---
title: Travel Center
summary: Current control-panel travel readiness probes, source files, limitations, and verification.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Travel Center

The Travel tab at `controlpanel.khzaw.dev/#travel` summarizes remote-readiness signals. The API is `GET /api/travel`.

## Source Of Truth

- target configuration: `apps/exposure-control/travel.json`
- backend: `apps/exposure-control/server.js`
- frontend: `apps/exposure-control/index.html`, `app.js`, and `styles.css`
- RBAC/runtime: `apps/exposure-control/rbac.yaml` and `helmrelease.yaml`

## What It Checks

The backend probes configured private/public endpoints, reads Tailscale Connector status, reports Transmission routing state, and summarizes temporary shares.

The configured target list is authoritative in `travel.json`; do not duplicate it into this doc.

Current limitation: the Connector itself advertises `${IRIS_VIP}/32`, but the Travel expected-route list does not include that route. Travel readiness can therefore be green without proving the Iris/Athena dedicated edge route. Check the Connector directly when those hosts matter.

## Verification

URL fragments are browser-side and are not sent in HTTP requests. `curl ...#travel` only tests the root page. Probe the API instead:

```bash
curl -s https://controlpanel.khzaw.dev/api/travel | jq
kubectl get connector homelab-subnet-router -o yaml
kubectl get pods -n tailscale -o wide
```

For remote acceptance, test from an actual tailnet client rather than only from inside the cluster.

If private access and NFS fail after Tailscale changes, verify the Connector routes and keep TrueNAS Tailscale Accept Routes disabled.
