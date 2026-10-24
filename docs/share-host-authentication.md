---
title: Share-Host Authentication
summary: Current Cloudflare Access trust boundary and external configuration requirements for public share hosts.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Share-Host Authentication

## Contract

Temporary public share hosts can require Cloudflare Access before traffic reaches exposure-control. Cloudflare Access configuration is external to this repository; the repo owns the Tunnel route, DNS alias, exposure-control auth mode, and backend enforcement point.

Email OTP is a Cloudflare policy choice, not Kubernetes state. Verify the Access application and policy in Cloudflare whenever protected share behavior changes.

## Current Backend Check

Exposure-control requires the `cf-access-jwt-assertion` header for `cloudflare-access` mode. It does not currently verify the token signature, issuer, or audience.

That makes the network path part of the trust boundary:

- protected hosts must be reachable only through Cloudflare Tunnel and Access
- no direct public origin may inject the header and bypass Access
- canonical overrides such as `iris.khzaw.dev` or `athena.khzaw.dev` require their own Cloudflare Access application scope; a `share-*` application does not cover them

If direct origin exposure or multi-proxy trust is introduced, add full JWT verification before relying on the header.

## Repository Touch Points

- service auth mode: `apps/exposure-control/services.json` and runtime state
- Tunnel host route: `infrastructure/public-edge/helmrelease.yaml`
- DNS alias: `infrastructure/public-edge/share-hosts-cname.yaml`
- enforcement: `apps/exposure-control/server.js`

## Verification

For a protected, enabled host:

```bash
curl -I https://<share-host>/
```

A request without Access should be challenged or rejected before the target service responds. Also verify through an authenticated browser session and confirm that disabling or expiring the share returns `403` from exposure-control.

Do not claim Cloudflare Access policy state from repository inspection alone.
