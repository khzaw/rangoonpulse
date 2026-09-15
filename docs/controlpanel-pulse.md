# Control Panel Pulse

The `pulse` page at `https://controlpanel.khzaw.dev/#pulse` provides read-only
cluster telemetry within the existing operator cockpit. It uses the same private
access boundary, monochrome IBM Plex theme, and ConfigMap asset delivery.

## Data boundary

`GET /api/metrics?names=node_cpu,node_mem,cluster_watts,restarts_1h&range=24h`
accepts named queries only. Browser-supplied PromQL and unknown parameters are
rejected. Each query has a 30-second cache, shared in-flight requests, a four-second
upstream deadline, and at most 300 samples per series. Upstream concurrency is
bounded across requests. The response budget is 150,000 bytes; an oversized
metric receives an explicit degraded state instead of silently truncated data.

The page refreshes every 60 seconds only while visible and selected, and refreshes
when reopened. Metrics load independently of control actions. Missing readings
render as unavailable; a failed refresh does not present old readings as live.

Power readings use the existing estimated-power recording rules. They are
estimates, not wall-meter measurements.

## Nodes and power

Node identity joins `node_info`, `node_hardware`, and `node_role` on `node`;
architecture is not present in kube-state-metrics' `kube_node_info`. CPU and
memory bars show current whole-host usage with a tick for scheduler requests.
Readiness and Raspberry Pi low voltage remain independent live signals.

Power history is sampled over seven days. Energy uses timestamp-weighted
integration; cost uses the configured tariff, and the 30-day projection uses
the seven-day mean. Missing tariffs or insufficient history leave cost blank.
Midnight ticks always use Asia/Singapore, independent of the browser's timezone.

## Delivery and validation

Client primitives live in `apps/exposure-control/pulse.js`, registered in the
Kustomize ConfigMap, server asset map/versioning, and deferred HTML scripts.
There are no added runtime dependencies or build steps.

```bash
npm run check
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -
flux reconcile kustomization exposure-control -n flux-system --with-source
kubectl rollout status deployment/exposure-control -n default --timeout=180s
curl -fsS 'https://controlpanel.khzaw.dev/api/metrics?names=cluster_watts,tariff&range=24h'
```

Verify the Pulse page in light and dark themes, at desktop and 400-pixel widths.
Navigation to another page must stop periodic metric requests. Keep deployment
and commits scoped to exposure-control; other cluster work may be concurrent.
