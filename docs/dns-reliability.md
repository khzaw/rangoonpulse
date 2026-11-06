---
title: Cluster DNS Reliability
summary: Current separation between LAN DNS and cluster/node DNS, plus Flux timeout diagnostics.
status: active
owner: homelab
last_reviewed: 2026-11-06
---

# Cluster DNS Reliability

## Architecture

LAN clients and Kubernetes workloads intentionally use different DNS paths:

- LAN clients use the two AdGuard LoadBalancer services.
- CoreDNS forwards cluster-external lookups to configured public resolvers.
- Node-level resolver configuration is managed through the secure Talos machine configuration workflow and is not auditable from committed generated machine configs.

This separation keeps Flux, image pulls, and cluster controllers independent from router/AdGuard recursion while retaining filtered DNS for clients.

## Source of Truth

- CoreDNS customization and monitoring: `infrastructure/dns-reliability/`
- Flux registration: `flux/kustomizations/dns-reliability.yaml`
- AdGuard client DNS: `apps/adguard/`
- ExternalDNS record management: `infrastructure/external-dns/`

The DNS reliability component includes CoreDNS configuration, controller Pod monitoring, and alerts for lookup failure and latency.

The GitRepository error-counter alert requires errors to continue across 5m
lookback windows for 10m. An isolated recovered error ages out before notification.
Sustained Flux readiness failures are covered separately by the
[Flux reconciliation alerts](./flux-reconciliation-alerts.md).

CoreDNS currently forwards to `1.1.1.1`, `1.0.0.1`, and `8.8.8.8`, with upstream health checks, random selection, and short connection expiry. Node-level Talos nameservers are a separate setting; changing this ConfigMap does not update them.

Talos owns the CoreDNS Deployment; Flux owns its customized ConfigMap and monitoring. The two replicas prefer different nodes through pod anti-affinity, but this is a scheduling preference, not a guarantee. Check their actual placement before node or network maintenance. Rescheduling an existing replica can restore the spread when both nodes are healthy; do not add a competing Git-managed Deployment.

## Intermittent Lookup Failures

Compare the same lookups from both nodes before changing resolver configuration:

1. Query the cluster DNS Service, then each CoreDNS Pod IP, using both A and AAAA lookups. This distinguishes a failing replica from a Service routing problem.
2. Query the configured public resolvers directly over UDP and TCP. Repeat from the affected node's host network to distinguish pod networking from the node's upstream path.
3. Compare gateway reachability with node-to-node reachability. Clean peer traffic does not prove the gateway path is healthy. Check the node address, DHCP reservation, gateway neighbor entry, and mesh backhaul when loss is isolated to that path.
4. Repeat the checks after recovery and inspect fresh CoreDNS and application logs. A Ready node or healthy mesh status alone does not verify DNS delivery.

Direct resolver timeouts from the host network require investigation below CoreDNS. Changing forwarding transport may mask some loss without repairing that path. Keep the LAN AdGuard and cluster DNS paths separate while diagnosing it.

## Flux GitRepository Timeouts

A Flux source timeout is not automatically a Git credential failure. Classify the boundary first:

1. Resolve the Git host from the source-controller pod.
2. Test TCP/TLS reachability.
3. Inspect `GitRepository/flux-system` conditions and source-controller logs.
4. Compare CoreDNS errors and latency over the same window.
5. Only investigate SSH credentials after DNS and network reachability succeed.

```bash
flux get sources git -A
kubectl -n flux-system describe gitrepository flux-system
kubectl -n flux-system logs deploy/source-controller --since=30m
kubectl -n kube-system logs deploy/coredns --since=30m
```

## Verification

```bash
flux get kustomization dns-reliability -n flux-system
kubectl -n kube-system get configmap coredns -o yaml
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
kubectl -n monitoring get podmonitor,prometheusrule | grep -E 'dns|flux'
```

Do not remove the component as a first-line rollback. Restore a known-good resolver configuration through GitOps, then verify CoreDNS, source-controller, and external name resolution.
