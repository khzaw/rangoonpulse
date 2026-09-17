# 016 — Flux reconcile ribbon

- **Status**: TODO
- **Phase**: 3 activity
- **Category**: Visual; activity signal
- **Estimated scope**: 4 files, about 220 lines (server.js registry, pulse.js, app.js, styles.css)

## Problem

The panel can request a Flux reconcile but never shows what Flux is doing.
`prometheusrule-flux-reconciliation.yaml` alerts when a resource is not ready,
stuck or suspended, and the GitOps change timeline dashboard in Grafana shows
reconcile throughput, but none of it reaches the cockpit. After a deploy an
operator has no way to watch the change land except by polling `flux get`.

`flux_reconciles` and `flux_errors` are already in `METRIC_QUERIES` and were
never wired to the client.

## Design

A single `.flux-ribbon` block inside `#fluxRibbon`, section index `06`,
title `gitops`, detail `N resources · M not ready · K suspended`.

```
┌ 06 gitops ─────────────────────────── 41 resources · 0 not ready · 2 suspended ┐
│ ▁▂▁▁▃▁▁▂▁▁▁▄▁▁▂▁▁▁▁▂▁▁▃▁▁▁▂▁▁▁▁▁▂▁▁▁▁▂▁▁▁▁▁▂▁▁▁  reconciles / 5 min, 24 h    │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  errors                       │
│                                                                                 │
│ GitRepository  flux-system         ● main@sha1:cf56970      2 m ago            │
│ Kustomization  apps                ● ready                                     │
│ Kustomization  exposure-control    ● ready                                     │
│ HelmRelease    jellyfin            ○ suspended                                 │
│ HelmRelease    glance              ◐ progressing   HelmChart pending           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Data.** Add one registry entry:

```js
flux_status: { expr: 'max by(kind,exported_namespace,name,ready,suspended,reason,revision)(flux_resource_info)', labels: "kind exported_namespace name ready suspended reason revision" },
```

Fetch `flux_reconciles`, `flux_errors` and `flux_status` at `24h` in a new
batch in `pulseBatches`.

**Throughput strip.** Two stacked `Pulse.sparkline` rows, 28 px each.
The top sums `flux_reconciles` across all controllers and results. The
bottom sums `flux_errors`; when the whole series is zero it renders as a
flat dotted baseline in `var(--text-3)` rather than an empty chart, so
"no errors" is visible rather than absent.

**Resource list.** `Pulse.fluxResources(statusMetric)` returns rows sorted
by: not ready first, then suspended, then the rest grouped by kind in the
order GitRepository, OCIRepository, HelmRepository, Kustomization,
HelmRelease. Each row: kind in Plex Mono, name, state glyph, and the
`reason` text when `ready != "True"`. The GitRepository row also shows the
short revision (`main@sha1:` followed by the first seven characters).

The list is folded to the first eight rows behind a `Show all N` toggle,
identical in markup and behaviour to the storage tank fold.

State glyphs use existing tokens only: filled circle in `var(--text-1)` for
ready, hollow circle in `var(--text-3)` for suspended, half circle for
`Unknown`, filled circle in `var(--red)` for `False`.

**State-change flash.** `renderFluxRibbon` keeps the previous
`revision` per row in a module-level `Map`. A row whose revision or
`ready` value changed since the last render gets `.is-flashing` for
650 ms, same timer pattern as the placement map. Nothing flashes on the
first render.

## Changes

1. `server.js`: `flux_status` registry entry. Add a `server.test.js` case
   asserting the name is served and that its `labels` list round-trips.
2. `pulse.js`: `Pulse.fluxResources(metric)` and `Pulse.fluxThroughput(
   reconciles, errors)` (the latter sums by timestamp across label sets).
3. `app.js`: new batch in `pulseBatches`; `renderFluxRibbon()` called from
   `renderPulse()`; fold toggle click handler on `#fluxRibbon`.
4. `styles.css`: `.flux-ribbon`, `.flux-strip`, `.flux-rows`, `.flux-row`,
   `.flux-glyph`, the fold button (reuse the tank fold styles by adding the
   selector rather than copying the rules), and a reduced-motion override
   for `.flux-row.is-flashing`.
5. `pulse-activity.test.js`: sort order, revision shortening, the all-zero
   error baseline case, and that a resource with `suspended="True"` is
   never counted as not ready.

## Verification

Trigger a deploy from the panel and watch the ribbon on the next 60 s
refresh: the GitRepository row must show the new short SHA and flash once,
and the Kustomization row must go `progressing` then `ready`. Compare the
`not ready` count with `flux get all -A | grep -c False`. Suspend a
HelmRelease with `flux suspend hr <name> -n <ns>`, confirm the hollow glyph
and the count, then resume it. Check the fold toggle by keyboard.
