# rangoonpulse

Infrastructure-as-code for a two-node Talos Kubernetes homelab managed with Flux.

## Architecture

### Nodes

| Node | Role | Architecture | Address |
|---|---|---|---|
| `talos-7nf-osf` | Control plane and primary workloads | `amd64` | `10.0.0.197` |
| `talos-uua-g6r` | Utility workloads | `arm64` | `10.0.0.38` |

The canonical values live in `flux/cluster-settings.yaml`. Query Kubernetes for live health and versions; this README does not duplicate volatile status.

### Access Paths

Private services:

```text
LAN or Tailscale -> MetalLB ingress VIP -> ingress-nginx -> Service -> workload
```

Permanently public sites:

```text
Cloudflare -> Cloudflare Tunnel -> in-cluster Service
```

Temporary public shares:

```text
Cloudflare -> Tunnel -> exposure-control -> enabled target Service
```

The public paths normally bypass MetalLB and ingress-nginx. See `docs/networking.md`.

### Storage

- `truenas-nfs`: default relocatable persistent data
- `truenas-hdd-media`: large media datasets
- `truenas-nvme-downloads`: download workload data
- `local-path`: latency-sensitive databases, SQLite, Prometheus/Grafana state, and caches

`local-path` is node-affined. It is chosen deliberately where NFS latency or locking semantics are unsafe, not because it is easier.

## Active Platform

### Core And Operations

- Flux CD and Flux Operator UI
- ingress-nginx and MetalLB
- cert-manager and ExternalDNS
- Tailscale Operator and subnet/exit Connector
- dual AdGuard Home DNS
- Cloudflare Tunnel public edge
- exposure-control/operator cockpit
- Prometheus, Alertmanager, Grafana, node exporter, and Metrics Server
- Resource Advisor reporting and apply-PR automation
- TrueNAS storage through democratic-csi

### Applications

Media and automation:

- Jellyfin, Immich, Seerr, Audiobookshelf
- Sonarr, Radarr, Bazarr, Subarr, Prowlarr, Profilarr, Jackett
- Transmission, SABnzbd, autobrr, Flaresolverr, Tracerr
- Shelfmark, BookOrbit, and RomM

TV and device services:

- Nodecast TV, Tunarr, and iSponsorBlockTV

Productivity and personal services:

- Actual Budget, Reactive Resume, Vaultwarden, ChartDB, and BentoPDF
- Obsidian LiveSync and Anki sync
- Interview Prep, Retirement, and 75 Soft
- Blog, MMCal, Rangoon Mapper, and Erica Knight

Dashboards and tools:

- Dynacat, Uptime Kuma, Speedtest Tracker, Kroki, and Flux UI

The active desired-state inventory is `flux/kustomization.yaml`. Directories not included there are not live merely because source files remain in the tree.

## Operator Surfaces

- `controlpanel.khzaw.dev`: exposure control, Pulse telemetry, travel readiness, self-built deploy actions, Transmission routing, image/chart updates, managed CronJobs, secrets, and tuning
- `rangoonpulse.khzaw.dev`: Dynacat dashboard
- `grafana.khzaw.dev`: monitoring dashboards
- `fluxui.khzaw.dev`: Flux Operator UI

Most canonical `*.khzaw.dev` services are private to LAN/Tailscale. Public availability must be explicit in `infrastructure/public-edge/`.

## Repository Layout

```text
apps/                         user-facing workloads
core/                         cluster-wide foundations
infrastructure/               storage, monitoring, DNS, access, secrets, automation
flux/                         sources, reconciliation units, shared settings
  cluster-settings.yaml       shared non-secret constants
  kustomizations/             component reconciliation boundaries
talos/                        Talos templates and node patches
docs/                         current operating guidance
.agents/skills/               repository procedures and safety gates
scripts/                      validation and operator tooling
native/iris/                  macOS host telemetry and independent cluster sentinel
```

Start with `AGENTS.md`, then `docs/README.md`.

## GitOps Rules

- Git is the source of permanent desired state.
- Use SOPS-encrypted Secret manifests under `infrastructure/secrets/`.
- Put shared non-secret constants in `flux/cluster-settings.yaml`.
- Use explicit ExternalDNS ownership; this deployment ignores Ingress rule/TLS host fields.
- Keep redundant critical services, such as the two AdGuard instances, in separate rollout units.
- Preserve runtime-owned state ConfigMaps outside Flux ownership where the operator cockpit needs reversible controls.
- New services include the operator integrations in `docs/service-onboarding.md`.
- Resource and replica changes must pass `docs/cpu-headroom-validation.md`; capacity snapshots live only on the runtime `capacity-state` branch, which must never be merged into `master`.

## Common Commands

```bash
# Validate the repository
make validate-all

# Flux status
flux get sources all -A
flux get kustomizations -A
flux get helmreleases -A

# Reconcile one component
flux reconcile kustomization <name> -n flux-system --with-source

# Cluster status
kubectl get nodes -o wide
kubectl get pods -A
kubectl get events -A --sort-by=.lastTimestamp
kubectl top nodes
```

See `docs/ops-command-cheatsheet.md` for day-two commands.

## Self-Built Image Promotion

Flux image automation manages independent flows for:

- Blog
- MMCal
- Erica Knight
- Interview Prep
- Retirement
- Rangoon Mapper

Normal promotion is asynchronous after the source repository publishes an image. Request immediate promotion with:

```bash
make deploy-blog
make deploy-mmcal
make deploy-ericaknight
make deploy-itvp
make deploy-retirement
make deploy-rangoon-mapper
```

Image automation may commit to remote `master`; fetch and fast-forward after running a deploy target.

## Current Non-Obvious Constraints

- Keep TrueNAS Tailscale **Accept Routes** disabled to avoid asymmetric NFS/API routing.
- ExternalDNS currently uses the legacy annotation prefix explicitly; migrate all annotations atomically before removing the compatibility flag.
- `iris.khzaw.dev` and `athena.khzaw.dev` share a dedicated edge VIP for Mac mini services; Iris SSH is exposed on the same VIP through a separate LoadBalancer Service.
- Transmission's VPN sidecar is scaffolded but still contains placeholder network material; direct mode is the safe default.
- The generated Flux controller manifest is not part of the ordinary root reconciliation path and requires an explicit controlled apply during controller upgrades.
- Iris runs OpenClaw and Hermes as native macOS processes. `docs/iris-operations.md` covers launchd supervision, host metrics, readiness, and the independent cluster sentinel.

## Documentation

`docs/README.md` indexes active operating guidance only. Completed plans, migrations, incident timelines, and rejected alternatives belong in Git history, not the current docs corpus.
