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
- `2 hours` (can be changed per enable action in the UI/API).

## Components

1. Public tunnel edge:
- `infrastructure/public-edge/helmrelease.yaml`
- `cloudflared` routes share hostnames to the in-cluster backend service.

2. Share DNS aliases (external-dns managed):
- `infrastructure/public-edge/share-hosts-cname.yaml`
- Current hosts:
  - `share-sponsorblocktv.khzaw.dev`
  - `share-speedtest.khzaw.dev`
  - `share-jellyfin.khzaw.dev`
  - `share-seerr.khzaw.dev`
  - `share-audiobookshelf.khzaw.dev`
  - `share-uptime.khzaw.dev`
  - `share-sonarr.khzaw.dev`
  - `share-radarr.khzaw.dev`
  - `share-tracerr.khzaw.dev`
  - `share-prowlarr.khzaw.dev`
  - `share-bazarr.khzaw.dev`
  - `share-tunarr.khzaw.dev`
  - `share-vaultwarden.khzaw.dev`
  - `share-immich.khzaw.dev`

3. Exposure backend + control panel:
- `apps/exposure-control/helmrelease.yaml`
- source files:
  - `apps/exposure-control/server.js`
  - `apps/exposure-control/services.json`
- mounted via Kustomize-generated ConfigMap `exposure-control-app-files`
- Service: `default/exposure-control`
- Control panel host: `https://controlpanel.khzaw.dev`
- Runtime state file: `/data/state.json` (PVC-backed, `local-path`)
- Audit log file: `/data/audit.json` (JSON Lines, append-only)
- Audit API: `GET /api/audit` — returns last 100 entries in reverse chronological order

## Behavior

1. Control panel/API can enable or disable configured share hosts.
2. On enable, backend sets an `expiresAt` timestamp.
3. Reconciliation loop disables exposures after expiry.
4. Requests to share hostnames proxy to target app only when enabled.
5. API is restricted to control panel host requests.
6. Security hardening (phase 4):
- default auth mode is `cloudflare-access`
- per-request rate limiting is active
- emergency disable-all endpoint is available
- Prometheus metrics are available at `/metrics`
- monitoring alerts are defined in `infrastructure/monitoring/`

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
# Enable one service for default 2h
curl -s -X POST https://controlpanel.khzaw.dev/api/services/sponsorblocktv/enable \
  -H 'content-type: application/json' -d '{}' | jq
```

```bash
# Enable with explicit expiry hours (1-24)
curl -s -X POST https://controlpanel.khzaw.dev/api/services/speedtest/enable \
  -H 'content-type: application/json' -d '{"hours":2}' | jq
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
