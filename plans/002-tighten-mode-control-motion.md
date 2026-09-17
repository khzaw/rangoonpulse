# 002 — Tighten mode control motion

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: MEDIUM
- **Category**: Easing and duration; performance; cohesion
- **Estimated scope**: 1 file, about 35 lines changed

## Problem

The theme segmented control and Transmission VPN switch use a bouncy
`420ms` curve. They also animate `width`, which triggers layout and exceeds the
sub-`300ms` UI budget. The motion was authored for a softer interface and feels
out of character with the current square, monochrome cockpit.

```css
/* apps/exposure-control/styles.css:63 — current */
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--ease-snappy: cubic-bezier(0.3, 0.9, 0.4, 1);
--ease-spring: cubic-bezier(0.3, 1.28, 0.32, 1);
```

```css
/* apps/exposure-control/styles.css:438 — current */
.seg-thumb {
  /* ... */
  will-change: transform, width;
  transition:
    transform 420ms var(--ease-spring),
    width 420ms var(--ease-spring),
    opacity 240ms var(--ease-snappy),
    background 300ms var(--ease-snappy),
    box-shadow 300ms var(--ease-snappy);
}
```

```css
/* apps/exposure-control/styles.css:532 — current */
.toggle-knob {
  /* ... */
  transition:
    transform 420ms var(--ease-spring),
    width 200ms var(--ease-snappy),
    background 300ms var(--ease-snappy);
  will-change: transform;
}

.toggle-switch:not(:disabled):active .toggle-knob {
  width: 22px;
}
```

## Target

Extend the existing token block with the audit-standard movement curve and use
transform-only physical movement. Keep all motion below `300ms`.

```css
/* target token */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

```css
/* target theme control */
.theme-switcher > button {
  width: 72px;
}

.seg-icon {
  transition:
    opacity 160ms ease,
    transform 160ms var(--ease-out);
}

.seg-thumb {
  will-change: transform;
  transition:
    transform 200ms var(--ease-in-out),
    opacity 160ms var(--ease-out),
    background 160ms ease,
    box-shadow 160ms ease;
}
```

The fixed `72px` theme buttons mean the thumb no longer needs animated width.
The JavaScript may continue assigning the measured width; it will always resolve
to the same value after layout.

```css
/* target VPN control */
.toggle-switch {
  transition:
    border-color 160ms ease,
    background 160ms ease;
}

.toggle-knob {
  transform-origin: center;
  transition:
    transform 200ms var(--ease-in-out),
    background 160ms ease;
}

.toggle-switch:not(:disabled):active .toggle-knob {
  transform: scaleX(1.08);
}

.toggle-switch.on:not(:disabled):active .toggle-knob {
  transform: translateX(20px) scaleX(1.08);
}
```

Use `translateX(20px)` for both the resting on-state and its pressed variant;
do not pull the knob backward to `16px` on press.

## Repo conventions to follow

- Motion tokens are declared in the root token block at
  `apps/exposure-control/styles.css:63`.
- The existing tooltip motion at `apps/exposure-control/styles.css:1989` is a
  good example of short, property-specific transitions.
- The current visual pass deliberately removes hover lifts at
  `apps/exposure-control/styles.css:3504`; do not restore them.

## Steps

1. Add `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` next to the existing
   easing tokens. Do not create a second token block.
2. Give only `.theme-switcher > button` a fixed `72px` width. Do not affect
   other segmented controls if new ones have appeared.
3. Reduce `.seg-icon` active-state motion to `160ms`; keep its existing
   `scale(1.06)` endpoint.
4. Remove `width` from `.seg-thumb`'s `will-change` and transition list. Replace
   its movement and appearance timings with the target values above.
5. Reduce `.toggle-switch` border/background transitions to `160ms ease`.
6. Remove the toggle knob's width transition and the `width: 22px` pressed
   state. Implement the transform-only `scaleX(1.08)` press response, combining
   it with `translateX(20px)` in the on-state.
7. Remove the obsolete `translateX(16px)` pressed-on rule.

## Boundaries

- Do NOT change theme persistence or Transmission routing behavior.
- Do NOT animate `width`, `height`, `left`, `margin`, or padding.
- Do NOT change the pure `#ffffff`/`#000000` theme bases.
- Do NOT add a spring library or any dependency.
- If the mode-control selectors differ from commit `4b5fb68`, STOP and report
  the drift.

## Verification

- **Mechanical**:
  - `git diff --check` reports no whitespace errors.
  - `rg -n "width 420ms|width 200ms|translateX\(16px\)" apps/exposure-control/styles.css`
    returns no matches.
  - In DevTools, computed `.seg-thumb` transition properties exclude `width`;
    computed `.toggle-knob` transition properties exclude `width`.
- **Feel check**:
  - Switch System → Light → Dark rapidly. The thumb remains attached to the
    selected option and retargets without restarting or overshooting.
  - Press the VPN toggle without confirming the browser prompt. The knob
    compresses subtly but does not change layout.
  - At 10% playback, both controls settle cleanly within `200ms` and never
    bounce past their destination.
  - Toggle `prefers-reduced-motion`; Plan 003 defines the final reduced-motion
    behavior, so verify again after that plan lands.
- **Done when**: all control movement uses transforms, no movement exceeds
  `200ms`, and repeated switching remains crisp and interruptible.
