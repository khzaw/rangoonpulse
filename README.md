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
| `talos-uua-g6r` (`10.0.0.38`) | utility workloads | `arm64` | 4 cores | 8 GiB | Runs Glance + AdGuard + Profilarr |

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

- 🛡️ AdGuard Home: [adguard.khzaw.dev](https://adguard.khzaw.dev)
- 🧭 Glance: [glance.khzaw.dev](https://glance.khzaw.dev) ([hq.khzaw.dev](https://hq.khzaw.dev))
- 🎬 Jellyfin: [jellyfin.khzaw.dev](https://jellyfin.khzaw.dev)
- 📸 Immich: [photos.khzaw.dev](https://photos.khzaw.dev)
- 🎟️ Seerr: [entertainment.khzaw.dev](https://entertainment.khzaw.dev)
- 🎧 Audiobookshelf: [audiobookshelf.khzaw.dev](https://audiobookshelf.khzaw.dev)
- 📚 Calibre (Web): [calibre.khzaw.dev](https://calibre.khzaw.dev)
- 🖥️ Calibre (VNC): [calibre-manage.khzaw.dev](https://calibre-manage.khzaw.dev)
- 💸 Actual Budget: [actual.khzaw.dev](https://actual.khzaw.dev)
- 🔐 Vaultwarden: [passwords.khzaw.dev](https://passwords.khzaw.dev)
- ⏱️ Uptime Kuma: [uptime.khzaw.dev](https://uptime.khzaw.dev)
- 📈 Grafana: [grafana.khzaw.dev](https://grafana.khzaw.dev) ([monitoring.khzaw.dev](https://monitoring.khzaw.dev))
- 🧪 Resource Advisor: [tuning.khzaw.dev](https://tuning.khzaw.dev)
- 🧲 autobrr: [autobrr.khzaw.dev](https://autobrr.khzaw.dev)
- 🧭 profilarr: [profilarr.khzaw.dev](https://profilarr.khzaw.dev)
- 🧰 prowlarr: [prowlarr.khzaw.dev](https://prowlarr.khzaw.dev)
- 📺 sonarr: [sonarr.khzaw.dev](https://sonarr.khzaw.dev)
- 🎞️ radarr: [radarr.khzaw.dev](https://radarr.khzaw.dev)
- 🧾 bazarr: [bazarr.khzaw.dev](https://bazarr.khzaw.dev)
- 🧱 sabnzbd: [sabnzbd.khzaw.dev](https://sabnzbd.khzaw.dev)
- 🧲 transmission: [torrent.khzaw.dev](https://torrent.khzaw.dev)
- 🧪 tracerr: [tracerr.khzaw.dev](https://tracerr.khzaw.dev)
- 📊 ChartDB: [chartsdb.khzaw.dev](https://chartsdb.khzaw.dev)
- 📺 nodecast-tv: [tv.khzaw.dev](https://tv.khzaw.dev)
- 🧠 Jellystat: [jellystat.khzaw.dev](https://jellystat.khzaw.dev)
- 🧩 iSponsorBlockTV: [sponsorblocktv.khzaw.dev](https://sponsorblocktv.khzaw.dev)
- 🎞️ Tunarr: [tunarr.khzaw.dev](https://tunarr.khzaw.dev)
- 📼 ErsatzTV: [ersatztv.khzaw.dev](https://ersatztv.khzaw.dev)
- 🗄️ NAS (LAN gateway): [nas.khzaw.dev](https://nas.khzaw.dev)
- 🌐 Router (LAN gateway): [router.khzaw.dev](https://router.khzaw.dev)

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
