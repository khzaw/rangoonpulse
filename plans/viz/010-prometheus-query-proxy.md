# 010 — Prometheus query proxy

- **Status**: DONE — live verified 2026-09-16
- **Commit**: 7d0bddf
- **Phase**: 0 foundation
- **Category**: Server; data access
- **Estimated scope**: 3 files, about 220 lines added (server.js, server.test.js, helmrelease.yaml)

## Problem

`server.js` has no path to Prometheus. Every visual in this series needs
time-series or labelled instant values that only Prometheus holds. The panel
must not accept raw PromQL from the browser, and it must not let a slow
Prometheus stall the rest of `loadDashboard`.

The existing advisor proxy at `server.js:2148` (`getResourceAdvisorUi`) already
shows the pattern to copy: `requestUrl`, a TTL cache, and in-flight promise
deduplication.

## Design

**Configuration** (new env in `helmrelease.yaml` under `containers.main.env`):

```yaml
PROMETHEUS_URL: http://prometheus-operated.monitoring.svc.cluster.local:9090
METRICS_CACHE_TTL_SECONDS: "30"
METRICS_HTTP_TIMEOUT_MS: "4000"
METRICS_MAX_RANGE_HOURS: "168"
METRICS_MAX_POINTS: "300"
```

**Named query registry.** A frozen `METRIC_QUERIES` map in `server.js`, placed
after the advisor helpers. Keys are the only names the client can request.
Each entry declares the PromQL, whether it is `instant` or `range`, and a
default range. Initial set:

| name | kind | expr |
| --- | --- | --- |
| `cluster_watts` | range | `sum(homelab:node_estimated_power_watts)` |
| `node_watts` | range | `homelab:node_estimated_power_watts` |
| `node_cpu` | range | `homelab:node_host_cpu_utilization:ratio` |
| `node_mem` | range | `homelab:node_host_memory_utilization:ratio` |
| `node_req_cpu` | instant | `homelab:node_requested_cpu_utilization:ratio` |
| `node_req_mem` | instant | `homelab:node_requested_memory_utilization:ratio` |
| `node_info` | instant | `kube_node_info` |
| `node_ready` | instant | `kube_node_status_condition{condition="Ready",status="true"}` |
| `node_pods` | instant | `count by(node)(kube_pod_info)` |
| `rpi_low_voltage` | instant | `homelab:node_rpi_low_voltage_alarm` |
| `tariff` | instant | `homelab:singapore_household_tariff_sgd_per_kwh` |
| `restarts_1h` | range | `sum(increase(kube_pod_container_status_restarts_total[1h]))` |
| `pvc_util` | instant | `homelab:pvc_utilization:ratio` |
| `pvc_used` | instant | `homelab:pvc_used_bytes` |
| `pvc_capacity` | instant | `homelab:pvc_capacity_bytes` |
| `pvc_util_7d` | range | `homelab:pvc_utilization:ratio` (range fixed to 7d, step 1h) |
| `pod_info` | instant | `kube_pod_info{node!=""}` |
| `pod_mem_request` | instant | `sum by(namespace,pod)(kube_pod_container_resource_requests{resource="memory"})` |
| `pod_mem_usage` | instant | `sum by(namespace,pod)(container_memory_working_set_bytes{container!=""})` |
| `pod_restarts_24h` | instant | `sum by(namespace,pod)(increase(kube_pod_container_status_restarts_total[24h]))` |
| `flux_reconciles` | range | `sum by(controller,result)(increase(controller_runtime_reconcile_total{namespace="flux-system"}[5m]))` |
| `flux_errors` | range | `sum by(controller)(increase(controller_runtime_reconcile_errors_total{namespace="flux-system"}[5m]))` |

Copy the exact `job=` filters for the Flux series from
`infrastructure/monitoring/grafana-dashboard-gitops-change-timeline.yaml`
rather than guessing. Later plans may append entries; none may add a raw
PromQL path.

**Route.** `GET /api/metrics?names=a,b,c&range=24h` in `handleApi`
(`server.js:4069`), next to the tuning routes. Behaviour:

- Unknown name → `400` with `{ error: "unknown metric: <name>" }`. The whole
  request fails; the client never sends a partial allowlist.
- `range` accepts `<n>h` or `<n>d`, clamped to `[1h, METRICS_MAX_RANGE_HOURS]`.
  Entries with a fixed range ignore it.
- Step is derived, never client-supplied: `ceil(rangeSeconds / METRICS_MAX_POINTS)`
  rounded up to a multiple of 60 and floored at 300.
- Each name resolves through a cache keyed `name|range`. A cache miss issues
  one request to `/api/v1/query` or `/api/v1/query_range` via `requestUrl` with
  `METRICS_HTTP_TIMEOUT_MS`. Concurrent misses share one in-flight promise.
- Names are fetched with `mapWithConcurrency(names, 4, ...)`
  (`server.js:2870`).
- Response shape, always `200` when the route itself is valid:

```json
{
  "at": "2026-09-15T10:00:00.000Z",
  "range": "24h",
  "step": 300,
  "metrics": {
    "cluster_watts": {
      "state": "live",
      "kind": "range",
      "series": [{ "labels": {}, "values": [[1757930400, 41.2], ...] }]
    },
    "tariff": { "state": "degraded", "detail": "prometheus request failed (503)", "series": [] }
  }
}
```

  Per-name `state` mirrors the `tuning.fetch.state` convention so the client
  can draw a placeholder for one metric while others render.

- Values are parsed to numbers server-side; `NaN` becomes `null`.

**Metrics for the panel itself.** Add `exposure_control_metrics_proxy_requests_total{result}`
and `exposure_control_metrics_proxy_cache_hits_total` to `renderMetrics()`
(`server.js:4015`) so the proxy's own load is visible in Prometheus.

## Changes

1. `helmrelease.yaml`: five env vars above.
2. `server.js`: config constants near line 142; `METRIC_QUERIES`; helpers
   `parseMetricsRange`, `metricsStepFor`, `queryPrometheus(name, range)`,
   `getMetricsSnapshot(names, range)`; the route; two counters in
   `renderMetrics`.
3. `server.test.js`: start a fake Prometheus with `http.createServer` on
   127.0.0.1 that records the query string and returns canned
   `query`/`query_range` bodies. Spawn the panel with `PROMETHEUS_URL` pointed
   at it (the file already spawns the server with env overrides). Assert:
   unknown name → 400; range `999d` clamps to 168h; step for 24h is 300; two
   back-to-back requests hit the fake once; a fake returning 503 yields
   `state: "degraded"` with a 200 route status.

## Verification

```bash
node --test apps/exposure-control/server.test.js
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -
# after push and reconcile:
curl -fsS 'https://controlpanel.khzaw.dev/api/metrics?names=cluster_watts,tariff&range=24h' | jq '.metrics | map_values(.state)'
curl -s -o /dev/null -w '%{http_code}\n' 'https://controlpanel.khzaw.dev/api/metrics?names=up'
kubectl top pod -n default -l app.kubernetes.io/name=exposure-control
```

Expect `live` for both names, `400` for `up`, and no visible change in the
pod's memory after ten refreshes.
