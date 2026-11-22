---
title: DNS And Access Paths Dashboard
summary: AdGuard checks, Tailscale router placement and resources, CoreDNS health, and ingress inventory.
status: active
owner: homelab
last_reviewed: 2026-11-22
---

# DNS And Access Paths Dashboard

This dashboard combines AdGuard and router telemetry with CoreDNS health and
ingress inventory so you can answer:

- are both AdGuard private DNS checks succeeding, and how long do they take
- are both DNS router pods ready on two distinct Ready nodes
- where are the routers running, and what CPU and memory do they use
- is cluster DNS healthy
- are forwarders failing
- how many hosts are exposed through ingress
- which access paths are LoadBalancer or ExternalName backed
- which ingress hosts are missing TLS

## GitOps Object

- Dashboard: `infrastructure/monitoring/grafana-dashboard-dns-access-paths.yaml`
- URL: <https://grafana.khzaw.dev/d/dns-access-paths>
- `Homelab Control Room` also shows resolver, router-pod, and router-node counts,
  each with an expected value of two and a link to this dashboard.

## DNS and router checks

The first section shows each AdGuard's latest Gatus DNS result, Gatus scrape
health, private DNS check latency, each router's readiness, distinct Ready-node
count, placement, and container CPU/memory. Router selection uses the generated
`ts-homelab-subnet-router-*` and `ts-homelab-dns-backup-*` pod names so replacement
pods remain visible. A router counts as ready only when both its pod and hosting
node are Ready. Node count falls to one when both routers share a node.

Gatus queries the private `gatus.${BASE_DOMAIN}` A record through each AdGuard VIP
every 60 seconds. These checks prove private DNS resolution from inside the
cluster; they do not exercise public upstream recursion or the iPhone's Tailscale
path. Gatus itself runs on the Pi. Its DNS results disappear from the panels when
its scrape fails instead of retaining a stale healthy result. Router readiness
and placement use kube-state-metrics independently; missing collector telemetry
is unknown, not healthy. Prometheus/Grafana still depend on the main node.

Pod/node readiness does not prove Tailscale tunnel reachability, route approval,
or successful forwarding. Both DNS `/32` routes must remain approved on both
routers. Verify remote DNS and failover with actual client-path checks described
in [AdGuard DNS](./adguard-dns-stack-overview.md#remote-dns-redundancy); there is no
continuous remote-client probe implied by these panels.

## Data Sources Used

- Gatus `gatus_results_endpoint_success` and `gatus_results_duration_seconds`
  for group `DNS`, gated by `up{job="gatus"}`
- kube-state-metrics pod readiness, node readiness, and pod/node/IP inventory,
  gated by its scrape health
- kubelet cAdvisor router CPU and working-set memory from `/metrics/cadvisor`
- CoreDNS metrics from job `coredns`
- ingress inventory from:
  - `kube_ingress_info`
  - `kube_ingress_path`
  - `kube_ingress_tls`
- service inventory from:
  - `kube_service_info`
- Prometheus DNS service discovery failure counter:
  - `prometheus_sd_dns_lookup_failures_total`

Per-Ingress request counters (`nginx_ingress_controller_requests`) are scraped
but not charted on this dashboard. See
[ingress request metrics](./networking.md#ingress-request-metrics) for the
labels, series budget, usage query, and health-check caveat.

## Verification

```bash

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get configmap -n monitoring grafana-dashboard-dns-access-paths -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'sum(rate(coredns_dns_requests_total[5m]))'
```

Grafana dashboard title: `DNS and Access Paths`.
