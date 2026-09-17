# 004 — Animate overview deltas instead of layout

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: MEDIUM
- **Category**: Performance; state indication
- **Estimated scope**: 2 files, about 80 lines changed

## Problem

The overview strip is replaced wholesale whenever dashboard state changes.
Every meter is inserted at its final inline width, so the declared `600ms`
width transition usually has no previous rendered value to animate from. If it
does run, animating width triggers layout on a dense seven-segment strip.

```js
// apps/exposure-control/app.js:737 — current
function overviewSegment(label, value, subtitle, options) {
  const eyebrow = options && options.eyebrow ? '<span class="overview-eyebrow">' + options.eyebrow + '</span>' : '';
  const barPct = Math.max(0, Math.min(100, Number(options && options.barPct || 0)));
  const tone = options && options.tone ? options.tone : 'neutral';
  return (
    '<section class="overview-segment">' +
      '<div class="overview-segment-head"><span class="overview-label">' + label + '</span>' + eyebrow + '</div>' +
      '<div class="overview-value">' + value + '</div>' +
      '<div class="overview-subtitle">' + subtitle + '</div>' +
      '<div class="overview-meter"><span class="overview-meter-fill ' + tone + '" style="width:' + barPct.toFixed(1) + '%"></span></div>' +
    '</section>'
  );
}
```

```js
// apps/exposure-control/app.js:791 — current
overviewStripEl.innerHTML =
  overviewSegment('exposures', String(activeExposures), services.length + ' configured share targets', {
    eyebrow: 'temporary public',
    barPct: services.length ? activeExposures / services.length * 100 : 0,
    tone: activeExposures > 0 ? 'warning' : 'status',
  }) +
  // six more overviewSegment calls
```

```css
/* apps/exposure-control/styles.css:1411 — current */
.overview-meter-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 600ms var(--ease-out);
}
```

## Target

Collect each segment's previous value and percentage before replacing the
markup. After insertion, animate only segments whose value or percentage
changed. Initial rendering stays still.

Give every segment a stable key and numeric percentage:

```js
/* target shape */
function overviewSegment(key, label, value, subtitle, options) {
  const barPct = Math.max(0, Math.min(100, Number(options && options.barPct || 0)));
  return (
    '<section class="overview-segment" data-overview-key="' + escapeHtml(key) + '" data-overview-value="' + attrText(value) + '" data-bar-pct="' + barPct.toFixed(1) + '">' +
      // existing content
      '<div class="overview-meter"><span class="overview-meter-fill ' + tone + '" style="transform:scaleX(' + (barPct / 100).toFixed(3) + ')"></span></div>' +
    '</section>'
  );
}
```

Before assigning `innerHTML`, collect a map keyed by `data-overview-key` with
the previous `data-overview-value` and `data-bar-pct`. After insertion:

1. Set each changed fill to its previous `scaleX(previous / 100)` with
   transitions disabled.
2. Force one style flush on that fill.
3. Restore its transition and set `scaleX(next / 100)`.
4. Give a changed `.overview-value` the starting class
   `.is-overview-changing`, then remove it in the next animation frame.

```css
/* target */
.overview-meter-fill {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transition: transform 180ms var(--ease-in-out);
}

.overview-value {
  transition:
    opacity 160ms var(--ease-out),
    transform 160ms var(--ease-out);
}

.overview-value.is-overview-changing {
  opacity: 0.35;
  transform: translateY(2px);
}
```

Use `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` from Plan 002 for the
on-screen meter movement. Do not animate number counting.

Reduced motion must keep only the value fade and make meter changes immediate:

```css
@media (prefers-reduced-motion: reduce) {
  .overview-meter-fill {
    transition: none !important;
  }

  .overview-value {
    transform: none !important;
    transition: opacity 100ms linear !important;
  }

  .overview-value.is-overview-changing {
    opacity: 0.7;
    transform: none !important;
  }
}
```

## Repo conventions to follow

- Escape generated HTML with `escapeHtml` and attribute text with `attrText`,
  both in `apps/exposure-control/app.js`.
- Use the existing `--ease-out` token for entrances and the Plan 002
  `--ease-in-out` token for movement between two on-screen values.
- The site-deploy card setup at `apps/exposure-control/app.js:1028` shows the
  existing pattern of applying temporary render state and cleaning it up.

## Steps

1. Update `overviewSegment` to accept a stable `key` as its first argument and
   emit `data-overview-key`, `data-overview-value`, and `data-bar-pct`.
2. Update all seven calls with stable keys: `exposures`, `transmission`,
   `planner`, `image-updates`, `chart-updates`, `travel`, and `advisor-fetch`.
3. Before replacing `overviewStripEl.innerHTML`, collect the previous value and
   percentage for each existing keyed segment.
4. After replacement, initialize every fill at its final `scaleX`. For entries
   with a previous percentage that differs, temporarily disable transition,
   set the old scale, flush that fill's layout once, restore transition, and
   set the new scale.
5. For entries whose displayed value differs, add
   `.is-overview-changing` and remove it in `requestAnimationFrame` so the CSS
   transition retargets to the settled state.
6. Replace the `width 600ms` CSS with the exact transform and value transitions
   above.
7. Add the exact reduced-motion overrides above to the consolidated block from
   Plan 003.

## Boundaries

- Do NOT animate initial page load; there is no previous state to explain.
- Do NOT animate unchanged values after routine re-renders.
- Do NOT count numbers up or interpolate text.
- Do NOT animate `width`, `height`, margin, padding, `left`, or `top`.
- Do NOT change metric calculations, labels, tones, or the white/black bases.
- Do NOT add dependencies.
- If `renderOverview` no longer replaces the strip as shown at commit
  `4b5fb68`, STOP and report the drift.

## Verification

- **Mechanical**:
  - `node --check apps/exposure-control/app.js` exits `0`.
  - `git diff --check` reports no whitespace errors.
  - `rg -n "transition: width|style=\"width:" apps/exposure-control` returns no
    overview-meter implementation.
  - `kubectl kustomize apps/exposure-control >/dev/null` exits `0`.
- **Feel check**:
  - Load the cockpit once: values and meters appear immediately without a
    choreographed entrance.
  - Trigger Refresh All with at least one changed metric. Only changed values
    fade/settle and only changed meter fills move.
  - At 10% playback, the meter transform begins at the previous percentage and
    ends at the new one; it never collapses to zero.
  - Trigger another refresh before movement settles. The transition retargets
    from its current visual position without a keyframe restart.
  - Under `prefers-reduced-motion`, values use a `100ms` opacity cue and meters
    jump directly to their new scale.
- **Done when**: changed metrics are legible, unchanged metrics stay still, and
  DevTools records transform/opacity animation only.
