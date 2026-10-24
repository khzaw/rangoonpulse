---
title: Cluster DNS Reliability
summary: Current separation between LAN DNS and cluster/node DNS, plus Flux timeout diagnostics.
status: active
owner: homelab
last_reviewed: 2026-10-25
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

CoreDNS currently forwards to `1.1.1.1`, `1.0.0.1`, and `8.8.8.8`, with upstream health checks, random selection, and short connection expiry. Node-level Talos nameservers are a separate setting; changing this ConfigMap does not update them.

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
kubectl -n monitoring get podmonitor,prometheusrule | grep -E 'dns|flux'
```

Do not remove the component as a first-line rollback. Restore a known-good resolver configuration through GitOps, then verify CoreDNS, source-controller, and external name resolution.
