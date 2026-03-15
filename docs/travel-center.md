# Travel Center

## Purpose

The control panel now includes a `Travel` tab at `https://controlpanel.khzaw.dev#travel`.

This page is the operator-facing remote-life surface for the homelab. It does not manage the client-side Tailscale app,
but it does answer the practical cluster-side questions that matter when you are away:

- is the Tailscale connector healthy enough for private remote access
- is the connector still configured as an exit node
- are the key remote hostnames responding
- what is the current Transmission route
- are any temporary public shares still active

## Current Model

Travel Center lives inside the existing `apps/exposure-control/` app. It reuses:

- the exposure-control backend and static UI shell
- the existing Transmission VPN status and control API
- the existing temporary share state and audit log
- the cluster's current unified access model documented in `docs/networking-current-state-and-simplification.md`

It does **not** replace:

- the Tailscale client app on your phone/laptop
- manual client-side exit-node selection
- the exposure-control tab for detailed share edits

## Config Source

Travel targets and bundle groupings are defined in:

- `/Users/khz/Code/rangoonpulse/apps/exposure-control/travel.json`

That file declares:

- the expected Connector name
- the expected advertised `/32` routes
- curated remote bundles such as `Essentials`, `Media`, and `Life`
- the URLs and HTTP probe expectations for each target

## API

The control panel backend now exposes:

- `GET /api/travel`

This returns:

- summary travel state
- Connector readiness and route expectations
- Transmission routing posture
- active temporary share posture
- grouped link bundles and per-target probe results
- operator notes for remote use

## Files

- `/Users/khz/Code/rangoonpulse/apps/exposure-control/server.js`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/index.html`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/app.js`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/styles.css`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/travel.json`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/rbac.yaml`
- `/Users/khz/Code/rangoonpulse/apps/exposure-control/helmrelease.yaml`

## Validation

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

kubectl apply --dry-run=client -f apps/exposure-control/rbac.yaml
kubectl apply --dry-run=client -f apps/exposure-control/helmrelease.yaml
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -

curl -s https://controlpanel.khzaw.dev/api/travel | jq '.summary,.connector,.transmission,.exposures.activeCount'
curl -I --max-time 20 https://controlpanel.khzaw.dev#travel
```

## Operator Notes

- A healthy Travel tab means the cluster-side prerequisites for remote use look good.
- It does **not** guarantee the client device is connected to Tailscale.
- Exit-node use is still selected on the client device.
- If private access breaks after network changes, re-check the Tailscale Connector and the TrueNAS
  `Accept Routes` gotcha documented in `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`.
