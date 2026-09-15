# 011 — Metrics client, pulse page and sparklines

- **Status**: DONE — live verified 2026-09-16
- **Commit**: 630906f
- **Phase**: 0 foundation
- **Category**: Client data layer; layout; first visual
- **Estimated scope**: 5 files, about 320 lines (new pulse.js, index.html, app.js, styles.css, kustomization.yaml)

## Problem

`app.js` fetches everything inside one `Promise.allSettled` in `loadDashboard`
(`app.js:2139`) and renders number tiles through `overviewSegment`
(`app.js:795`). There is no place on the page for cluster visuals, no metrics
state, no periodic silent refresh, and no chart primitive. The overview strip
already holds seven tiles and is shared across pages, so new visuals need
their own page rather than more tiles there.

## Design

**Pulse page.** Add `<section id="pulse" class="section" data-page-section>`
as the first page section in `index.html`, and a `pulse` nav pill as the first
entry of `.section-nav`. `normalizePage` (`app.js:244`) must accept `pulse`.
The page opens with a section bar, then a `#pulseStrip.overview-strip` of
four tiles, then empty mount points that later plans fill, in this order:

```html
<div id="pulseStrip" class="overview-strip pulse-strip"></div>
<div id="nodeTwins" class="pulse-block"></div>        <!-- 012 -->
<div id="powerTicker" class="pulse-block"></div>      <!-- 013 -->
<div id="placementMap" class="pulse-block"></div>     <!-- 014 -->
<div id="storageTanks" class="pulse-block"></div>     <!-- 015 -->
<div id="fluxRibbon" class="pulse-block"></div>       <!-- 016 -->
<div id="alertBoard" class="pulse-block"></div>       <!-- 017 -->
```

Each block gets its own `.section-bar` heading when its plan lands. Empty
blocks render nothing.

**Client metrics layer** in a new `pulse.js`, loaded before `app.js` and
exposing `window.Pulse` (same shape as `window.ThinkingOrbs`):

- `Pulse.fetch(names, range)` → calls `/api/metrics`, returns the parsed body.
- `Pulse.last(series)` → last numeric value or `null`.
- `Pulse.values(series)` → array of numbers with nulls preserved.
- `Pulse.byLabel(metric, key)` → `Map<labelValue, series>` for instant metrics.
- `Pulse.sparkline(values, options)` → inline SVG string. `viewBox 0 0 120 28`,
  `preserveAspectRatio="none"`, a single `polyline` with
  `vector-effect="non-scaling-stroke"`, `stroke="currentColor"`, width 1.25.
  Gaps (`null`) break the line. Options: `min`, `max` (default data range with
  5% padding), `dot` (draw a 2 px square at the last point), `fill` (add a
  `polygon` under the line at `opacity: .12`).
- `Pulse.fmt` with `pct`, `watts`, `bytes`, `sgd` formatters, all using
  `withUnitSpace` (`app.js:427`) semantics.
- `Pulse.inkStep(ratio)` → integer 0..5 for halftone density, used by 014 and
  015.

`app.js` gains `dashboardState.metrics` and a `loadPulse(options)` that
requests the names the pulse page needs (this plan: `node_cpu`, `node_mem`,
`cluster_watts`, `restarts_1h` at `24h`). `loadDashboard` adds it to the
`allSettled` list. A `setInterval` of 60 s calls `loadPulse({ silent: true })`
only when `document.visibilityState === 'visible'` and `activePage === 'pulse'`.
Silent refreshes never touch skeletons.

**Sparkline tiles.** Extend `overviewSegment` with `options.series`. When
present it inserts `<div class="overview-spark">` + the sparkline between
`.overview-value` and `.overview-subtitle`. Nothing else in the segment
changes, so existing tiles are unaffected. `renderPulseStrip()` draws:

| tile | value | series | tone |
| --- | --- | --- | --- |
| cpu | primary node last value as `%` | `node_cpu` for primary | warning above 70 % |
| memory | primary node last value as `%` | `node_mem` for primary | warning above 80 % |
| power | `cluster_watts` last as `W` | `cluster_watts` | status |
| restarts | `restarts_1h` last, integer | `restarts_1h` | warning above 0 |

The subtitle carries the 24 h min and max. Sparkline colour is
`var(--text-1)`; the tone class only affects the existing meter bar.

**CSS.**

```css
.overview-spark { height: 28px; margin: 6px 0 4px; color: var(--text-1); }
.overview-spark svg { display: block; width: 100%; height: 100%; }
.pulse-block:empty { display: none; }
.pulse-block { padding: 18px 0 0; }
```

No draw-in animation. Add the `--ink-step-1..5` tokens now (light
`:root` and both dark blocks) so 014 and 015 do not each touch the token
blocks:

```css
--ink-step-1: rgba(26, 28, 35, 0.12);
--ink-step-2: rgba(26, 28, 35, 0.24);
--ink-step-3: rgba(26, 28, 35, 0.40);
--ink-step-4: rgba(26, 28, 35, 0.58);
--ink-step-5: rgba(26, 28, 35, 0.80);
```

with the white equivalents in dark mode.

## Changes

1. `kustomization.yaml`: add `pulse.js` to `configMapGenerator.files`.
2. `server.js:4491` `CONTROL_PANEL_ASSETS`: add `/assets/pulse.js`;
   `server.js:4612` regex: include `pulse\.js`.
3. `index.html`: pulse section and nav pill; `<script src="/assets/pulse.js" defer>`
   before `app.js`.
4. `pulse.js`: the module above, no DOM access except through returned strings.
5. `app.js`: `dashboardState.metrics`, `loadPulse`, `renderPulseStrip`,
   `overviewSegment` series option, page registration, visibility-aware
   interval.
6. `styles.css`: tokens and the rules above.

## Verification

```bash
kubectl kustomize apps/exposure-control | grep -c 'pulse.js'   # expect 1
node --test apps/exposure-control/server.test.js
```

After deploy: open `/#pulse`, confirm four tiles with 24 h lines in light and
dark themes; switch to another page and confirm in devtools that no
`/api/metrics` request fires for 60 s; return and confirm one fires. Resize to
400 px: tiles stack, lines still span the tile.
