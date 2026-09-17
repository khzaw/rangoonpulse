# Control panel visualization plans

These plans add live cluster visuals to the `apps/exposure-control` cockpit at
`controlpanel.khzaw.dev`. They preserve the cockpit's literal white and black
bases, IBM Plex type, and the dither and halftone material defined in
`styles.css`.

Phases 0–2 (Prometheus proxy, pulse page, node twins, power ticker, placement
map, storage tanks) shipped between `7d0bddf` and `1153031` and were verified
on the live panel. Their plan files have been removed. What remains is the
activity layer and the ambient orb.

| Plan | Title | Phase | Status | Dependencies |
| --- | --- | --- | --- | --- |
| [016](016-flux-reconcile-ribbon.md) | Flux reconcile ribbon | 3 activity | TODO | None |
| [017](017-alert-lamp-board.md) | Alert lamp board | 3 activity | TODO | None |
| [018](018-ambient-orb.md) | Ambient orb driven by cluster signal | 4 ambient | TODO | 016, 017 |

## Execution order

1. **Phase 3** adds 016 and 017. 016 is fed entirely through the existing
   `/api/metrics` proxy. 017 adds one small read-only route for the
   Prometheus rules API. They are independent of each other and can be
   built in either order.
2. **Phase 4** adds 018 last, because it consumes the reconcile and alert
   models from Phase 3.

One commit per plan, prefixed `exposure-control:`. Update the status column
here after each plan is merged and verified on the live panel, then delete the
plan file.

## What already exists

The remaining plans build on these pieces. Do not duplicate them.

- **Query registry.** `METRIC_QUERIES` at `server.js:2200`. Every entry is
  `{ expr, kind: "instant" | "range", labels, defaultRangeHours, minStep,
  fixedRangeHours }`. The route at `/api/metrics?names=a,b&range=24h` only
  serves registered names. Cache TTL 30 s, at most 300 points per series,
  responses capped at 150 KB. `flux_reconciles` and `flux_errors` are already
  registered but not yet fetched by the client.
- **Client fetch.** `pulseBatches` at `app.js:2150` lists which names are
  fetched at which range. `pulseMetric(name, range)` reads the cached result.
  `loadPulse()` runs independently of the operator refresh; a slow metrics
  query never delays the control APIs. `renderPulse()` calls one render
  function per block.
- **Page.** `#pulse` in `index.html` already contains empty `#fluxRibbon`
  and `#alertBoard` blocks after `#storageTanks`. `pulseSectionHeader(index,
  title, detail)` at `app.js:2180` renders the numbered section bar; 016 takes
  `06`, 017 takes `07`.
- **Primitives in `pulse.js`.** `sparkline` (with `fill`, `pattern`, `ticks`,
  `dot` options), `halftoneDefs` and `inkStep` for graded fills,
  `byLabel`, `last`, `values`, `fmt`, `number`, `esc`, `clamp`.
- **Tokens.** `--ink-step-1` … `--ink-step-5` exist in the light `:root`
  block and both dark blocks.
- **One-shot flash.** `.is-flashing` on placement cells, removed after
  650 ms (`app.js:2315`), with a reduced-motion override at
  `styles.css:3851`. Reuse the same class and timing for new state changes.
- **Orb.** `thinking-orb.js` exposes `ThinkingOrbs.create(canvas, config)`
  returning `{ setState, setPaused }`. States are `working`, `searching`,
  `solving`, `listening`, `composing`, `shaping`. The header orb
  `#controlActivityOrb` is currently driven only by in-flight operator
  requests (`syncControlActivity`, `app.js:395`) and is hidden when idle.
- **Tests.** `pulse.test.js`, `pulse-physical.test.js`,
  `pulse-placement.test.js`, `pulse-storage.test.js` cover the client models.
  Add a `pulse-activity.test.js` for 016 and 017.

## Cross-cutting constraints

**Runtime budget.** The panel pod runs on the Pi under `200m` CPU and `256Mi`
memory. The server stays a thin proxy: it forwards allowlisted queries, caches
responses for 30 seconds and never aggregates. All shaping happens in the
browser.

**Prometheus budget.** Scrape interval is 60 seconds and retention is 14 days.
Range queries use recording rules wherever one exists and are clamped to at
most 7 days. Steps are never finer than 5 minutes.

**Delivery.** No bundler, no new dependencies. New client code goes into the
existing `pulse.js` (models) and `app.js` (render functions); no new asset
file, so no registration changes.

**Theme.** Every new colour comes from an existing token in `styles.css`.

**Motion.** Follow the direction in `plans/README.md`. Nothing animates on
load or on refresh. The only motion is the one-shot `.is-flashing` dither on
a genuine state change (a new revision, a resource leaving Ready, a newly
firing alert). Plan 003 (reduced-motion contract) has not landed, so each new
animation needs its own `prefers-reduced-motion` override, in the same shape
as `styles.css:3851`.

**Verification for every plan.**

```bash
cd /Users/khz/Code/rangoonpulse
node --test apps/exposure-control/
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -
git add apps/exposure-control && git commit -m "exposure-control: <plan title>"
git push
flux reconcile kustomization exposure-control -n flux-system --with-source
kubectl rollout status deployment/exposure-control -n default --timeout=180s
curl -fsS 'https://controlpanel.khzaw.dev/api/metrics?names=flux_status' | head -c 400
curl -fsS 'https://controlpanel.khzaw.dev/api/alert-rules' | head -c 400
```

Then open the `pulse` page in both light and dark themes and at a 400 px
viewport width.

## Pre-flight check before Phase 3

Confirm label names before adding registry entries. Run once through a port
forward:

```bash
kubectl -n monitoring port-forward svc/prometheus-operated 9090:9090 &
curl -s 'localhost:9090/api/v1/query?query=flux_resource_info' | jq '.data.result[0].metric'
curl -s 'localhost:9090/api/v1/rules?type=alert' | jq '.data.groups[0].rules[0] | {name, state, labels, alerts}'
curl -s 'localhost:9090/api/v1/query?query=controller_runtime_reconcile_total{job="monitoring/flux-controllers"}' | jq '.data.result[0].metric'
```

`flux_resource_info` comes from flux-operator via
`servicemonitor-flux-operator.yaml` and carries `kind`, `exported_namespace`,
`name`, `ready`, `suspended`, `reason`, `revision`
(see `prometheusrule-flux-reconciliation.yaml`). The rules API lists every
alerting rule including inactive ones; it does not know about Alertmanager
silences or inhibitions.
