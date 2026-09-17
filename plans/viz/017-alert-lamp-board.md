# 017 — Alert lamp board

- **Status**: TODO
- **Phase**: 3 activity
- **Category**: Visual; activity signal
- **Estimated scope**: 5 files, about 240 lines (server.js route, server.test.js, pulse.js, app.js, styles.css)

## Problem

`infrastructure/monitoring/` defines 33 alert rules across eleven
PrometheusRule files. They page through Alertmanager to Telegram, and the
node twins already surface one of them (`rpi_low_voltage`) as an alarm
strip. The cockpit has no place that answers "is anything firing right
now?" without leaving for Grafana.

## Design

A `.lamp-board` block inside `#alertBoard`, section index `07`, title
`alerts`, detail `N firing · M pending · 33 rules` (the rule count comes from
the data, not a constant).

```
┌ 07 alerts ─────────────────────────────── 1 firing · 2 pending · 33 rules ┐
│ ● PVCUtilizationCritical      default/jellyfin-config    18 m   critical  │
│ ◐ FluxResourceNotReady        flux-system/glance          3 m   warning   │
│ ◐ CronJobMissedDeadline       monitoring/resource-advisor 1 m   warning   │
│                                                                           │
│ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░ │
│ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░ │
│ 30 quiet rules                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Data.** Prometheus's `/api/v1/rules?type=alert` endpoint returns every
alerting rule with its `name`, `labels.severity`, `state` (`inactive`,
`pending`, `firing`) and, for active rules, an `alerts` array carrying
`activeAt` and the instance labels. That is the whole board in one call, and
it is the only way to list quiet rules by name; `ALERTS` only has series for
active ones.

The metrics proxy only forwards `query` and `query_range`, so this plan adds
one read-only route, `GET /api/alert-rules`, next to `/api/metrics`
(`server.js:4643`). It forwards to `PROMETHEUS_URL + "/api/v1/rules?type=alert"`,
reuses the metrics upstream byte cap and timeout, and reduces the payload to:

```json
{ "state": "live", "fetchedAt": 1789700000,
  "rules": [{ "name": "PVCUtilizationCritical", "severity": "critical", "state": "firing",
              "alerts": [{ "labels": { "namespace": "default", "persistentvolumeclaim": "jellyfin-config" }, "activeAt": "..." }] }] }
```

Cache it for 60 seconds in a single module-level slot (there is one shape,
no parameters), and return `{ "state": "degraded", "rules": [] }` on upstream
failure, matching the metrics proxy's degraded contract. No new
environment variables and no NetworkPolicy change; the pod already reaches
`prometheus-operated.monitoring.svc.cluster.local:9090`.

`Pulse.fetchAlertRules()` in `pulse.js` wraps the call and stores the result
in `dashboardState.alertRules`. `loadPulse()` awaits it alongside the metric
batches, inside the same `Promise.all`, so a slow rules call never blocks
the other blocks.

**Active list.** `Pulse.alerts(rules, nowSeconds)` returns rows sorted
firing before pending, critical before warning, then by age descending. Each row: state glyph, `alertname`, the most specific
subject label present (`namespace/persistentvolumeclaim`, `namespace/name`,
`namespace/pod`, `node`, or `namespace` alone), age from `activeAt`, and
severity in Plex Mono.

Glyphs: filled circle in `var(--red)` for firing critical, filled circle in
`var(--yellow)` for firing warning, half circle in `var(--text-2)` for
pending. No blinking. The row for a newly firing alert gets `.is-flashing`
once, using the same `Map`-diff and 650 ms timer as plan 016.

**Quiet lamps.** Every rule that is neither pending nor firing is one
`.lamp` cell, 10 px square, filled with `--ink-step-1` through a halftone
pattern from `Pulse.halftoneDefs`, laid out in a wrapping flex row. Hover or
focus shows the rule name in the existing tooltip style. This is the only
part of the board that scales with rule count; at 33 rules it is one or two
lines.

**Empty state.** When nothing is active, the list area shows
`Nothing firing` in `var(--text-3)` at the section detail scale, and the
lamp rows fill the block. When the rules response is degraded, the detail reads
`alert state unavailable` and the block keeps its last rendered rows with
`aria-busy="true"`, like the other pulse blocks. When `rules` is `live`
but empty, something is wrong upstream; say `no rules loaded` rather than
drawing an empty quiet board.

**Silences.** Alertmanager silences and inhibitions are not visible from
the Prometheus rules API. A silenced alert still shows as firing here. That
is acceptable for a first version because the cockpit has no silence
workflow; note it in the section detail tooltip rather than adding an
Alertmanager route.

## Changes

1. `server.js`: `GET /api/alert-rules` route, reducer, cache slot.
   `server.test.js` cases for the reduced shape, the degraded response, and
   that a second request inside 60 s makes no upstream call.
2. `pulse.js`: `Pulse.fetchAlertRules()`, `Pulse.alerts(...)`,
   `Pulse.alertSubject(labels)`.
3. `app.js`: rules fetch inside `loadPulse()`; `renderAlertBoard()` in
   `renderPulse()`; the flash diff `Map`.
4. `styles.css`: `.lamp-board`, `.alert-row`, `.alert-glyph`, `.lamp-grid`,
   `.lamp`, reduced-motion override for `.alert-row.is-flashing`.
5. `pulse-activity.test.js`: sort order, subject selection precedence, age
   formatting, and that a pending alert never outranks a firing one.

## Verification

Fire a real warning without touching production data: scale a workload
covered by `prometheusrule-cronjob-deadman.yaml` to miss one schedule, or
temporarily lower a PVC threshold in a scratch PrometheusRule applied with
`kubectl apply` and removed afterwards. Confirm the row appears within two
refreshes, flashes once, shows the right subject and age, and disappears
after resolution. Cross-check counts against
`curl -s localhost:9090/api/v1/rules?type=alert | jq '[.data.groups[].rules[] | select(.state!="inactive")] | length'`
through the port forward, and confirm `curl -fsS https://controlpanel.khzaw.dev/api/alert-rules`
stays under a few kilobytes. Tab through the quiet lamps and confirm each tooltip.
