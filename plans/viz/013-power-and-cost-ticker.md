# 013 — Power and cost ticker

- **Status**: IMPLEMENTED — pending live verification
- **Commit**: 630906f
- **Phase**: 1 physical
- **Category**: Visual; derived metric
- **Estimated scope**: 3 files, about 180 lines (pulse.js, app.js, styles.css)

## Problem

`prometheusrule-power-estimation.yaml` already produces
`homelab:cluster_estimated_power_watts` and a
`homelab:singapore_household_tariff_sgd_per_kwh` constant. The Grafana power
dashboard shows them, the panel does not. Cost is the one number that makes a
homelab feel like a running machine rather than a list of services.

## Design

A single wide `.power-ticker` block inside `#powerTicker`:

```
┌ power ──────────────────────────────────── 7 d · S$0.31/kWh ┐
│  41 W now      0.98 kWh / 24 h      S$0.30 / day     S$9.1 / 30 d │
│  ▁▂▂▃▂▂▁▁▂▃▄▃▂▂▁▁▂▂▃▂▂▁▁▂▂▃▃▂▂▁▁▂▂▂▃▂▂▁▁▂▂▃▃▂▂▁▁▂▂▃▂▂▁▁▂▂▂ │
│  mon      tue      wed      thu      fri      sat      sun │
└────────────────────────────────────────────────────────────┘
```

**Data.** `cluster_watts` at `7d` (step derives to 1 h under the
300-point cap) and `tariff` instant. Both already exist in the registry.

**Derived values** (client side, in `Pulse.power(series, tariff)`):

- `nowWatts`: last non-null value.
- `kwh24h`: mean of the last 24 h of points × 24 / 1000.
- `sgdPerDay`: `kwh24h × tariff`.
- `sgd30d`: mean over the full 7 d window × 24 × 30 / 1000 × tariff.

If `tariff` is degraded or empty, render watts and kWh only and put
`tariff unavailable` in the section detail. Never show a cost with a guessed
tariff.

**Waveform.** `Pulse.sparkline` with `fill: true` and a dotted SVG `pattern`
fill instead of a flat polygon, so the area reads as halftone. The pattern is
defined once inside the SVG:

```svg
<pattern id="pw-dots" width="4" height="4" patternUnits="userSpaceOnUse">
  <circle cx="2" cy="2" r="1" fill="currentColor"/>
</pattern>
```

Add a `pattern` option to `Pulse.sparkline` for this. Height 56 px. Day
boundaries at local midnight (`Asia/Singapore`, the browser's zone here)
are drawn as 1 px vertical lines in `var(--subtle-line-strong)` with
weekday labels beneath in `var(--text-3)`, Plex Mono, 11 px.

**Numbers.** Four `.ticker-stat` cells, value in `.overview-value` scale,
label in `.overview-label` scale. If plan 004 (animate overview deltas)
has landed, wire the `nowWatts` cell through the same delta helper; otherwise
plain text.

## Changes

1. `pulse.js`: `Pulse.power(...)`, `pattern` and `ticks` options on
   `Pulse.sparkline` (`ticks` takes an array of `{ x, label }`).
2. `app.js`: `renderPowerTicker()`; add `7d` fetch for `cluster_watts`
   alongside the 24 h one. The metrics layer keys state by `name|range`, so
   both coexist.
3. `styles.css`: `.power-ticker`, `.ticker-stats` (4-up grid, 2-up under
   560 px), `.ticker-wave`, `.ticker-days`.

## Verification

Cross-check the numbers against Grafana's `Node Power Estimation` dashboard
for the same window. `nowWatts` should match its stat panel exactly; the
daily cost should match within rounding. Cover the tariff case by requesting
`?names=tariff` directly and confirming the value is non-empty. Confirm
weekday labels align with midnight ticks in a browser set to
`Asia/Singapore`.
