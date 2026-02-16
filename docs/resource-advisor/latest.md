# Resource Advisor Report

- Generated at: `2026-02-16T10:07:59Z`
- Mode: `apply-pr`
- Metrics window: `14d`
- Metrics coverage estimate: `1.77` days
- Containers analyzed: **32**
- Containers with metrics: **32**
- Recommendations: **29**

## Cluster Budget Snapshot

- Allocatable CPU: `9900m`
- Allocatable Memory: `38522Mi`
- Current requests as % allocatable CPU: `32.4`
- Current requests as % allocatable Memory: `26.8`
- Recommended requests as % allocatable CPU: `29.4`
- Recommended requests as % allocatable Memory: `27.9`

## Data Maturity Notice

Prometheus coverage is below 14 days. Use extra caution for downsizing decisions until the 14-day window is fully populated.

## Recommendations

| Namespace | Workload | Container | CPU req | CPU rec | Mem req | Mem rec | Action | Notes |
|---|---|---|---:|---:|---:|---:|---|---|
| monitoring | kube-prometheus-stack-kube-state-metrics | kube-state-metrics | 10m | 12m | 64Mi | 80Mi | upsize | restart_guard,downscale_excluded |
| monitoring | prometheus-kube-prometheus-stack-prometheus | config-reloader | 0m | 25m | 0Mi | 64Mi | upsize | restart_guard |
| monitoring | prometheus-kube-prometheus-stack-prometheus | prometheus | 50m | 62m | 400Mi | 500Mi | upsize | restart_guard |
| default | jellyseerr | main | 75m | 56m | 192Mi | 240Mi | upsize | restart_guard |
| monitoring | kube-prometheus-stack-grafana | grafana-sc-dashboard | 0m | 27m | 0Mi | 96Mi | upsize | restart_guard,downscale_excluded |
| monitoring | kube-prometheus-stack-grafana | grafana-sc-datasources | 0m | 32m | 0Mi | 94Mi | upsize | restart_guard,downscale_excluded |
| default | bazarr | main | 100m | 75m | 256Mi | 320Mi | upsize | - |
| default | calibre | main | 150m | 112m | 512Mi | 640Mi | upsize | - |
| default | homepage | homepage | 50m | 38m | 128Mi | 157Mi | upsize | - |
| default | immich-server | main | 200m | 200m | 768Mi | 960Mi | upsize | downscale_excluded |
| default | jellyfin | main | 400m | 400m | 1024Mi | 1280Mi | upsize | downscale_excluded |
| default | prowlarr | main | 100m | 75m | 256Mi | 277Mi | upsize | - |
| default | radarr | main | 100m | 75m | 256Mi | 318Mi | upsize | - |
| default | sabnzbd | main | 150m | 188m | 512Mi | 384Mi | upsize | - |
| default | sonarr | main | 100m | 75m | 256Mi | 284Mi | upsize | - |
| default | uptime-kuma | main | 50m | 46m | 128Mi | 160Mi | upsize | - |
| monitoring | kube-prometheus-stack-operator | kube-prometheus-stack | 20m | 25m | 64Mi | 64Mi | upsize | downscale_excluded |
| monitoring | kube-prometheus-stack-grafana | grafana | 100m | 100m | 256Mi | 256Mi | no-change | restart_guard,downscale_excluded |
| default | actualbudget | actualbudget | 50m | 38m | 128Mi | 96Mi | downsize | - |
| default | audiobookshelf | main | 75m | 56m | 256Mi | 192Mi | downsize | - |
| default | calibre-web-automated | main | 75m | 56m | 256Mi | 241Mi | downsize | - |
| default | flaresolverr | main | 150m | 112m | 512Mi | 384Mi | downsize | - |
| default | glance | main | 50m | 38m | 128Mi | 96Mi | downsize | - |
| default | jellystat | db | 100m | 75m | 256Mi | 242Mi | downsize | - |
| default | jellystat | main | 100m | 75m | 256Mi | 192Mi | downsize | - |
| default | notifiarr | main | 50m | 38m | 128Mi | 96Mi | downsize | - |
| default | transmission | main | 150m | 112m | 512Mi | 384Mi | downsize | - |
| default | tunarr | main | 200m | 150m | 512Mi | 384Mi | downsize | - |
| default | vaultwarden | main | 50m | 38m | 128Mi | 96Mi | downsize | - |
