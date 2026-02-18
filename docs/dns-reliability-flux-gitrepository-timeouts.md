# DNS Reliability Hardening for Flux GitRepository Timeouts

## Why This Exists
On **2026-02-18**, `source-controller` intermittently failed to fetch `ssh://git@github.com/khzaw/rangoonpulse` due to DNS errors, causing transient GitOps reconciliation risk.

Observed events on `flux-system/gitrepository/flux-system`:
- `dial tcp: lookup github.com on 10.96.0.10:53: read udp ... i/o timeout`
- `dial tcp: lookup github.com on 10.96.0.10:53: ... server misbehaving`

This doc records the issue, the implemented fix, and how to validate/rollback.

## Scope and Design Goals
- Keep GitOps as the source of truth.
- Improve resilience of cluster DNS resolution for controller traffic.
- Add direct alerting for DNS degradation and Flux source reconciliation errors.
- Keep changes lean: no new controllers, no extra DNS middleboxes inside the cluster path.

## What Was Implemented

### 1) New GitOps Component: `dns-reliability`
Added:
- `infrastructure/dns-reliability/kustomization.yaml`
- `infrastructure/dns-reliability/coredns-configmap.yaml`
- `infrastructure/dns-reliability/podmonitor-flux-controllers.yaml`
- `infrastructure/dns-reliability/prometheusrule-dns-reliability.yaml`
- `flux/kustomizations/dns-reliability.yaml`
- `flux/kustomization.yaml` updated to include `./kustomizations/dns-reliability.yaml`

### 2) CoreDNS Upstream Hardening
`kube-system/coredns` is now GitOps-managed with deterministic public recursive upstreams:
- `1.1.1.1`
- `1.0.0.1`
- `9.9.9.9`

Forwarding plugin settings used:
- `max_concurrent 1000`
- `health_check 2s`
- `max_fails 2`
- `expire 10s`
- `policy random`
- `prefer_udp`

Rationale:
- Removes dependency on node `/etc/resolv.conf` resolver chain for external lookups.
- Improves upstream failover behavior and stale-connection handling.
- Keeps in-cluster service discovery unchanged (`kubernetes cluster.local ...`).

### 3) Flux Controller Metrics Scraping
Added `PodMonitor monitoring/flux-controllers` to scrape `http-prom` endpoints for:
- `source-controller`
- `kustomize-controller`
- `helm-controller`
- `notification-controller`

Rationale:
- `source-controller` exposes `controller_runtime_reconcile_errors_total`, but this was not reliably integrated into cluster alerting before.

### 4) DNS + Flux Alerts
Added `PrometheusRule monitoring/dns-reliability` with:
- `CoreDNSRequestLatencyP95High`
- `CoreDNSServfailRateHigh`
- `CoreDNSForwardHealthcheckFailures`
- `FluxSourceGitRepositoryReconcileErrors`
- `FluxSourceControllerUnavailable`

Rationale:
- Detect resolver latency/failure before it becomes a prolonged GitOps outage.
- Detect Flux source failures from controller metrics, not only from occasional event inspection.

## Validation Evidence (During Implementation)

### Flux Issue Evidence
Command:
```bash
kubectl describe gitrepository -n flux-system flux-system
```
Showed warnings including DNS timeout and `server misbehaving` errors for `lookup github.com on 10.96.0.10:53`.

### CoreDNS Metrics Evidence
Command (via pod port-forward):
```bash
kubectl -n kube-system port-forward pod/<coredns-pod> 19153:9153
curl http://127.0.0.1:19153/metrics
```
Confirmed expected series exist:
- `coredns_dns_request_duration_seconds_bucket`
- `coredns_dns_responses_total`
- `coredns_proxy_healthcheck_failures_total`

### Flux Source Metrics Evidence
Command (via pod port-forward):
```bash
kubectl -n flux-system port-forward pod/<source-controller-pod> 18081:8080
curl http://127.0.0.1:18081/metrics
```
Confirmed:
- `controller_runtime_reconcile_errors_total{controller="gitrepository"}`

## Rollout Procedure
After commit/push:
```bash
flux reconcile kustomization flux-system --with-source
flux reconcile kustomization dns-reliability --with-source
```

Verify:
```bash
flux get kustomizations | rg dns-reliability
kubectl get cm -n kube-system coredns -o yaml
kubectl get podmonitor -n monitoring flux-controllers
kubectl get prometheusrule -n monitoring dns-reliability
kubectl get events -n flux-system --sort-by=.lastTimestamp | tail -n 50
```

## Rollback
If DNS behavior regresses:
1. Remove `./kustomizations/dns-reliability.yaml` from `flux/kustomization.yaml`.
2. Delete `flux/kustomizations/dns-reliability.yaml`.
3. Delete `infrastructure/dns-reliability/`.
4. Commit and push.
5. Reconcile:
```bash
flux reconcile kustomization flux-system --with-source
```

## Operational Notes
- This hardening intentionally targets cluster-controller stability. LAN clients should still use AdGuard (`10.0.0.233`) via router DHCP/DNS.
- If upstream policy needs to remain internal-only, replace CoreDNS upstream targets in `infrastructure/dns-reliability/coredns-configmap.yaml` with your preferred recursive resolvers and keep the same forward hardening options.
