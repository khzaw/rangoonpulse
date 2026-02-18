# rangoonpulse

Infrastructure-as-code for my homelab Kubernetes cluster, managed with Flux CD GitOps.

- 🌐 Unified access: LAN + Tailscale clients both hit ingress at `10.0.0.231`
- 🖥️ Two-node Talos cluster: primary x86_64 node + small ARM64 Raspberry Pi utility node

## ✨ Highlights

- GitOps-first: everything reconciles via Flux (`Kustomization` + `HelmRelease`).
- One ingress VIP for LAN and remote (Tailscale subnet routing; no separate tailnet ingress proxy).
- Storage policy: prefer NAS-backed PVCs; use `local-path` only when it’s clearly the better option (DBs, SQLite, hot caches).
- Automated tuning: in-cluster Resource Advisor CronJobs generate safe, budgeted resource PRs.
- Scheduling policy: userland apps are pinned to the primary node by default; a small allowlist runs on the Raspberry Pi.

## 🧩 Nodes

| Node | Role | Arch | CPU | RAM | Notes |
| --- | --- | --- | --- | --- | --- |
| `talos-7nf-osf` (`10.0.0.197`) | control-plane + primary workloads | `amd64` | i5-8400T (6c/6t) | 32 GiB | NVMe + Intel iGPU (`/dev/dri`) |
| `talos-uua-g6r` (`10.0.0.38`) | utility workloads | `arm64` | 4 cores | 8 GiB | Runs Glance + AdGuard + Profilarr + ChartDB + Uptime Kuma |

## 🧱 Stack

- Talos Linux + Kubernetes
- Flux CD v2
- Helm + Kustomize
- ingress-nginx + MetalLB
- Cloudflare DNS + external-dns + cert-manager (Let's Encrypt)
- Tailscale operator + subnet router (`Connector`)
- Storage: TrueNAS SCALE NFS via democratic-csi, plus `local-path` when justified
- Monitoring: Prometheus + Grafana
- Dashboard: Glance
- Uptime: Uptime Kuma
- DNS filtering: AdGuard Home

## 🧩 Services

### Core

- 🛡️ AdGuard Home
- 🧭 Glance
- ⏱️ Uptime Kuma
- 📈 Grafana
- ⚡ Speedtest
- 🧪 Resource Advisor

### Media and Library

- 🎬 Jellyfin
- 📸 Immich
- 🎟️ Seerr
- 🎧 Audiobookshelf
- 📚 Calibre (Web)
- 🖥️ Calibre (VNC)

### Media Automation

- 🧲 autobrr
- 🧭 profilarr
- 🧰 prowlarr
- 📺 sonarr
- 🎞️ radarr
- 🧾 bazarr
- 🧱 sabnzbd
- 🧲 transmission
- 🧪 tracerr

### Live TV and Playback Tools

- 📺 nodecast-tv
- 🧠 Jellystat
- 🧩 iSponsorBlockTV
- 🎞️ Tunarr
- 📼 ErsatzTV

### Productivity and Utilities

- 💸 Actual Budget
- 🔐 Vaultwarden
- 📊 ChartDB

### LAN Gateway

- 🗄️ NAS
- 🌐 Router

## 🛠️ Ops Cheatsheet

```bash
# Flux health
flux get kustomizations
flux get hr -A

# Reconcile a component
flux reconcile kustomization <name> --with-source

# Cluster triage
kubectl get pods -A
kubectl get events -A --sort-by=.lastTimestamp | tail -n 50
```

Gotcha:
- If NFS PVCs suddenly fail, check the TrueNAS Tailscale app has **"Accept Routes" disabled** to avoid asymmetric routing.

## 📸 Screenshots

### Dashboard (Glance)

![Dashboard 1](.github/screenshots/homepage.png)

![Dashboard 2](.github/screenshots/homepage-2.jpeg)

### Jellyfin

![Jellyfin 1](.github/screenshots/jellyfin.jpeg)

![Jellyfin 2](.github/screenshots/jellyfin-2.jpeg)

### Sonarr

![Sonarr](.github/screenshots/sonarr.jpeg)

### Radarr

![Radarr](.github/screenshots/radarr.jpeg)

### Calibre

![Calibre](.github/screenshots/calibre.jpeg)

### NAS

![NAS](.github/screenshots/truenas.jpeg)

### Grafana

![Grafana](.github/screenshots/grafana.jpeg)

### Uptime

![Uptime](.github/screenshots/uptime.jpeg)
