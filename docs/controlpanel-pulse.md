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

## Storage

PVC inventory (`pvc_class`) controls membership. Usage joins by namespace and
claim; missing usage never becomes zero. Requested capacity is shown separately
for unmeasured volumes. TrueNAS storage-class variants share the network-volume
group, and each group initially shows its 16 fullest claims.

Warning and danger thresholds match Storage Risk Overview at 80 and 90 percent.
Time-to-full is a least-squares trend from timestamped samples, requiring at least
12 readings spanning 24 hours. New or flat-history volumes have no projection.
Only projections under 30 days are shown; under seven days uses danger styling.

## Placement

The map groups pods by node and namespace. Area reflects requested memory with a
32 Mi display floor. Dot density reflects usage relative to requests; red outlines
indicate usage above requests, and squares indicate restarts within 24 hours.
Checkered cells indicate a non-running or unavailable phase. Completed pods with
no matching phase series therefore display an unknown phase rather than Running.

Container memory selects the kubelet cAdvisor scrape explicitly to avoid double
counting the resource endpoint. Inventory is authoritative and joins are keyed by
namespace and pod. Missing usage remains unmeasured. Namespace headers and padding
adapt to small rectangles so every pod remains represented without changing weights.

Hover, touch, or keyboard focus exposes the complete pod reading below the map.
Select a namespace heading (Enter/Space with a keyboard) to fold it; state is local
to the page session. A genuine increase in the rounded restart count causes a
single brief flash; reduced motion disables it. Refresh preserves focused cells.

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

## Verification record — 2026-09-16

The completed page was checked against live node, pod, and PVC inventory in both
themes and at 400px. All 100 sampled pods retained visible cells; expanding both
storage groups showed all 48 claims (19 measured, 29 unavailable). Ninety-two
repository tests passed, including sparse histories and heavily skewed treemaps.

Ten cached requests added 40 cache hits and no upstream requests. Off-page
observation over 115 seconds produced no extra metric request; reopening Pulse
refreshed it. A deliberately pending client metrics call did not delay completion
of the operator dashboard refresh. The pod settled at approximately 1m CPU and
19–23Mi memory during checks, within the existing resource limits.

The first layout attempt measured empty, hidden blocks and therefore used an
incorrect SVG width. Charts now measure the page width. Namespace insets and
header heights scale down for tiny groups; fixed insets previously removed their
pod cells. Neither fix changes the memory weights represented in the map.
