# GitOps Change Timeline Dashboard

This dashboard focuses on Flux activity over time so you can answer:

- what reconciled recently
- which controller is noisy
- which objects are reconciling often
- which objects are slow to converge

## GitOps Object

- Dashboard: `infrastructure/monitoring/grafana-dashboard-gitops-change-timeline.yaml`

## Data Sources Used

- Flux controller metrics from `monitoring/flux-controllers`
- `controller_runtime_*`
- `gotk_reconcile_duration_seconds_*`
- `kube_pod_container_status_restarts_total` for `flux-system`

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get configmap -n monitoring grafana-dashboard-gitops-change-timeline -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum(increase(controller_runtime_reconcile_total{job="monitoring/flux-controllers"}[1h]))'
```

Grafana dashboard title: `GitOps Change Timeline`.
