# AGENTS.md - rangoonpulse

## Project Overview

Homelab Kubernetes infrastructure-as-code repository using GitOps practices with Flux CD.

## Tech Stack

- **Kubernetes**: Talos Linux cluster
- **GitOps**: Flux CD v2 with Kustomizations and HelmReleases
- **Helm Charts**: bjw-s app-template, various community charts
- **Infrastructure**: MetalLB, cert-manager, ingress-nginx, Tailscale operator
- **Storage**: Longhorn, democratic-csi, local-path
- **Monitoring**: Prometheus, Grafana, Loki
- **DNS/TLS**: Cloudflare (via Terraform/OpenTofu), Let's Encrypt
- **IaC**: OpenTofu (tofu-controller)

## Directory Structure

- `apps/` - Application deployments (media stack, tools)
- `core/` - Core cluster components (ingress-nginx)
- `flux/` - Flux CD configuration (kustomizations, repositories)
- `infrastructure/` - Infrastructure components (cert-manager, metallb, monitoring, storage, terraform)
- `talos/` - Talos Linux machine configs

## Conventions

For the most part, raw k8s manifest should not be applied directly. Follow the practices of GitOps.

### Kubernetes Manifests

- Use `helmrelease.yaml` + `kustomization.yaml` per app
- HelmReleases use `helm.toolkit.fluxcd.io/v2` API
- App-template chart from bjw-s-charts for most apps
- Namespace: `default` for apps, dedicated namespaces for infrastructure
- Ingress class: `nginx`
- TLS: cert-manager with `letsencrypt-prod` ClusterIssuer
- Domain: `*.khzaw.dev`

### YAML Style

- Use `---` document separator at file start
- Include yaml-language-server schema comments where applicable
- Timezone: `Asia/Singapore`

## Commands

```bash
# Validate manifests
kubectl apply --dry-run=client -f <file>

# Describe a helmrelease
kubectl describe hr <name>

# Flux reconciliation
flux reconcile kustomization flux-system --with-source

# Check Flux status
flux get all

# Talos cluster management
talosctl -n 10.0.0.197 <command>
```

## Adding New Applications

1. Create directory under `apps/<app-name>/`
2. Add `helmrelease.yaml` using app-template chart pattern
3. Add `kustomization.yaml` referencing the helmrelease
4. Add kustomization entry in `flux/kustomization.yaml`
5. Add flux kustomization in `flux/kustomizations/<app>.yaml`
