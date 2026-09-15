# Dashboard: Dynacat

Dynacat is the dashboard and service hub at **https://rangoonpulse.khzaw.dev**.
It uses the normal private ingress VIP access path on LAN and through Tailscale.
The former `glance.khzaw.dev` alias and its workload, Flux objects, ingress, and certificate have been retired.

## GitOps sources

- `apps/dynacat/helmrelease.yaml`: runtime, inline `dynacat.yml`, and CSS.
- `apps/dynacat/certificate.yaml`: canonical TLS certificate, issued independently of ingress for safe cutovers.
- `flux/kustomizations/dynacat.yaml`: Flux wiring and shared-setting substitution.
- `default/homepage-widget-secrets`: existing encrypted API keys, consumed with `envFrom`.
- `default/dynacat-github`: SOPS-managed GitHub token for authenticated release lookups;
  its `token` key is injected as `GITHUB_RELEASES_TOKEN`.

The dashboard runs on the ARM64 utility node, `talos-uua-g6r`, with the pinned multiarch
`ghcr.io/panonim/dynacat:3.0.0` image. The Home, Health, and Media pages retain the existing
service links, feeds, markets, media information, and custom API integrations.

## Live updates and additions

- All three pages use Dynacat dynamic updates. Explicit `update-interval` values match widget cache durations;
  Jellyfin Now Playing refreshes every 15 seconds while visible.
- Monitor widgets show recent check history: up to 15 samples, bounded to one hour, held in memory.
- Home includes **Daily Focus**, a small to-do list with five visible items before expansion. It uses browser
  localStorage at the canonical origin, so each browser/device has its own list. Clearing site data removes it.
- The dark theme, Berkeley Mono preference, and existing page organization are preserved.

Dynacat streams changes through `/api/sse/updates`. The ingress disables response buffering and uses one-hour
read/send timeouts so an idle stream remains open. Hidden browser tabs pause or throttle updates.

## Runtime and storage

Config is mounted read-only at `/app/config/dynacat.yml`; CSS assets are mounted read-only at `/app/assets`.
`ENABLE_EDITOR=false` disables the browser editor and its write APIs. Changes belong in Git.
Helm includes config checksums in the pod template, so changed ConfigMaps roll the workload even though the
config file is mounted using `subPath`.

Dynacat creates its image cache at startup. Its default location under `/app` is not writable by UID 1000.
Set `server.cache-dir: /tmp/dynacat-cache` and mount a bounded `emptyDir` at `/tmp`, with `fsGroup: 1000`.
The cache is disposable; no PVC or SQLite database is needed for the current widgets.

Only the cluster pod CIDR is trusted for forwarded proxy headers. Keep that aligned with ingress-nginx placement.
The process uses a read-only root filesystem, drops capabilities, and has no mounted Kubernetes service-account token.

## Widget conventions

For server-side monitor checks and custom API requests, use cluster-local service URLs whenever possible.
Keep the clickable user-facing links on the corresponding HTTPS hostname. This avoids unnecessary ingress and DNS
round trips and measures the service path directly.

When adding a service, update its bookmark group, relevant Health monitor, and upstream release watcher when available.
The operator cockpit remains `controlpanel.khzaw.dev`; `resource-advisor-exporter` remains a separate monitored backend.

The Releases widget uses `token: $${GITHUB_RELEASES_TOKEN}` in Git so Flux preserves the
runtime environment reference. Keep the credential in `default/dynacat-github`, never in
the ConfigMap. Its purpose is to read public repository releases; the widget does not
need repository write access.

On 2026-09-15, the whole Releases widget displayed `failed to retrieve any content`.
Pod logs showed GitHub HTTP `403` responses for all tracked repositories, including
BentoPDF, with `API rate limit exceeded`. The widget had no token configured and shared
the cluster's unauthenticated request quota. Authenticate these requests before treating
that symptom as a missing release or an invalid repository name. After a credential
change, roll the deployment and check both the pod logs and rendered release entries.

The custom API templates use Go template braces. Preserve the Helm wrapper when embedding them:

```yaml
template: |
  {{`...Dynacat template here...`}}
```

Secret references must remain `$${SOME_API_KEY}` in the HelmRelease. Flux turns them into `${SOME_API_KEY}` for
Dynacat to expand from the shared Secret. Do not substitute real API keys into Git or validation output.

Existing integrations include Uptime Kuma's `/api/status-page/heartbeat/<slug>` endpoint and Jellyfin's `/Sessions`
endpoint for Now Playing. These remain custom API widgets.

Migration check on 2026-09-15 found the existing Jellyfin widget credential returns HTTP 401 for `/Items/Counts`,
`/Users`, and `/Sessions`; the old dashboard showed the same empty results. Renew the shared `JELLYFIN_API_KEY`
through the encrypted-secret workflow to restore these widgets. This migration preserves the existing credential.

## Retirement cleanup

Removing the old GitOps resources does not guarantee every generated object disappears. During this migration,
cert-manager left an unreferenced TLS Secret without an owner reference. external-dns removed the CNAME and its
current prefixed ownership TXT on the next five-minute sync, but a legacy ownership TXT at the bare hostname survived.
Both orphan objects were removed after checking their exact ownership and confirming no current consumer remained.
For future retirements, inspect the generated Secrets and authoritative DNS as well as Flux/Helm readiness; DNS API
changes can take a short time to reach all authoritative servers.

## Verification

Before push, render the Flux substitutions, Helm chart, and embedded dashboard YAML. Validate the resulting config
with the pinned Dynacat version using dummy API keys. After push:

```bash
flux reconcile kustomization dynacat -n flux-system --with-source
flux get kustomizations -n flux-system | rg dynacat
kubectl get helmrelease dynacat -n default
kubectl rollout status deployment/dynacat -n default --timeout=180s
curl -fsS https://rangoonpulse.khzaw.dev/api/healthz
curl -I https://rangoonpulse.khzaw.dev/
```

Also open Home, Health, and Media in the browser and inspect the live event stream. The health endpoint alone is
insufficient: Dynacat can also expose it during its first-run setup screen. Verify actual configured pages and widgets.

Upstream references: [3.0.0 release](https://github.com/Panonim/dynacat/releases/tag/3.0.0),
[dynamic updates](https://github.com/Panonim/dynacat/blob/3.0.0/docs/docs/dynamic-updates.md),
[configuration](https://github.com/Panonim/dynacat/blob/3.0.0/docs/docs/configuration.md), and
[editor switch](https://github.com/Panonim/dynacat/blob/3.0.0/docs/docs/docker-options.md#enable_editor).
