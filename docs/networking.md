---
title: Networking and Access Topology
summary: Current private ingress, public Tunnel, temporary-share, DNS, and dedicated-edge paths.
status: active
owner: homelab
last_reviewed: 2026-11-22
---

# Networking and Access Topology

## Shared Settings

Network constants live in `flux/cluster-settings.yaml`. Do not duplicate them into app manifests.

Current roles:

- shared ingress VIP: `${INGRESS_VIP}`
- Transmission peer-to-peer VIP: `${TRANSMISSION_P2P_VIP}`
- Mac mini edge VIP: `${IRIS_VIP}`
- AdGuard DNS VIPs: `${ADGUARD_PRIMARY_IP}` and `${ADGUARD_SECONDARY_IP}`
- Tailscale Connector routes: router, both nodes, NAS, shared ingress VIP, Mac mini edge VIP, and both AdGuard DNS VIPs as `/32` routes

## Three Access Paths

### Private Services

```text
LAN or Tailscale client
  -> private DNS answer
  -> MetalLB shared ingress VIP
  -> ingress-nginx
  -> Ingress host/path rule
  -> Service
  -> pod or static Endpoint
```

Tailscale remote access uses `infrastructure/tailscale-subnet-router/connector.yaml`. The Connector is also an exit node. Keep the narrow `/32` advertisements unless broad LAN routing is an explicit design change.

MetalLB uses native speakers for Layer 2 announcements. Both `speaker.frr.enabled`
and `frrk8s.enabled` are explicitly disabled in `infrastructure/metallb/helmrelease.yaml`;
this topology needs no FRR routing pods. `infrastructure/metallb-config/` owns the
address pool and L2 advertisement. Introducing BGP requires reviewing the backend
choice as well as adding peer and advertisement configuration.

### Permanently Public Sites

```text
public DNS
  -> Cloudflare edge
  -> Cloudflare Tunnel
  -> in-cluster Service
```

`infrastructure/public-edge/helmrelease.yaml` owns Tunnel origin routes. `infrastructure/public-edge/share-hosts-cname.yaml` owns the proxied DNS aliases.

Current permanent origins are the `khzaw.dev` apex, `blog.khzaw.dev`, `mmcal.khzaw.dev`, `rangoonmapper.khzaw.dev`, `ericaknight.me`, and `www.ericaknight.me`. `www.khzaw.dev` is an external Cloudflare redirect/DNS concern, not an in-cluster origin.

The public path normally bypasses MetalLB and ingress-nginx.

### Temporary Public Shares

```text
share hostname
  -> Cloudflare edge and Access when configured
  -> Cloudflare Tunnel
  -> exposure-control
  -> allow/expiry/rate-limit checks
  -> selected in-cluster Service
```

A working share requires agreement between the exposure-control catalog, Tunnel route, and public DNS alias. Catalog presence alone is not public wiring.

## DNS Ownership

- Private app hostnames use explicit ExternalDNS annotations and normally resolve to the shared ingress VIP.
- Permanent-public and share hosts use proxied `ExternalName` Services under `infrastructure/public-edge/`.
- ExternalDNS intentionally ignores Ingress rule and TLS host fields. DNS ownership must be explicit.
- ExternalDNS currently reads the repository's `external-dns.alpha.kubernetes.io/` annotations through an explicit compatibility flag. Remove that flag only in the same atomic change that migrates every annotation.

LAN clients use the two AdGuard VIPs. Cluster and node DNS intentionally use public upstream resolution rather than depending on the LAN filtering path.

## Kubernetes API Access

External agent hosts use the existing Tailscale operator's authenticated API proxy,
separately from application ingress. Tailnet device tags map to Git-managed
Kubernetes RBAC profiles. Joining the tailnet alone does not grant cluster access.
See [agent access](./agent-access.md) for enrollment and recovery.

## Mac Mini Edge

`infrastructure/iris-edge/` exposes:

- `iris.khzaw.dev` to OpenClaw on the Mac mini
- `athena.khzaw.dev` to Hermes on the Mac mini
- SSH on `${IRIS_VIP}:22`

HTTPS uses ingress host routing; SSH uses a dedicated LoadBalancer Service. The Mac mini services remain responsible for their own authentication and origin policy after network routing succeeds.

## LAN Device Proxies

`infrastructure/lan-gateway/` uses selectorless Services plus static Endpoints for the NAS and router. Ingress-nginx terminates TLS and proxies to the LAN devices. Keep the static target IPs in `flux/cluster-settings.yaml`.

## Ingress Request Metrics

Patch 5 in `core/ingress-nginx/kustomization.yaml` enables controller metrics on
port `10254`. The cluster-internal `ingress-nginx-controller-metrics` Service
exposes them, and `infrastructure/monitoring/servicemonitor-ingress-nginx.yaml`
scrapes them every 60 seconds under job `ingress-nginx-controller-metrics`.

Prometheus keeps only these series:

- `nginx_ingress_controller_requests`: a counter labelled by `namespace`,
  `ingress`, `service`, `path`, `method`, and status class (`2xx` through `5xx`)
- `nginx_ingress_controller_config_last_reload_successful`
- `nginx_ingress_controller_nginx_process_connections`

The series budget is 1,000. The controller drops the host label, reports status
classes, and never computes the per-request size, bytes-sent, or duration
histograms (`--exclude-socket-metrics`). The ServiceMonitor keeps only the three
names above. It also drops request series with an empty `ingress` label, which
come from hosts no Ingress defines. Do not merge counter labels with
`labeldrop` or relabeling: series that collapse together collide and corrupt
counts. To change the series set, change the controller flags or the keep list,
then measure:

```promql
scrape_samples_post_metric_relabeling{job="ingress-nginx-controller-metrics"}
```

Requests per Ingress over 14 days:

```promql
sort_desc(sum by (namespace, ingress) (increase(nginx_ingress_controller_requests[14d])))
```

Limits:

- Only traffic through ingress-nginx is counted: LAN, Tailscale, and the Mac mini edge hosts. Permanent-public sites and temporary shares use Cloudflare Tunnel and do not appear.
- The metrics have no user-agent or client label, so health checks cannot be separated from use. Gatus checks most private hosts through the ingress VIP. A check every N seconds adds 1,209,600 / N requests per 14 days: 20,160 at 60 seconds and 4,032 at 5 minutes. Dynacat Health monitors add more. Treat an Ingress whose count is near its checker floor as unused.
- History starts when the metrics were enabled on 2026-11-22. The first full 14-day window ends on 2026-12-06.

## Current Constraints

- Keep TrueNAS Tailscale **Accept Routes** disabled. Enabling it can create asymmetric return paths and break NFS or management API traffic from cluster nodes.
- MetalLB only advertises service IPs. Host and path routing begins in ingress-nginx or Cloudflare Tunnel.
- Do not add another access plane unless it replaces a defined current path. Parallel proxy stacks increase DNS ownership, policy, and failure ambiguity.

## Verification

```bash
kubectl get svc -A | grep -E 'LoadBalancer|ExternalName'
kubectl get ingress -A
kubectl get connector homelab-subnet-router -o yaml
flux get kustomizations -n flux-system

dig @1.1.1.1 +short <host>
curl -I --max-time 20 https://<host>/
```

For a private host with stale local DNS, isolate ingress from resolution:

```bash
curl -Ik --resolve <host>:443:10.0.0.231 https://<host>/
```
