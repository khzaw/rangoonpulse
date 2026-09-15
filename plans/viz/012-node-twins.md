# 012 — Node twins

- **Status**: IMPLEMENTED — pending live verification
- **Commit**: 630906f
- **Phase**: 1 physical
- **Category**: Visual; hardware state
- **Estimated scope**: 3 files, about 260 lines (pulse.js, app.js, styles.css)

## Problem

The cluster is two physical machines with very different shapes: an amd64
tower at `10.0.0.197` and a Raspberry Pi at `10.0.0.38`. Nothing on the panel
shows them as objects. CPU, memory, estimated watts and the Pi low-voltage
alarm are all computed by recording rules already and are exposed by plan 010,
but only as tile numbers.

## Design

Two `article.node-twin` cards inside `#nodeTwins`, side by side above 720 px
and stacked below. Each card:

```
┌ talos-7nf-osf ─────────── amd64 · control-plane ┐
│  ┌────┐   cpu   ▓▓▓▓▓░░░░░  19 %  (req 62 %)     │
│  │    │   mem   ▓▓▓▓▓▓▓░░░  39 %  (req 71 %)     │
│  │    │   power ▓▓▓░░░░░░░  38 W                 │
│  └────┘   51 pods · kernel 6.18.36 · ready       │
└──────────────────────────────────────────────────┘
```

**Silhouette.** One inline SVG per architecture, 1 px stroke in
`currentColor`, no fill: a tall rectangle with two horizontal slots for
amd64, a wide rectangle with a 2×2 pin grid and a rounded USB block for
arm64. About 12 path commands each; hard-coded in `pulse.js` as
`Pulse.silhouette(arch)`.

**Fill bars.** Three horizontal bars using a halftone fill rather than a
solid meter, so they read as part of the dither material:

```css
.twin-bar { height: 10px; background: var(--meter-bg); position: relative; }
.twin-bar-fill {
  position: absolute; inset: 0 auto 0 0;
  background-image: radial-gradient(circle, var(--ink-step-5) 1.1px, transparent 1.5px);
  background-size: 4px 4px;
}
.twin-bar-fill.warning { background-image: radial-gradient(circle, var(--yellow) 1.1px, transparent 1.5px); }
.twin-bar-fill.danger  { background-image: radial-gradient(circle, var(--red) 1.1px, transparent 1.5px); }
```

Width is set inline from the last value. A thin `twin-bar-request` tick (1 px,
`var(--border-strong)`) marks the requested ratio on the cpu and memory bars
so live usage and scheduler commitment sit on the same line.

**Data** (all via `Pulse.fetch`, added to `loadPulse`): `node_cpu`, `node_mem`,
`node_watts` at 24 h; `node_req_cpu`, `node_req_mem`, `node_info`,
`node_ready`, `node_pods`, `rpi_low_voltage` instant. Join on the `node`
label. If the pre-flight check shows the recording rules use `instance`
instead, map through `node_info`'s `internal_ip` once in `Pulse.byLabel`
and keep the rest of the code on `node`.

**Alarm.** When `rpi_low_voltage` is `1` for the utility node, the Pi card
shows `.twin-alarm` in the header: a 10 px square filled with `var(--red)`,
labelled `low voltage`. It blinks with a 1.2 s step animation in normal
motion and stays solid under `prefers-reduced-motion`. When the alarm is `0`
the element is not rendered at all.

**Readiness.** If `node_ready` is missing or `0`, the whole card gets
`.is-down`: silhouette stroke switches to `var(--red)`, bars are drawn with
the 1-bit checkerboard (`--dither-check`, `styles.css:678`) and values read
`n/a`.

**Sparkline row.** Under the three bars, one 24 h sparkline of watts using
`Pulse.sparkline` with `fill: true`, so the card also carries history.

## Changes

1. `pulse.js`: `Pulse.silhouette(arch)`, `Pulse.twinCard(model)` returning
   the card HTML from a plain object `{ name, arch, roles, ready, cpu, mem,
   watts, reqCpu, reqMem, pods, kernel, lowVoltage, wattsSeries }`.
2. `app.js`: extend `loadPulse` names; `renderNodeTwins()` builds the two
   models (primary first, ordered by `kube_node_info` role label) and sets
   `#nodeTwins.innerHTML`; a section bar with heading `nodes` and detail
   `2 ready · 74 pods`.
3. `styles.css`: `.node-twin*`, `.twin-bar*`, `.twin-alarm`, the blink
   keyframes, and the reduced-motion override.

## Verification

After deploy, compare the card values against:

```bash
kubectl top nodes
kubectl get pods -A -o wide --no-headers | awk '{print $8}' | sort | uniq -c
```

CPU and memory should agree within a few percent (the recording rules average
over 5 m). Simulate the down state by temporarily editing the rendered model
in devtools; confirm the checkerboard fill appears in both themes. Confirm the
alarm square is absent while the Pi has no low-voltage event.
