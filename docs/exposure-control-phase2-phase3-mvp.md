# Exposure Control Phase 2 + 3

Status:
- Phase 2 + 3 completed on February 20, 2026.
- Phase 3 audit log + expiry presets completed on February 20, 2026.
- Phase 4 (security hardening) completed on February 20, 2026.
- Phase 4 monitoring and alerting wired on February 22, 2026.
- Fully validated end-to-end on February 19, 2026.

## Scope
This is a lean implementation of:
- Phase 2: dynamic exposure backend with expiry reconciliation.
- Phase 3: control panel UI/API.

Default exposure expiry:
- `1 hour` (can be changed per enable action in the UI/API).
- UI expiry presets: `15m`, `30m`, `1h`, `2h`, `6h`, `12h`, `24h`, and `Until turned off`.
- `Until turned off` is opt-in; it stores `expiresAt: null` and remains enabled until a manual or emergency disable.

## Components

1. Public tunnel edge:
- `infrastructure/public-edge/helmrelease.yaml`
- `cloudflared` routes share hostnames to the in-cluster backend service.

2. Share DNS aliases (external-dns managed):
- `infrastructure/public-edge/share-hosts-cname.yaml`
- Current hosts:
  - `share-speedtest.khzaw.dev`
  - `share-chartsdb.khzaw.dev`
  - `share-bookorbit.khzaw.dev`
  - `share-shelfmark.khzaw.dev`
  - `share-jellyfin.khzaw.dev`
  - `share-seerr.khzaw.dev`
  - `share-audiobookshelf.khzaw.dev`
  - `share-uptime.khzaw.dev`
  - `share-fluxui.khzaw.dev`
  - `share-itvp.khzaw.dev`
  - `share-sonarr.khzaw.dev`
  - `share-radarr.khzaw.dev`
  - `share-tracerr.khzaw.dev`
  - `share-kroki.khzaw.dev`
  - `share-tunarr.khzaw.dev`
  - `share-vaultwarden.khzaw.dev`
  - `share-immich.khzaw.dev`
  - `share-calibre.khzaw.dev`
  - `share-calibre-manage.khzaw.dev`

3. Exposure backend + control panel:
- `apps/exposure-control/helmrelease.yaml`
- source files:
  - `apps/exposure-control/server.js`
  - `apps/exposure-control/services.json`
- mounted via Kustomize-generated ConfigMap `exposure-control-app-files`
- Service: `default/exposure-control`
- Control panel host: `https://controlpanel.khzaw.dev`
- The control panel is now the combined operator cockpit:
  - exposure control
  - Transmission VPN routing
  - image update tracker
  - resource-advisor tuning view fetched from the separate `resource-advisor` backend
- Runtime state file: `/data/state.json` (PVC-backed, `local-path`)
- Audit log file: `/data/audit.json` (JSON Lines, append-only)
- Audit API: `GET /api/audit` — returns last 100 entries in reverse chronological order

## Behavior

1. Control panel/API can enable or disable configured share hosts.
2. On enable, backend sets an `expiresAt` timestamp, or `null` for the explicit until-turned-off mode.
3. Reconciliation loop disables bounded exposures after expiry; until-turned-off exposures are disabled manually or through the emergency disable-all action.
4. Requests to share hostnames proxy to the target app only when enabled, including target-app API paths such as `/api/*`.
   The proxy preserves request bodies and their original `Content-Length` because device sync and other write APIs depend on
   the upstream framework receiving the complete payload.
5. Exposure Control's own API is restricted to control panel host requests; API-shaped requests on recognized share hosts are proxied to their target app instead.
6. UI defaults:
- auth selector defaults to `none`
- expiry selector default is `1h` with bounded quick presets (`15m` .. `24h`) and an opt-in `Until turned off` choice
7. Security hardening (phase 4):
- default auth mode is `cloudflare-access`
- per-request rate limiting is active
- emergency disable-all endpoint is available
- Prometheus metrics are available at `/metrics`
- monitoring alerts are defined in `infrastructure/monitoring/`
8. Image update tracker:
- compares stable semver tags directly
- only reports a semver update when the registry candidate is newer than the deployed tag; partial registry listings
  must not turn an older tag into an update recommendation
- when a very large registry omits the deployed tag from the initial page window, resumes pagination from that tag so
  nearby newer releases can still be discovered without downloading the full tag history
- compares same-family non-semver numeric tags when the tag shape is clear (for example `24-alpine`, `25.07`, `4.0.16.2944-ls304`)
- falls back to remote registry digest checks for floating or non-sortable tags (for example `latest`, `next`, `stable-alpine`, `pg16`)
- still remains best-effort; hash-like tags may stay `Unknown` if there is no safe ordering signal
9. Combined cockpit behavior:
- `GET /api/tuning` proxies the structured tuning payload from the separate `resource-advisor` backend.
- No backend logic was merged:
  - `exposure-control` still owns control actions and cockpit rendering.
  - `resource-advisor` still owns tuning logic, report generation, and apply-preflight data.
10. Cockpit asset delivery:
- static assets and the rendered cockpit HTML are served brotli/gzip-compressed with ETag revalidation
- asset URLs carry a content-hash `?v=` and are browser-cached immutable; the HTML re-renders when any asset hash changes
- CSP allows Google Fonts (`fonts.googleapis.com` styles, `fonts.gstatic.com` font files) and hash-pins the inline theme-bootstrap script; all other sources remain `'self'`

## Validation Checklist (Passed)

1. Control plane health:
- `flux` kustomizations `public-edge` and `exposure-control` are `Ready=True`.
- `public-edge/cloudflared` and `default/exposure-control` pods are `Running`.

2. Toggle flow:
- Baseline disabled response on `share-sponsorblocktv.khzaw.dev` returned `403`.
- Enable call for `sponsorblocktv` returned `enabled=true` with future `expiresAt`.
- Share URL returned `200` while enabled.
- Disable call returned `enabled=false`; share URL returned `403` again.

3. Expiry handling:
- Expired exposure state was loaded and reconciliation disabled it automatically.
- API snapshot showed `enabled=false` and `desiredEnabled=false` after reconcile.

4. Phase 4 operations:
- `ServiceMonitor/monitoring/exposure-control` is present.
- `PrometheusRule/monitoring/exposure-control` is present and validated.
- `/metrics` endpoint returns `exposure_control_*` metrics.
- `POST /api/admin/disable-all` disables active temporary shares.

## Operator Commands

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig
```

```bash
# Health
flux get kustomizations -n flux-system | rg 'public-edge|exposure-control'
kubectl get pods -n public-edge
kubectl get pods -n default | rg exposure-control
kubectl logs -n public-edge deploy/cloudflared --tail=120
kubectl logs -n default deploy/exposure-control --tail=120
```

```bash
# DNS + URL checks
dig @1.1.1.1 +short share-sponsorblocktv.khzaw.dev
dig @1.1.1.1 +short share-speedtest.khzaw.dev
dig @1.1.1.1 +short controlpanel.khzaw.dev
curl -I --max-time 20 https://controlpanel.khzaw.dev
```

## API Examples

```bash
# List current exposure status
curl -s https://controlpanel.khzaw.dev/api/services | jq
```

```bash
# Enable one service for default 1h
curl -s -X POST https://controlpanel.khzaw.dev/api/services/sponsorblocktv/enable \
  -H 'content-type: application/json' -d '{}' | jq
```

```bash
# Enable with explicit expiry hours (0.25-24)
curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/enable \
  -H 'content-type: application/json' -d '{"hours":0.5}' | jq
```

```bash
# Enable until manually disabled
curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/enable \
  -H 'content-type: application/json' -d '{"hours":null}' | jq
```

```bash
# Disable immediately
curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/disable \
  -H 'content-type: application/json' -d '{}' | jq
```

## Add A New Shareable Service

Update these GitOps files together:
1. `apps/exposure-control/helmrelease.yaml`
- add service entry in `services.json` config (`id`, `target`, `name`)

2. `infrastructure/public-edge/share-hosts-cname.yaml`
- add `ExternalName` Service annotation for new share hostname

3. `infrastructure/public-edge/helmrelease.yaml`
- add matching `cloudflared` ingress hostname route to `exposure-control` service

Then reconcile:
```bash
flux reconcile kustomization exposure-control -n flux-system --with-source
flux reconcile kustomization public-edge -n flux-system --with-source
```
