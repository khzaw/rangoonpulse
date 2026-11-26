---
title: Share-Host Authentication
summary: Cloudflare Access trust boundary, token verification, service-token hosts, and external configuration requirements for public share hosts.
status: active
owner: homelab
last_reviewed: 2026-11-26
---

# Share-Host Authentication

## Contract

Public share hosts in `cloudflare-access` mode work only when a Cloudflare Access application covers the hostname and exposure-control can verify the token that Access adds. Cloudflare Access configuration is external to this repository; the repo owns the Tunnel route, DNS alias, exposure-control auth mode, and backend verification.

The Access policy decides who gets a token: Email OTP for people, or a Service Auth policy for machine clients holding a service token. Neither is Kubernetes state. Verify the Access application and policy in Cloudflare whenever protected share behavior changes.

## Backend Verification

For a `cloudflare-access` share, exposure-control requires the `Cf-Access-Jwt-Assertion` header and verifies it before proxying:

- RS256 signature against the team's keys from `https://<team-domain>/cdn-cgi/access/certs`
- issuer equal to `https://<team-domain>`
- `exp` and `nbf`, with 60 seconds of clock skew
- audience, when the catalog entry sets `accessAud` to the Access application's AUD tag

`CF_ACCESS_TEAM_DOMAIN` in `apps/exposure-control/helmrelease.yaml` sets the team domain, such as `<team>.cloudflareaccess.com`. While it is unset, every `cloudflare-access` share returns `403`. Keys are cached for an hour, an unknown key ID triggers at most one refetch per 30 seconds, and an unreachable certs endpoint with no cached keys returns `503`. Rejections are logged with their reason and counted in `exposure_control_share_denied_auth_total`.

The header's presence proves nothing: a request on a hostname that no Access application covers can carry any value. Signature and issuer checks reject forged values. Set `accessAud` on any host that must accept only its own application's tokens; without it, a token from any application in the team is accepted.

Canonical overrides such as `actual-agent.khzaw.dev`, `iris.khzaw.dev`, or `athena.khzaw.dev` need their own Access application; an application scoped to `share-*` hosts does not cover them.

## Service-Token Hosts

`actual-agent.khzaw.dev` exposes Actual Budget to API clients outside the tailnet. Its Access application must have a single Service Auth policy for that client's service token. The client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` on every request; Cloudflare rejects requests without them before the Tunnel. Actual's server password still applies, and Actual has no read-only scope.

Keep each service token on a dedicated host and application. Adding a service token to a shared `share-*` application would admit it to every enabled share. Exposure-control still owns enablement, so enable the share with `cloudflare-access` mode, usually `--until-disabled`, and disable it to cut access without touching Cloudflare.

## Repository Touch Points

- service auth mode and optional `accessAud`: `apps/exposure-control/services.json` and runtime state
- team domain: `CF_ACCESS_TEAM_DOMAIN` in `apps/exposure-control/helmrelease.yaml`
- Tunnel host route: `infrastructure/public-edge/helmrelease.yaml`
- DNS alias: `infrastructure/public-edge/share-hosts-cname.yaml`
- verification: `apps/exposure-control/access-jwt.js`, called from `apps/exposure-control/server.js`

## Verification

For a protected, enabled host:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<share-host>/
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Cf-Access-Jwt-Assertion: forged' https://<share-host>/
```

Both must fail. With an Access application, the first is challenged or rejected by Cloudflare. Without one, the request reaches exposure-control and the forged header returns `403 cloudflare access token rejected`. Then confirm the intended client works: an authenticated browser session for people, or the two service-token headers for a machine client. Confirm that disabling or expiring the share returns `403` from exposure-control.

Do not claim Cloudflare Access policy state from repository inspection alone.
