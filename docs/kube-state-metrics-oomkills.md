# kube-state-metrics OOMKills

## Summary
- Symptom: `monitoring/kube-prometheus-stack-kube-state-metrics` restarted repeatedly and the HelmRelease could stay `READY=Unknown` during upgrades.
- Root cause: the container was being `OOMKilled` with `limits.memory: 128Mi`.
- Current fix: `infrastructure/monitoring/helmrelease.yaml` sets `requests.memory: 128Mi` and `limits.memory: 256Mi`.

## Evidence
- `kubectl describe pod -n monitoring kube-prometheus-stack-kube-state-metrics-...`
  - `Last State: Terminated`
  - `Reason: OOMKilled`
  - `Exit Code: 137`
- Current steady-state usage is much lower (`kubectl top pod -n monitoring kube-prometheus-stack-kube-state-metrics-... --containers` typically shows about `45Mi`), so the limit problem is during startup/resync cache growth rather than normal serving.

## Why this matters
- `kube-state-metrics` backs many kube-prometheus-stack dashboards and recording rules.
- Repeated restarts can make the monitoring HelmRelease look unhealthy even when Prometheus and Grafana are fine.

## Checks
```bash
kubectl get pods -n monitoring
kubectl describe pod -n monitoring -l app.kubernetes.io/name=kube-state-metrics
kubectl top pod -n monitoring -l app.kubernetes.io/name=kube-state-metrics --containers
flux get hr -n monitoring kube-prometheus-stack
```
