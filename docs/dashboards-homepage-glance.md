# Dashboard: Glance

Homepage has been decommissioned; Glance is the only dashboard in this repository.

## Hostnames
- Glance: `https://glance.khzaw.dev`
- Glance alias: `https://hq.khzaw.dev` (historical shortcut)

## Glance
GitOps source of truth:
- `apps/glance/helmrelease.yaml`

Glance config is embedded as a ConfigMap (`glance.yml`) and mounted read-only into the container.

### Node Placement
Glance is pinned to the ARM64 Raspberry Pi utility node (`talos-uua-g6r`) to keep the primary node focused on heavier apps.

### Secrets / API Keys
Glance reads API keys from:
- `envFrom: secretRef: homepage-widget-secrets`

In `glance.yml`, reference secrets as `${SOME_API_KEY}`.

### Templating Gotcha (Helm + Glance)
Glance uses Go templates (`{{ ... }}`), which conflicts with Helm templates.

When embedding a Glance template inside the HelmRelease YAML, wrap the template string in:

```yaml
template: |
  {{`...glance template here...`}}
```

This prevents Helm from consuming Glance template braces.

### Uptime Kuma In Glance
Glance doesn't have a first-class Uptime Kuma widget. Use `custom-api` with the status-page heartbeat endpoint:
- `GET /api/status-page/heartbeat/<slug>`

This also does not require an API key.

### Jellyfin "Now Playing" In Glance
Use Jellyfin's `Sessions` endpoint to show active streams:
- `GET /Sessions?api_key=...&activeWithinSeconds=...`

The repository includes a compact Now Playing widget (title/user/play state + progress bar) implemented via
`custom-api` template.
