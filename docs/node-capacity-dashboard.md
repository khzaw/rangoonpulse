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

## Scheduling and rollout headroom

CPU utilization and CPU requests answer different questions. Kubernetes schedules
against requests even when a node is mostly idle. On October 22, 2026, primary-node
requests reached 5943m of 5950m allocatable CPU and blocked even a 12m blog pod.
See [Flux reconciliation alerts](./flux-reconciliation-alerts.md#cpu-reservation-exhaustion-2026-10-22)
for the incident and request-only recovery.

Keep at least 1000m of primary-node CPU unreserved for rollout overlap and jobs.
Check placement-specific requests and the largest replacement pod before adding
or increasing reservations. Whole-cluster free CPU includes utility-node capacity
that pinned primary-node apps cannot use. Resource Advisor now hard-blocks CPU
increases unless each affected node retains the larger of 1000m or its largest
replacement pod plus 150m for a job. Separate PRs cannot spend unmerged downsize
savings. Its live preflight exposes the reserve and shortfall per node; see
[Resource Advisor's policy](./resource-advisor-phase1-phase2.md#node-constraint-awareness).
The [live admission guard](./cpu-headroom-admission.md) applies the same reserve to
manual resource changes, scaling, and new workloads. Preflight rendered workload
manifests with `make check-capacity FILE=<rendered.yaml>` before pushing.

## Workload drilldowns

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
  promtool query instant http://localhost:9090 'homelab:node_host_cpu_utilization:ratio'

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool query instant http://localhost:9090 'homelab:node_host_memory_utilization:ratio'
```

Grafana dashboard title: `Node Capacity Overview`.
