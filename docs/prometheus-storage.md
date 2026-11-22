---
title: Prometheus Storage
summary: Current TSDB sizing, retention, metric ingestion policy, node affinity, and recovery constraints.
status: active
owner: homelab
last_reviewed: 2026-11-23
---

# Prometheus Storage

## Current State

Prometheus stores its TSDB on a 12Gi `local-path` PVC on the primary node. Current policy:

- time retention: 14 days
- size retention: 8GB
- WAL compression: enabled

This local-path choice avoids NFS latency and locking behavior on the write-heavy TSDB. It also makes Prometheus node-affined and exposes the metrics history to primary-node disk loss.

Resource Advisor depends on the 14-day metrics window. Losing the TSDB does not prevent the cluster from running, but it removes tuning continuity and recent operational history.

## Metric Ingestion

Ingestion keeps only series that something reads. A consumer is a loaded Prometheus rule (chart defaults and repository PrometheusRules, including recording rules), a dashboard ConfigMap provisioned by the Grafana sidecar, or a repository query (Resource Advisor, Control Panel, Dynacat, power ledger). The filters live in `infrastructure/monitoring/helmrelease.yaml` and `servicemonitor-kubelet-resource.yaml`:

| Source | Mechanism | Dropped |
|---|---|---|
| API server | post-renderer, appended to the chart's bucket thinning | `_bucket` series of request/response size, watch, request-filter, admission, flow-control, authn/authz, storage-transformation, conversion-webhook, field-validation, client-size and workqueue work-duration histograms; `apiserver_request_duration_seconds_bucket` and `etcd_request_duration_seconds_bucket`; `kubernetes_feature_enabled` |
| kubelet `/metrics` | post-renderer | `_bucket` series of CSI, volume, image-pull, HTTP, pod-start, DRA and client histograms; `kubernetes_feature_enabled` |
| kubelet cAdvisor | post-renderer | redundant, static or always-zero families: memory usage/max/kernel/failcnt/failures/active-inactive file, network error counters, thread/socket/process counts, start time, last seen, health state, load average, ulimits, CFS burst |
| kubelet probes | chart value | `prober_probe_duration_seconds_bucket` |
| kubelet `/metrics/resource` | repository ServiceMonitor | swap families (swap is disabled) and container start time |
| kube-state-metrics | chart values | collectors for Secrets, ConfigMaps, EndpointSlices, Leases, webhook configurations, NetworkPolicies, StorageClasses, VolumeAttachments, CSRs, LimitRanges and ReplicationControllers; ReplicaSet status/spec families and static pod attributes by denylist |
| Grafana self-scrape | chart value (keep-list) | everything except the families the chart's Grafana Overview dashboard reads |

The SLO, burn-rate and API server dashboard queries use `apiserver_request_sli_duration_seconds`, which stays. Histogram drops remove only `_bucket` series; `_count` and `_sum` remain for rates and averages. CPU usage and throttling, working set/RSS/cache, PSI, OOM events, network and block I/O, `kube_replicaset_owner` (pod-owner recording rules), and the unconsumed API server counters and gauges also remain for diagnosis. Scrapes use the 60s global interval except the kubelet cAdvisor endpoint, which keeps the chart's 10s interval; each cAdvisor series therefore costs several times the samples of a 60s series.

The kubelet post-renderer tests the endpoint paths before appending. A chart that reorders kubelet endpoints fails the Helm release instead of filtering the wrong endpoint.

Remove the matching filter before adding a consumer for a dropped family, such as a quantile query, a Grafana self-metric panel, or a kube-state-metrics resource. On chart upgrades, check the new chart's rules and dashboards against these filters; the Grafana keep-list in particular hides any family a new Grafana Overview revision adds. To audit, extract metric-name tokens from `/api/v1/rules`, the `grafana_dashboard=1` ConfigMaps and tracked repository files. Compare them with `count by (__name__, job, metrics_path) ({__name__=~".+"})` and the rendered filters.

Verify the loaded filters, successful scrapes, rule health and `scrape_samples_post_metric_relabeling` after a change. Existing samples expire normally; fewer incoming series do not immediately reclaim the TSDB's head memory or disk blocks.

## Backup Status

The repository defines no automated Prometheus TSDB backup or snapshot. Grafana dashboards and rules stored in Git are recoverable; collected samples are not.

## Recovery

Prefer starting with an empty TSDB when historical metrics are expendable. If preserving TSDB data is required:

1. stop Prometheus completely
2. copy the entire TSDB directory, including WAL and checkpoints
3. restore to disposable storage first
4. start the same or a compatible Prometheus version
5. verify TSDB startup, rule evaluation, and historical queries

Do not copy a live TSDB and treat it as application-consistent.

## Verification

```bash
kubectl get prometheus,pvc -n monitoring
kubectl get pod -n monitoring -l app.kubernetes.io/name=prometheus -o wide
kubectl get prometheus -n monitoring -o yaml | grep -E 'retention|retentionSize|walCompression'
```
