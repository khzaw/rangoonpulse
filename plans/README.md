# Control panel animation plans

These plans were written against commit `4b5fb68`. They are intentionally
scoped to the `apps/exposure-control` cockpit and preserve its literal white and
black bases. As of `1153031` none of them has landed; the reduced-motion block
in `styles.css` is still the blanket `animation: none` rule and the mode
controls still animate `width` with the 420 ms spring.

The visualization plans in [`viz/`](viz/README.md) reference plan 003 for
their reduced-motion contract. Until 003 lands, each pulse block carries its
own `prefers-reduced-motion` override.

| Plan | Title | Severity | Status | Dependencies |
| --- | --- | --- | --- | --- |
| [001](001-stop-secret-filter-animation-replays.md) | Stop secret filter animation replays | HIGH | TODO | None |
| [002](002-tighten-mode-control-motion.md) | Tighten mode control motion | MEDIUM | TODO | None |
| [003](003-preserve-reduced-motion-feedback.md) | Preserve feedback in reduced-motion mode | MEDIUM | TODO | None |
| [004](004-animate-overview-deltas.md) | Animate overview deltas instead of layout | MEDIUM | TODO | 002, 003 |
| [005](005-bridge-skeleton-content-swaps.md) | Bridge skeleton-to-content swaps | LOW | TODO | 003 |
| [006](006-add-dithered-success-feedback.md) | Add dithered success feedback | LOW | TODO | 003; reuse 005 media query if present |

## Recommended execution order

1. **001** removes high-frequency motion that should not exist.
2. **002** establishes the crisp movement curve and fixes layout animation.
3. **003** establishes the accessibility contract before adding new effects.
4. **004** uses the movement token and reduced-motion contract for metric
   deltas.
5. **005** adds the shared reduced-motion media-query helper and bridges only
   genuine skeleton replacements.
6. **006** adds the localized dither identity after the motion and accessibility
   foundations are stable.

Plans 001–003 may be implemented and reviewed independently. Plan 004 must not
start before 002 and 003. Plans 005 and 006 may be executed together, but they
must share one cached `reducedMotionMedia` object rather than declaring two.

## Product motion direction

The cockpit should feel like a precise operator console:

- state changes move quickly and only when motion improves comprehension;
- tables, filters, status indicators, and routine hover interactions remain
  still;
- animation uses transform and opacity, never layout dimensions;
- reduced motion keeps concise appearance feedback without positional movement;
- dithering is a transient success signal, never an ambient page texture.

Use `improve-animations execute <plan>` for implementation. After each plan is
implemented and reviewed, update its status and this table from `TODO` to
`DONE`.
