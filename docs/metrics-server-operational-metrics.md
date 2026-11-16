---
title: Metrics Server
summary: Current real-time Metrics API deployment and Talos kubelet TLS compatibility tradeoff.
status: active
owner: homelab
last_reviewed: 2026-11-16
---

# Metrics Server

Metrics Server provides the live Kubernetes Metrics API used by `kubectl top` and [BentoPDF's CPU-based HPA](./bentopdf.md), bounded to one or two replicas. Prometheus remains the source for retained metrics and Resource Advisor analysis.

## Source Of Truth

- Helm source: `flux/repositories/metrics-server.yaml`
- release: `infrastructure/metrics-server/helmrelease.yaml`
- Flux: `flux/kustomizations/metrics-server.yaml`
- namespace: `kube-system`

Chart and application versions are authoritative in the HelmRelease.

The single replica requests `25m` CPU and `200Mi` memory, with `200m` / `300Mi`
limits. CPU reservation changes must preserve fresh Metrics API samples and the
BentoPDF HPA's ability to read its absolute CPU target.

## Talos TLS Tradeoff

The current release uses:

- `--kubelet-insecure-tls`
- `apiService.insecureSkipTLSVerify: true`

This is the current compatibility choice for kubelet serving certificates on this cluster. Tighten it only after proving every node serves a certificate chain and address SAN accepted by Metrics Server.

Do not cite untracked generated Talos machine files as repository evidence. Verify live kubelet certificate behavior or the secure Talos configuration workflow.

## Verification

```bash
flux get kustomization metrics-server -n flux-system
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl get pods -n kube-system | grep metrics-server
kubectl top nodes
kubectl top pods -A
```

If one node lacks metrics, inspect that node's kubelet reachability and certificate error before changing cluster-wide flags.
