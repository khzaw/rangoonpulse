# DNS And Access Paths Dashboard

This dashboard combines CoreDNS health with ingress and service inventory so you
can answer:

- is cluster DNS healthy
- are forwarders failing
- how many hosts are exposed through ingress
- which access paths are LoadBalancer or ExternalName backed
- which ingress hosts are missing TLS

## GitOps Object

- Dashboard: `infrastructure/monitoring/grafana-dashboard-dns-access-paths.yaml`

## Data Sources Used

- CoreDNS metrics from job `coredns`
- ingress inventory from:
  - `kube_ingress_info`
  - `kube_ingress_path`
  - `kube_ingress_tls`
- service inventory from:
  - `kube_service_info`
- Prometheus DNS service discovery failure counter:
  - `prometheus_sd_dns_lookup_failures_total`

## Verification

```bash
cd /Users/khz/Code/rangoonpulse
export KUBECONFIG=/Users/khz/Code/rangoonpulse/kubeconfig

flux reconcile kustomization monitoring -n flux-system --with-source

kubectl get configmap -n monitoring grafana-dashboard-dns-access-paths -o yaml

kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=sum(rate(coredns_dns_requests_total[5m]))'
```

Grafana dashboard title: `DNS and Access Paths`.
