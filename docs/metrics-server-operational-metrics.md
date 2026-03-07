# Metrics Server: Real-Time Operational Metrics

## Purpose

This cluster now runs `metrics-server` for real-time Kubernetes resource metrics.

It enables:
- `kubectl top nodes`
- `kubectl top pods -A`
- future HPA experiments if you decide to use them

Prometheus remains the source for historical analysis and Resource Advisor inputs.

## GitOps Paths

- `flux/repositories/metrics-server.yaml`
- `infrastructure/metrics-server/helmrelease.yaml`
- `infrastructure/metrics-server/kustomization.yaml`
- `flux/kustomizations/metrics-server.yaml`

## Current Install

- Namespace: `kube-system`
- Chart: `metrics-server`
- Chart version: `3.13.0`
- App version: `0.8.0`

## Talos-Specific Note

This cluster's Talos machine configs do not enable kubelet serving-cert bootstrap today:
- `talos/controlplane.yaml`
- `talos/worker.yaml`

To keep the rollout lean and avoid changing kubelet certificate behavior, the HelmRelease uses:
- `--kubelet-insecure-tls`

It also keeps the APIService on:
- `apiService.insecureSkipTLSVerify: true`

This is the pragmatic path for homelab operational metrics. If you later enable kubelet serving-cert rotation in Talos, you can revisit and tighten this.

## Verification

```bash
flux reconcile kustomization flux-system --with-source
flux reconcile kustomization metrics-server --with-source

kubectl get apiservice v1beta1.metrics.k8s.io
kubectl get pods -n kube-system | rg metrics-server

kubectl top nodes
kubectl top pods -A | head
```

## Troubleshooting

If `kubectl top` fails after rollout:

1. Check APIService registration:
```bash
kubectl describe apiservice v1beta1.metrics.k8s.io
```

2. Check pod logs:
```bash
kubectl logs -n kube-system deploy/metrics-server
```

3. If errors mention kubelet certificate validation, confirm the HelmRelease still includes:
- `--kubelet-insecure-tls`

4. If metrics are slow or missing only on one node, inspect kubelet reachability for that node first.
