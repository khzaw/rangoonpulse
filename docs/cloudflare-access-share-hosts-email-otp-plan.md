# Cloudflare Access Plan for `share-*.khzaw.dev` (Email OTP)

Purpose:
- Make `authMode=cloudflare-access` usable for temporary public shares.
- Keep `authMode=none` available for truly open links when needed.

Scope:
- Applies only to share hostnames (for example `share-calibre.khzaw.dev`).
- Does not change private LAN/Tailscale access paths.

## Target Behavior

1. Operator enables service in control panel with `authMode=cloudflare-access`.
2. Visitor opens the share URL.
3. Cloudflare Access prompts email OTP login.
4. On successful login, Cloudflare injects `cf-access-jwt-assertion`.
5. `exposure-control` accepts request and proxies upstream.

Without Access login/token, share URL returns `403`.

## One-Time Cloudflare Setup (Dashboard)

1. Go to Cloudflare Zero Trust -> `Access` -> `Applications`.
2. Create `Self-hosted` application:
- Name: `Share Hosts`
- Domain include:
  - `share-*.khzaw.dev`
3. Add policy `Allow`:
- Include: `Emails`
- Enter allowed recipient emails (friend(s), your own test email).
4. Login method:
- Enable One-time PIN (email OTP).
5. Session settings:
- Set session duration to short window (for example `2h`).
6. Save and deploy.

## Optional Tightening

1. Add second policy for your own admin/test identities first, then widen as needed.
2. Add rate limit/WAF for `share-*.khzaw.dev` in Cloudflare if not already applied.
3. Restrict countries/ASNs if this fits your use case.

## Validation Checklist

1. In control panel, enable one service with `authMode=cloudflare-access`.
2. Open share URL in private/incognito browser:
- Expect Cloudflare Access login page.
3. Complete email OTP:
- Expect app response (`200`/app-specific response).
4. CLI test without Access token:
- `curl https://share-<service>.khzaw.dev` returns `403`.
5. Disable exposure in control panel:
- Share URL returns `403`.

## Ops Notes

1. `exposure-control` currently checks only for `cf-access-jwt-assertion` presence, not JWT validation.
2. Trust boundary is Cloudflare Tunnel + Access at edge.
3. If stronger assurance is needed later, add JWT signature/audience verification in backend.
