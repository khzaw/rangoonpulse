# CLAUDE.md - Rangoon Pulse

Homelab Kubernetes IaC repository managed with Flux CD GitOps.
Two-node Talos Linux cluster: primary amd64 + Raspberry Pi arm64.

## Repository Layout

```
apps/           # User-facing apps (namespace: default)
core/           # Core components (ingress-nginx)
infrastructure/ # Infra services (cert-manager, external-dns, metallb, monitoring, secrets, storage, tailscale)
flux/           # Helm repositories + Flux Kustomizations
  repositories/ # HelmRepository definitions
  kustomizations/ # Per-app Kustomization definitions
  kustomization.yaml # Root kustomization index
talos/          # Talos machine configuration
docs/           # Architectural notes, runbooks
scripts/        # Operational scripts
```

## Working Rules

- **GitOps only.** Never rely on `kubectl apply` for permanent changes. `--dry-run=client` is fine for validation.
- Prefer `HelmRelease` changes over raw manifests.
- Do not introduce separate `values.yaml` when config fits inline in `helmrelease.yaml`.
- Keep ingress, DNS annotation, and TLS settings aligned for every exposed app.
- Never commit plaintext passwords/API keys. Use SOPS + age encryption (`infrastructure/secrets/`).
- Keep resources explicit (requests + limits) for homelab capacity control.

## Commit Messages

Format: `<service>: <message>`

Examples:
- `jellyfin: enable hardware transcoding`
- `monitoring: fix nodeExporter disable key`
- `tailscale-operator: bump chart to latest stable`

## Adding a New App

1. Create `apps/<name>/helmrelease.yaml` and `apps/<name>/kustomization.yaml`
2. Create `flux/kustomizations/<name>.yaml`
3. Add entry in `flux/kustomization.yaml`
4. Most apps use `bjw-s-charts/app-template` chart

## Node Scheduling

- **Primary node** (`talos-7nf-osf`, amd64, `10.0.0.197`): default for all userland workloads
  - For `bjw-s-charts/app-template` (common v4):
    - `values.defaultPodOptionsStrategy: merge`
    - `values.defaultPodOptions.nodeSelector.kubernetes.io/hostname: talos-7nf-osf`
- **Raspberry Pi** (`talos-uua-g6r`, arm64, `10.0.0.38`): only for explicitly allowlisted apps
  - Currently allowed: cloudflared, exposure-control, glance, profilarr, adguard, chartsdb, uptime-kuma, speedtest, actualbudget, anki-server, flaresolverr
- `local-path` PVs are node-affined. Moving apps between nodes means wiping/recreating the PVC.

## Ingress & DNS Pattern

For any app with an external hostname:
- Ingress class: `nginx`
- Annotations required:
  - `external-dns.alpha.kubernetes.io/hostname: <host>.khzaw.dev` (DNS won't be created without this)
  - `cert-manager.io/cluster-issuer: letsencrypt-prod`
  - `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
- TLS section with matching hosts
- Domain: `*.khzaw.dev`

**Important:** external-dns ignores `spec.rules[].host` and `spec.tls[].hosts`. You must use the annotation.

## Storage Classes

| Class | Backing | Use For |
|-------|---------|---------|
| `truenas-nfs` | TrueNAS NFS | Default for app/config PVCs (expandable) |
| `truenas-hdd-media` | TrueNAS NFS | Large media (Immich photos) |
| `local-path` | Node-local | Databases, hot caches (low-latency, node-affined) |

`truenas-hdd-config` is retired. Use `truenas-nfs` instead.

## Secrets

- Encrypted with **SOPS + age** under `infrastructure/secrets/`
- SOPS config: `.sops.yaml`
- Flux decryption key: `flux-system/sops-age`
- Dashboard widget API keys: `homepage-widget-secrets` secret, consumed by Glance via `envFrom`
- Full inventory: `docs/secrets-inventory.md`

## Key Infrastructure Details

- **Ingress VIP:** `10.0.0.231` (MetalLB)
- **LAN DNS:** AdGuard Home at `10.0.0.233:53` (router DHCP points clients here)
- **Remote access:** Tailscale subnet router advertising `10.0.0.197/32`, `10.0.0.231/32`, `10.0.0.210/32`, `10.0.0.1/32`
- **Public exposure:** Cloudflare Tunnel via `infrastructure/public-edge/` + `apps/exposure-control/`
- **Monitoring:** Prometheus + Grafana (`grafana.khzaw.dev` / `monitoring.khzaw.dev`)
- **Timezone:** `Asia/Singapore`

## Operational Gotchas

- If NFS PVCs fail (democratic-csi probe timeout), check TrueNAS Tailscale app has "Accept Routes" **disabled**.
- democratic-csi controller runs `hostNetwork: true` to reach TrueNAS API at `10.0.0.210`.
- Glance custom-api templates: wrap in `{{\` ... \`}}` so Helm doesn't interpret Glance `{{ }}` syntax.
- `nodeExporter.enabled: false` is the correct key in the monitoring HelmRelease.
- Do not rename Kubernetes release/object names when PVC/state continuity matters (e.g., jellyseerr -> seerr migration).

## Useful Commands

```bash
flux get kustomizations                              # Flux health
flux get hr -A                                       # All HelmReleases
flux reconcile kustomization <name> --with-source    # Force reconcile
kubectl apply --dry-run=client -f <file>             # Validate manifest
kubectl get events -A --sort-by=.lastTimestamp        # Recent events
talosctl -n 10.0.0.197 dashboard                     # Talos node dashboard
```

## Documentation Updates

If you change conventions (networking, DNS, storage, secrets, app charts), update `AGENTS.md` and the relevant doc under `docs/`. Keep docs actionable with file paths, k8s object names, and concrete commands.
