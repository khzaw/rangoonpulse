# Node Capacity Overview Dashboard

This cluster now provisions a Grafana dashboard focused on first-principles node
CPU and RAM visibility, with workload and pod drilldowns under the same filters.

## GitOps Objects

- ServiceMonitor: `infrastructure/monitoring/servicemonitor-kubelet-resource.yaml`
- Recording rules: `infrastructure/monitoring/prometheusrule-node-capacity-overview.yaml`
- Dashboard: `infrastructure/monitoring/grafana-dashboard-node-capacity-overview.yaml`
- Included by: `infrastructure/monitoring/kustomization.yaml`

## What The Top Panels Mean

- Whole-host CPU comes from kubelet `/metrics/resource`:
  - `node_cpu_usage_seconds_total`
- Whole-host RAM comes from kubelet `/metrics/resource`:
  - `node_memory_working_set_bytes`
- Node capacity comes from kubelet cAdvisor metrics already present in Prometheus:
  - `machine_cpu_cores`
  - `machine_memory_bytes`

The top row therefore answers:

- CPU used out of total cores
- RAM used out of total bytes
- utilization percentages for the selected node scope

## Drilldown Model

The lower panels pivot into Kubernetes workloads and pods:

- pod CPU: `pod_cpu_usage_seconds_total`
- pod RAM: `pod_memory_working_set_bytes`
- workload ownership: `namespace_workload_pod:kube_pod_owner:relabel`
- node placement filter: `kube_pod_info`

The dashboard uses `workload` rather than Kubernetes `Service` objects because
resource metrics attach naturally to pods and workload owners, not to Services.

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get servicemonitor -n monitoring kubelet-resource -o yaml
kubectl get prometheusrule -n monitoring node-capacity-overview -o yaml
kubectl get configmap -n monitoring grafana-dashboard-node-capacity-overview -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:node_host_cpu_utilization:ratio'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=homelab:node_host_memory_utilization:ratio'
```

Grafana dashboard title: `Node Capacity Overview`.
