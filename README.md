# rangoonpulse

[![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![Talos](https://img.shields.io/badge/Talos%20Linux-6952F2?logo=linux&logoColor=white)](https://talos.dev/)
[![Flux](https://img.shields.io/badge/Flux%20CD-5468FF?logo=flux&logoColor=white)](https://fluxcd.io/)
[![GitOps](https://img.shields.io/badge/GitOps-Enabled-2E8B57?logo=git&logoColor=white)](#gitops-and-automation)
[![CI](https://github.com/khzaw/rangoonpulse/actions/workflows/ci.yaml/badge.svg)](https://github.com/khzaw/rangoonpulse/actions/workflows/ci.yaml)

> My homelab, defined in Git: two Talos Kubernetes nodes, TrueNAS storage, and Flux keeping everything in sync.

Media, photos, books, personal apps, and the tools that keep them running. Most services stay on LAN and Tailscale; public sites and temporary shares have their own Cloudflare Tunnel routes.

[Architecture](#architecture) · [Hardware](#hardware) · [Services](#services) · [Screenshots](#screenshots) · [Operations](#operations) · [Docs](docs/README.md)

## Architecture

Private ingress, permanent public sites, and temporary shares follow three distinct paths:

```mermaid
flowchart TB
    accTitle: Homelab access paths
    accDescr: Private clients use MetalLB and ingress-nginx, while public sites and temporary shares use Cloudflare Tunnel.
    private["LAN / Tailscale clients"] --> vip["MetalLB ingress VIP<br/>10.0.0.231"]
    vip --> nginx["ingress-nginx<br/>Private host routing + TLS"]
    nginx --> apps["Private app Services"]

    internet["Internet clients"] --> cloudflare["Cloudflare edge"]
    cloudflare --> tunnel["Cloudflare Tunnel"]
    tunnel -->|Permanent site hosts| sites["Public site Services"]
    tunnel -->|Share hosts| exposure["exposure-control<br/>Share state + expiry checks"]
    exposure -->|When enabled| shared["Selected app Services"]

    classDef privatePath fill:#17324d,stroke:#6aa9dc,color:#fff
    classDef publicPath fill:#49321e,stroke:#e6a05b,color:#fff
    classDef sharePath fill:#293b2d,stroke:#82b78e,color:#fff
    class private,vip,nginx,apps privatePath
    class internet,cloudflare,tunnel,sites publicPath
    class exposure,shared sharePath
```

The public routes normally bypass MetalLB and ingress-nginx. Most canonical `*.khzaw.dev` app hosts stay private; a share needs matching DNS, Tunnel, and exposure-control configuration. See [networking](docs/networking.md) and [public edge and exposure control](docs/public-edge-and-exposure-control.md).

Dual AdGuard Home instances serve LAN DNS at `10.0.0.233` and `10.0.0.234`. Cluster and node DNS use separate public upstreams so they do not depend on the LAN filtering path.

### Hardware

| Node | Role | Architecture | Hardware | Address |
|---|---|---|---|---|
| `talos-7nf-osf` | Control plane and primary workloads | `amd64` | 6 CPU cores · 32 GB RAM · Intel iGPU for media | `10.0.0.197` |
| `talos-uua-g6r` | Utility workloads | `arm64` | Raspberry Pi · 4 CPU cores · 8 GB RAM | `10.0.0.38` |

TrueNAS at `10.0.0.210` provides shared storage. The Mac mini at `10.0.0.66` runs OpenClaw and Hermes as native macOS processes, with Kubernetes proxying their HTTPS hosts through the dedicated edge VIP `10.0.0.235`. Iris SSH uses that same VIP through a separate LoadBalancer Service.

Node names, addresses, and other shared constants live in [cluster settings](flux/cluster-settings.yaml). Query Kubernetes for live health and versions rather than relying on a README status snapshot.

### Storage

[![TrueNAS](https://img.shields.io/badge/TrueNAS-0095D5?logo=truenas&logoColor=white&style=flat-square)](https://www.truenas.com/)
[![democratic-csi](https://img.shields.io/badge/democratic--csi-326CE5?logo=kubernetes&logoColor=white&style=flat-square)](https://github.com/democratic-csi/democratic-csi)
[![SOPS](https://img.shields.io/badge/SOPS-333333?style=flat-square)](https://github.com/getsops/sops)
[![age](https://img.shields.io/badge/age-F5C451?style=flat-square)](https://age-encryption.org/)

| Storage class | Purpose |
|---|---|
| `truenas-nfs` | Default relocatable storage for ordinary persistent data, books, and audiobooks |
| `truenas-hdd-media` | Large shared media datasets |
| `truenas-nvme-downloads` | Shared download workload data |
| `local-path` | Latency-sensitive databases, SQLite, Prometheus/Grafana state, and caches |

`local-path` is node-affined: moving a workload requires moving its data, not just changing its node selector. See [data protection](docs/data-protection.md) for backup coverage and recovery gaps.

## Highlights

| Feature | How it works here |
|---|---|
| **GitOps first** | Flux reconciles Kustomizations and HelmReleases from this repository. |
| **Private by default** | LAN and Tailscale clients share an ingress VIP; public access is explicitly wired through Cloudflare Tunnel. |
| **Two architectures** | An AMD64 primary node handles the heavier workloads; an ARM64 Raspberry Pi runs utility services. |
| **Storage by workload** | TrueNAS provides shared files and media; node-local storage handles latency-sensitive databases and caches. |
| **Resource tuning** | Resource Advisor uses Prometheus data to propose budgeted resource changes through pull requests. |
| **Operator cockpit** | Exposure controls, telemetry, deploy actions, jobs, secrets, and tuning in one private control panel. |
| **Encrypted secrets** | SOPS + age protects Git-managed secrets; Flux decrypts them in the cluster. |

## Services

This is the desired-state overview. [The Flux reconciliation tree](flux/kustomization.yaml) owns the active inventory; a leftover directory alone does not make a service deployed.

### Platform and operations

[![Helm](https://img.shields.io/badge/Helm-0F1689?logo=helm&logoColor=white&style=flat-square)](https://helm.sh/)
[![NGINX](https://img.shields.io/badge/NGINX-009639?logo=nginx&logoColor=white&style=flat-square)](https://nginx.org/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white&style=flat-square)](https://www.cloudflare.com/)
[![Tailscale](https://img.shields.io/badge/Tailscale-242424?logo=tailscale&logoColor=white&style=flat-square)](https://tailscale.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white&style=flat-square)](https://prometheus.io/)
[![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white&style=flat-square)](https://grafana.com/)

| Area | Components |
|---|---|
| **Delivery** | Flux CD, Helm, Flux Operator UI, image automation, Renovate |
| **Networking** | ingress-nginx, MetalLB, cert-manager, ExternalDNS, Tailscale Operator and subnet/exit Connector |
| **DNS and public edge** | Dual AdGuard Home, Cloudflare Tunnel, exposure-control |
| **Observability** | Prometheus, Alertmanager, Grafana, node exporter, Metrics Server, Uptime Kuma |
| **Operations** | Resource Advisor, operator cockpit, native Iris telemetry and independent cluster sentinel |
| **Storage** | TrueNAS, democratic-csi, local-path provisioner |

### Media and library

| Service | Purpose |
|---|---|
| **Jellyfin** | Media streaming with Intel iGPU access |
| **Immich** | Photo and video library |
| **Seerr** | Media requests |
| **Audiobookshelf** | Audiobooks and podcasts |
| **Shelfmark** | Book and audiobook downloads |
| **BookOrbit** | E-book library and web reader |
| **[RomM](docs/romm.md)** | ROM library, metadata, and browser emulation |

### Automation and TV

| Area | Services |
|---|---|
| **Library management** | Sonarr, Radarr, Profilarr |
| **Indexers and discovery** | Prowlarr, Jackett, autobrr, Flaresolverr |
| **Downloads** | Transmission, SABnzbd |
| **Subtitles** | Bazarr, Subarr |
| **Playback analytics** | Tracerr / Tracearr |
| **TV and devices** | Nodecast TV, Tunarr, iSponsorBlockTV |

Transmission's optional VPN sidecar still contains placeholder network material; direct mode is the safe default. See [the routing contract](docs/transmission-optional-vpn.md).

### Personal apps and tools

| Area | Services |
|---|---|
| **Finance** | Actual Budget, Retirement |
| **Study and notes** | Interview Prep, Obsidian LiveSync, Anki sync |
| **Personal tools** | 75 Soft, Reactive Resume, Vaultwarden, ChartDB, BentoPDF |
| **Dashboards and utilities** | Dynacat, Speedtest Tracker, Kroki, Flux UI |
| **Self-built sites** | Blog, MMCal, Rangoon Mapper, Erica Knight |

### Operator surfaces

| Host | Purpose |
|---|---|
| `rangoonpulse.khzaw.dev` | Dynacat Home, Health, and Media dashboard |
| `controlpanel.khzaw.dev` | Exposure controls, Pulse telemetry, travel readiness, deploys, Transmission routing, updates, CronJobs, secrets, and tuning |
| `grafana.khzaw.dev` | Metrics and operations dashboards |
| `fluxui.khzaw.dev` | Flux sources, Kustomizations, HelmReleases, and reconciliation status |

These hosts use the private LAN/Tailscale access path.

## GitOps and automation

```mermaid
flowchart LR
    accTitle: GitOps delivery and resource tuning
    accDescr: Flux reconciles Git into workloads; image automation and Resource Advisor update desired state through commits and pull requests.
    git["This repository<br/>master"] --> flux["Flux CD"]
    flux -->|Kustomize + Helm| workloads["Cluster workloads"]
    prometheus["Prometheus<br/>Workload metrics"] --> advisor["Resource Advisor<br/>Resource tuning PRs"]
    advisor -->|Merge| git
    registry["Published<br/>self-built images"] --> images["Flux image<br/>automation"]
    images -->|Image tag commits| git

    classDef delivery fill:#17324d,stroke:#6aa9dc,color:#fff
    classDef tuning fill:#293b2d,stroke:#82b78e,color:#fff
    class git,flux,workloads,registry,images delivery
    class prometheus,advisor tuning
```

Resource Advisor proposes resource changes through PRs. Git/CI checks render affected workloads and validate CPU headroom, rollout reserves, and scheduled-job allowances. HPA maximum replicas are checked separately. There is no live admission webhook. See [Resource Advisor](docs/resource-advisor.md) and [CPU headroom validation](docs/cpu-headroom-validation.md).

Permanent desired state belongs in Git. Git-managed secrets stay SOPS-encrypted under `infrastructure/secrets/`; runtime-owned cockpit state stays outside Flux where controls need to be reversible. The two AdGuard instances use separate rollout units.

## Screenshots

Saved UI captures, not live status. The Dynacat views were captured on 27 October 2026; the other images are existing gallery captures, so their metrics, app versions, and library contents may differ from today's setup.

### Dynacat dashboard

![Dynacat Home with bookmarks and cluster telemetry](.github/screenshots/dynacat-home.jpg)

<details>
<summary>Dynacat service health</summary>

![Dynacat Health with service monitors and download-stack health](.github/screenshots/dynacat-health.jpg)

</details>

### Jellyfin

![Jellyfin media library](.github/screenshots/jellyfin.webp)

<details>
<summary>More from Jellyfin</summary>

![Jellyfin library detail view](.github/screenshots/jellyfin-2.webp)

</details>

<details>
<summary>Sonarr and Radarr</summary>

![Sonarr TV library](.github/screenshots/sonarr.webp)

![Radarr movie library](.github/screenshots/radarr.webp)

</details>

<details>
<summary>Grafana and Uptime Kuma</summary>

![Grafana Kubernetes resource dashboard](.github/screenshots/grafana.webp)

![Uptime Kuma monitoring dashboard](.github/screenshots/uptime.webp)

</details>

<details>
<summary>TrueNAS storage</summary>

![TrueNAS storage dashboard](.github/screenshots/truenas.webp)

</details>

## Repository layout

```text
.
├── apps/                         User-facing workloads
├── core/                         Cluster-wide foundations
├── infrastructure/               Storage, monitoring, DNS, access, secrets, automation
├── flux/                         Sources and reconciliation tree
│   ├── cluster-settings.yaml     Shared non-secret constants
│   └── kustomizations/           Component reconciliation boundaries
├── docs/                         Current operating guidance
├── .agents/skills/               Repository procedures and safety gates
├── scripts/                      Validation and operator tooling
├── native/iris/                  Native macOS telemetry and cluster sentinel
└── AGENTS.md                     Agent session entrypoint
```

Talos node lifecycle is managed separately from Flux; generated machine configuration and local operator files are not tracked in this repository. See [Kubernetes upgrades](docs/kubernetes-upgrade.md).

## Operations

Start with [AGENTS.md](AGENTS.md) and the [docs index](docs/README.md). Shared settings belong in [cluster settings](flux/cluster-settings.yaml); literal runtime placeholders use `$${VAR}` when Flux substitution is active.

### Common commands

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

See the [operations cheatsheet](docs/ops-command-cheatsheet.md) for day-two commands.

### Self-built image promotion

Blog, MMCal, Erica Knight, Interview Prep, Retirement, and Rangoon Mapper each have an independent Flux image-promotion flow. Normal promotion happens asynchronously after the source repository publishes an image. For immediate promotion:

```bash
make deploy-blog
make deploy-mmcal
make deploy-ericaknight
make deploy-itvp
make deploy-retirement
make deploy-rangoon-mapper
```

Image automation can commit to remote `master`; fetch and fast-forward after running a deploy target.

### Operating constraints

- Keep TrueNAS Tailscale **Accept Routes** disabled to avoid asymmetric NFS/API routing.
- ExternalDNS uses explicit hostname annotations and the legacy annotation-prefix compatibility flag; migrate annotations atomically before removing it.
- The generated Flux controller manifest is outside ordinary root reconciliation and requires a controlled apply during controller upgrades.
- Capacity snapshots live only on the runtime `capacity-state` branch, which must never be merged into `master`.
- New services include the integrations in [service onboarding](docs/service-onboarding.md).

## Documentation

| Guide | What it covers |
|---|---|
| [Docs index](docs/README.md) | All current operating guidance |
| [Architecture](docs/architecture.md) | Sources of truth and cross-cutting configuration |
| [Networking](docs/networking.md) | Private ingress, public Tunnel, DNS, and edge exceptions |
| [AdGuard DNS](docs/adguard-dns-stack-overview.md) | Dual DNS architecture and rollout safety |
| [Resource Advisor](docs/resource-advisor.md) | Reporting, tuning policy, and apply-PR automation |
| [CPU headroom](docs/cpu-headroom-validation.md) | Git/CI and live capacity preflights |
| [Data protection](docs/data-protection.md) | Backup coverage, recovery, and gaps |
| [Secrets](docs/secrets-management.md) | SOPS, Flux, cockpit editing, and key lifecycle |
| [Iris operations](docs/iris-operations.md) | Native macOS processes, readiness, and independent monitoring |

Docs describe the current implementation and operating contract. Superseded designs, completed plans, and incident chronology remain in Git history.
