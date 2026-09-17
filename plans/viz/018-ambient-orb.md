# 018 — Ambient orb driven by cluster signal

- **Status**: TODO
- **Phase**: 4 ambient
- **Category**: Ambient state; delight
- **Estimated scope**: 3 files, about 120 lines (pulse.js, app.js, index.html); styles.css only if the idle label needs a tone class
- **Dependencies**: 016 (Flux model), 017 (alert model)

## Problem

The header orb (`#controlActivityOrb`, drawn by `thinking-orb.js`) only
appears while an operator request is in flight, then hides itself 180 ms
later. Between requests the cockpit has no ambient sign of life. After
Phase 3 the client holds a live model of Flux readiness and alert state on
every 60 s refresh, which is exactly the signal an ambient indicator should
carry: the panel should look calm when the cluster is calm and visibly
different when something is reconciling or firing.

## Design

Keep operator activity as the top priority. When no request is in flight,
instead of hiding, the orb settles into an **ambient state** derived from
the Phase 3 models. The orb never changes state more than once per pulse
refresh, and it never animates faster than it does today.

**Signal mapping.** `Pulse.ambientState(fluxRows, alertRows)` returns one of
the existing `ORB_STATES` plus a label. No new orb modes are added to
`thinking-orb.js`.

| Condition (first match wins) | State | Label |
| --- | --- | --- |
| Any firing `critical` alert | `solving` | `1 critical alert` |
| Any Flux resource `ready="False"`, not suspended | `working` | `Reconciling glance` (name of the first, `+N` if more) |
| Any firing `warning` alert | `searching` | `2 warnings firing` |
| Any Flux resource `ready="Unknown"` or any pending alert | `shaping` | `Waiting on 3 signals` |
| Everything ready, nothing active | `listening` | `Cluster quiet` |
| Both models degraded | `listening`, paused | `Telemetry unavailable` |

`composing` stays reserved for operator requests so the two vocabularies do
not overlap visually.

**Visibility.** `#controlActivity` stays visible on every page once the
first pulse refresh has completed, not only on the pulse page. The label
text is the ambient label above. When an operator request starts,
`syncControlActivity` overrides state and label exactly as it does now;
when the last request finishes, instead of hiding after 180 ms it restores
the ambient state. `ariaLive` stays `polite`, and the label only changes
text when the ambient state actually changes, so screen readers do not hear
`Cluster quiet` every minute.

**Pausing.** In the `listening` state the orb runs at the slowest speed
`thinking-orb.js` supports for that mode; it does not pause, because a
frozen orb reads as broken. It pauses only in the degraded case and under
`prefers-reduced-motion`, which `thinking-orb.js` already observes
(`thinking-orb.js:444`). Under reduced motion the label alone carries the
state.

**Transition.** On an ambient state change the orb gets `.is-flashing` for
650 ms, same class and timer as the pulse blocks, and the same reduced-motion
override. This is the one-shot dither the motion direction allows.

**Budget.** The orb already runs a `requestAnimationFrame` loop while
visible. Keeping it visible full-time costs that loop on every page. Measure
on the Pi-served page in a mid-range phone before merging; if idle CPU
rises above about 3 percent, drop the loop's frame rate in `listening` to
one frame every 100 ms rather than hiding the orb.

## Changes

1. `pulse.js`: `Pulse.ambientState(fluxRows, alertRows)` returning
   `{ state, label, paused }`.
2. `app.js`: `syncControlActivity` gains an ambient fallback; `renderPulse()`
   (or the end of `loadPulse()`) calls `setAmbientActivity(...)` so the orb
   updates even when the pulse page is not the active page. This requires
   `loadPulse()` to run on every dashboard refresh, not only when
   `activePage === 'pulse'`; keep the existing "never block the operator
   controls" contract.
3. `index.html`: remove the `hidden` attribute's reliance on requests, or
   leave it and let the first pulse refresh clear it. Update the initial
   label to `Waiting for telemetry`.
4. `pulse-activity.test.js`: one case per row of the mapping table, plus
   the priority order and the degraded case.

## Verification

Load any non-pulse page and confirm the orb appears after the first refresh
with `Cluster quiet`. Trigger a deploy: the orb must switch to the operator
state during the request, then to `working` with the Kustomization name on
the next refresh, then back to `listening` once Flux reports ready. Fire a
warning as in plan 017 and confirm `searching`. Enable reduced motion in the
OS and confirm the orb is static and the label still updates. Check the
header at 400 px so the label does not push the theme switcher off-screen;
if it does, hide the label text below 480 px and keep the orb.
