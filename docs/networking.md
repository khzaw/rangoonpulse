---
title: Networking and Access Topology
summary: Current private ingress, public Tunnel, temporary-share, DNS, and dedicated-edge paths.
status: active
owner: homelab
last_reviewed: 2026-11-23
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

One node answers ARP for each address. A Service with `externalTrafficPolicy: Local`
is eligible only on nodes with a ready endpoint. A `Cluster` Service is eligible on
every node with a speaker. When more than one node is eligible, `default-l2` makes
the primary announce through `preferredNodeSelectors`, which requires MetalLB
0.16.2 or later. Without that preference, MetalLB announces from the node with the
lowest `sha256("<node>#<ip>")`, which is effectively arbitrary for each address.
If the primary's speaker leaves, the remaining eligible node announces.

The preference is pool-wide. Today it only decides `${IRIS_VIP}`, whose two
Services use `Cluster` policy. Every other LoadBalancer Service uses `Local` with
endpoints on one node, so the preference does not move them. A new `Cluster`
Service in `default-pool` is announced from the primary while the primary is up.
Do not scope announcements with `serviceSelectors` for shared addresses: MetalLB
does not announce an `allow-shared-ip` Service when an advertisement that matches
it has `serviceSelectors`.

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
  -> allow/expiry/rate-limit/Access-token checks
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

The primary announces `${IRIS_VIP}`, so web traffic enters on the node that runs
the controller. The utility node takes over the address, and SSH through it, while
the primary is down. See [Mac mini edge](./mac-mini-edge.md#announcement-and-failover).

## LAN Device Proxies

`infrastructure/lan-gateway/` uses selectorless Services plus static Endpoints for the NAS and router. Ingress-nginx terminates TLS and proxies to the LAN devices. Keep the static target IPs in `flux/cluster-settings.yaml`.

## Ingress Controller Placement And Rollout

Patch 6 in `core/ingress-nginx/kustomization.yaml` runs the single controller
replica only on the primary node (`kubernetes.io/hostname: ${PRIMARY_NODE_NAME}`).

The controller Service uses `externalTrafficPolicy: Local`, so MetalLB announces
`${INGRESS_VIP}` from the node that runs the controller pod. Pinning keeps the VIP
and the proxy hop on the node that hosts most backends, including Jellyfin and
Immich. A controller on the utility node would relay that traffic, video streams
included, back across the LAN. The pin is a required `nodeSelector`, not a
preferred affinity: the scheduler never moves a running pod, so a preference
leaves the controller on the utility node after any primary outage.

Trade-off: while the primary is down or drained, private ingress is down. That
includes hosts whose backends run on the utility node and the Mac mini edge HTTPS
hosts on `${IRIS_VIP}`. The controller pod stays Pending until the primary returns.
This is accepted because most backends live on the primary. Permanent-public sites
and temporary shares do not use ingress-nginx.

Rollout contract:

- `maxSurge: 1` and `maxUnavailable: 0` start the replacement beside the old pod
  on the primary and remove the old pod only after the new one is available. The
  controller uses no host ports, so both pods fit on one node, and the VIP
  announcement does not move. The primary must keep room for a second controller
  request; the capacity checks count this surge.
- Readiness (`/healthz`) passes only when NGINX is running and its Lua backends are
  loaded. A new pod joins the Service endpoints, kube-proxy's local rules, and the
  MetalLB announcement only once it is Ready. Certificates load just after the
  backends, and kube-proxy needs time to program the new endpoint, so
  `minReadySeconds: 5` keeps the old pod serving until the new one has stayed Ready
  for 5 seconds.
- `--shutdown-grace-period=5` keeps the old NGINX accepting connections for 5
  seconds after its `preStop` hook signals shutdown, so kube-proxy drops the
  terminating endpoint before NGINX closes its listeners. The upstream default is 0.
- Do not add pod anti-affinity; it blocks the same-node surge. Do not add a
  PodDisruptionBudget; with one replica it blocks the node drains that Talos
  upgrades use.

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
kubectl -n ingress-nginx get pods -o wide
kubectl -n metallb-system get servicel2statuses
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
