# Dashboards: Homepage + Glance

This repository runs two dashboards with slightly different strengths:
- Homepage: app launcher + built-in widgets (requires less custom templating)
- Glance: richer "content" dashboard via `glance.yml` and `custom-api` widgets

## Hostnames
- Homepage: `https://hp.khzaw.dev`
- Glance: `https://glance.khzaw.dev`
- Glance alias: `https://hq.khzaw.dev` (historical shortcut)

## Homepage (GetHomepage)
GitOps source of truth:
- `apps/homepage/helmrelease.yaml`

### Secrets / API Keys
Homepage widgets that need API keys should read them from env vars, which are wired from the Secret:
- `default/homepage-widget-secrets`

Pattern:
- HelmRelease env var: `HOMEPAGE_VAR_*` from `secretKeyRef`
- Widget config uses: `{{HOMEPAGE_VAR_*}}`

Do not commit plaintext API keys into manifests.

### Uptime Kuma Widget (No API Key)
Homepage's `uptimekuma` widget does not use an API key. It calls the public status-page endpoints and needs:
- `url`: Uptime Kuma base URL (cluster-internal URL is fine)
- `slug`: published status page slug

If you see:
- `Status Page Not Found`

create + publish a Status Page in the Uptime Kuma UI with that slug (`Status Pages` -> `New Status Page`).

## Glance
GitOps source of truth:
- `apps/glance/helmrelease.yaml`

Glance config is embedded as a ConfigMap (`glance.yml`) and mounted read-only into the container.

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

