# Control panel visualization plans

These plans add live cluster visuals to the `apps/exposure-control` cockpit at
`controlpanel.khzaw.dev`. They were written against commit `630906f`. They
preserve the cockpit's literal white and black bases, IBM Plex type, and the
dither and halftone material already defined in `styles.css`.

The panel today reaches the Kubernetes API, the resource-advisor exporter and
GitHub. It never reads Prometheus, so none of the recording rules in
`infrastructure/monitoring/` reach the UI. Plan 010 closes that gap; everything
else builds on it.

| Plan | Title | Phase | Status | Dependencies |
| --- | --- | --- | --- | --- |
| [010](010-prometheus-query-proxy.md) | Prometheus query proxy | 0 foundation | DONE | None |
| [011](011-metrics-client-and-sparklines.md) | Metrics client, pulse page and sparklines | 0 foundation | DONE | 010 |
| [012](012-node-twins.md) | Node twins | 1 physical | TODO | 011 |
| [013](013-power-and-cost-ticker.md) | Power and cost ticker | 1 physical | TODO | 011 |
| [014](014-placement-map.md) | Placement map | 2 shape | TODO | 011 |
| [015](015-storage-tanks.md) | Storage tanks | 2 shape | TODO | 011 |
| [016](016-flux-reconcile-ribbon.md) | Flux reconcile ribbon | 3 activity | TODO | 011 |
| [017](017-alert-lamp-board.md) | Alert lamp board | 3 activity | TODO | 011 |
| [018](018-ambient-orb.md) | Ambient orb driven by cluster signal | 4 ambient | TODO | 016, 017 |

## Execution order

1. **Phase 0** ships 010 and 011 together. The result is a new `pulse` page
   with four sparkline tiles. Nothing else starts until this is live and the
   Prometheus round trip is measured on the Pi.
2. **Phase 1** adds 012 and 013. Both are single-section visuals fed only by
   named queries that already exist after 010. They can be built in either
   order or in parallel.
3. **Phase 2** adds 014 and 015. These are the two heaviest client renders
   (treemap and 48 gauges). Build 015 first; it is simpler and proves the
   halftone fill primitive that 014 reuses.
4. **Phase 3** adds 016 and 017. Each needs one new server route beyond the
   metrics proxy. Independent of each other.
5. **Phase 4** adds 018 last, because it consumes the reconcile and alert
   signals from Phase 3.

One commit per plan, prefixed `exposure-control:`. Update the status column
here after each plan is merged and verified on the live panel.

## Cross-cutting constraints

**Runtime budget.** The panel pod runs on the Pi under `200m` CPU and `256Mi`
memory. The server stays a thin proxy: it forwards allowlisted queries, caches
responses for 30 seconds and never aggregates. All shaping happens in the
browser. Any single `/api/metrics` response stays under about 150 KB, and no
series carries more than 300 points.

**Prometheus budget.** Scrape interval is 60 seconds and retention is 14 days.
Range queries use recording rules wherever one exists and are clamped to at
most 7 days. Steps are never finer than 5 minutes.

**Delivery.** No bundler, no new dependencies. New client code lives in one new
file, `pulse.js`, which must be registered in four places: the
`configMapGenerator` list in `kustomization.yaml`, the `CONTROL_PANEL_ASSETS`
map at `server.js:4491`, the asset-version regex at `server.js:4612`, and a
deferred `<script>` tag in `index.html` next to `app.js`. The ConfigMap is
currently about 412 KB against a 1 MiB limit.

**Theme.** Every new colour comes from an existing token in `styles.css`.
Where the halftone fill needs graded density, plans add `--ink-step-1` through
`--ink-step-5` once, in the light `:root` block and both dark blocks.

**Motion.** Follow the direction in `plans/README.md`. Sparklines and gauges do
not animate on load. The only motion is a one-shot dither flash on a genuine
state change (a restart, a new Git revision, a newly firing alert), and it
respects the reduced-motion contract from plan 003 if that plan has landed.

**Verification for every plan.**

```bash
cd /Users/khz/Code/rangoonpulse
node --test apps/exposure-control/server.test.js
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -
git add apps/exposure-control && git commit -m "exposure-control: <plan title>"
git push
flux reconcile kustomization exposure-control -n flux-system --with-source
kubectl rollout status deployment/exposure-control -n default --timeout=180s
curl -fsS https://controlpanel.khzaw.dev/api/metrics?names=cluster_watts | head -c 400
```

Then open the `pulse` page in both light and dark themes and at a 400 px
viewport width.

## Pre-flight check before Phase 0

Confirm the exact label names on the recording rules before writing the query
registry. The Grafana dashboards in `infrastructure/monitoring/` are the source
of truth for the `job` and `node` label filters. Run these once through a port
forward:

```bash
kubectl -n monitoring port-forward svc/prometheus-operated 9090:9090 &
curl -s 'localhost:9090/api/v1/query?query=homelab:node_estimated_power_watts' | jq '.data.result[].metric'
curl -s 'localhost:9090/api/v1/query?query=homelab:pvc_utilization:ratio' | jq '.data.result[0].metric'
curl -s 'localhost:9090/api/v1/query?query=controller_runtime_reconcile_total' | jq '.data.result[0].metric'
curl -s 'localhost:9090/api/v1/query?query=homelab:rpi_low_voltage_alarm' | jq '.data.result'
```

Also note that `apps/exposure-control` has no NetworkPolicy and the
`monitoring` namespace has none either, so the pod can reach
`prometheus-operated.monitoring.svc.cluster.local:9090` and
`kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093` without
any policy change.

## Implementation notes (2026-09-16)

- 010/011 live: foundation response about 51 KB; ten repeated requests added
  40 cache hits and no upstream requests. Refresh latency median 94 ms.
- Plans 016–018 are index entries only; their detailed files were not supplied.
- Live preflight corrections: node metadata needs `node_hardware` and `node_role`;
  pod memory must select cAdvisor only; storage thresholds are 80/90 percent.
- Inventory currently has 48 PVCs, with usage telemetry for 19 NAS claims.
  Local-path must show unavailable usage and requested capacity.
- Seven-day power uses a derived 34-minute step, not one hour.
