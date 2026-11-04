---
title: Prometheus Storage
summary: Current TSDB sizing, retention, metric ingestion policy, node affinity, and recovery constraints.
status: active
owner: homelab
last_reviewed: 2026-11-04
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

The monitoring HelmRelease appends an API-server `ServiceMonitor` filter through its inline post-renderer. This preserves the chart's existing histogram bucket thinning. It excludes only the `_bucket` series for these unused diagnostic distributions:

- `apiserver_request_body_size_bytes`
- `apiserver_watch_list_duration_seconds`
- `apiserver_watch_cache_read_wait_seconds`
- `apiserver_watch_events_sizes`
- `apiserver_response_sizes`

Their `_count` and `_sum` series remain available for rates and averages. Request latency, availability/SLO, error, etcd, kubelet, resource, and Resource Advisor inputs remain collected. Scrape cadence and retention are unchanged.

Before extending the filter, audit the exact chart's rendered rules and dashboards, loaded Prometheus rules, saved Grafana dashboards/alerts, and repository consumers. Restore a distribution's buckets before adding a quantile query for it. A chart change must still render the targeted monitor and preserve its upstream relabel rules.

Verify the loaded filter, successful scrapes, and `scrape_samples_post_metric_relabeling` after a change. Existing samples expire normally; fewer incoming series do not immediately reclaim the TSDB's head memory or disk blocks.

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
