# rangoonpulse

Infrastructure-as-code for my homelab Kubernetes cluster, managed with Flux CD GitOps.

## Philosophy

- GitOps-first: everything is reconciled via Flux (`Kustomization` + `HelmRelease`).
- Keep it boring and repeatable: prefer declarative HelmRelease values over imperative changes.
- Unified access model: a single ingress VIP on LAN, plus remote access via Tailscale subnet routing.
- Node-local storage is treated as limited: prefer TrueNAS NFS-backed PVCs for stateful workloads.
- Explicit resource requests/limits, plus automated suggestions via in-cluster CronJobs.

## Tech Stack

- Talos Linux + Kubernetes
- Flux CD v2 (GitOps)
- Helm + Kustomize (app delivery)
- ingress-nginx + MetalLB (ingress VIP)
- Cloudflare DNS + external-dns + cert-manager (Let's Encrypt)
- Tailscale operator (subnet router via `Connector`)
- Storage: TrueNAS SCALE NFS via democratic-csi, with selective use of `local-path`
- Monitoring: Prometheus + Grafana
- Dashboards: Homepage + Glance
- Uptime: Uptime Kuma

## Access (LAN + Tailscale)

- Kubernetes apps: Cloudflare DNS resolves `*.khzaw.dev` to a single ingress VIP (`10.0.0.231`), and ingress-nginx routes by Host header.
- Remote access: tailnet clients reach the same `10.0.0.x` destinations via Tailscale subnet routing (`infrastructure/tailscale-subnet-router/connector.yaml`).
- Advertised host routes: `10.0.0.197/32` (Talos/K8s API), `10.0.0.231/32` (ingress), `10.0.0.210/32` (TrueNAS), `10.0.0.1/32` (router)
- LAN devices behind ingress: `nas.khzaw.dev` / `router.khzaw.dev` terminate TLS at ingress and proxy to static Endpoints (`infrastructure/lan-gateway/`).
- Gotcha: if NFS PVCs suddenly fail, first check the TrueNAS Tailscale app has "Accept Routes" disabled (see `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`).

## Hardware

- Kubernetes node:
  - Lenovo ThinkCentre M720q
  - Intel Core i5-8400T (6c/6t)
  - 32 GiB RAM (2x16 GiB)
  - 512 GB NVMe (Samsung)
  - Intel iGPU (VAAPI via `/dev/dri`)
- NAS:
  - TrueNAS SCALE (exports NFS for PVCs)

## Screenshots

### Homepage

![Homepage 1](.github/screenshots/homepage.png)

![Homepage 2](.github/screenshots/homepage-2.jpeg)

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
