# 003 — Preserve feedback in reduced-motion mode

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, about 30 lines changed

## Problem

The reduced-motion rule disables every animation and every transition. This
correctly removes movement, but it also removes useful color, background,
border, and opacity feedback from controls. Reduced motion should be gentler,
not inert.

```css
/* apps/exposure-control/styles.css:2922 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
  html {
    scroll-behavior: auto;
  }

  .site-deploy-grid .site-deploy-card {
    transform: none !important;
    transition: opacity 100ms linear !important;
  }

  .secret-key-row {
    transition: opacity 100ms linear !important;
  }

  .secret-key-row.is-removing {
    transform: none !important;
  }
}
```

Separate reduced-motion blocks below this rule repeat related overrides for
tooltips and `@starting-style`, making the behavior harder to reason about.

## Target

Keep the global movement stop, then explicitly restore `100ms linear`
color/appearance feedback on interactive elements. Transform-based motion and
continuous keyframes remain disabled.

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }

  html {
    scroll-behavior: auto;
  }

  :is(
    button,
    a,
    input,
    select,
    .seg-switch > button,
    .vpn-toggle-label,
    .nav-pill,
    .toggle-filter,
    .search-shell,
    .control-select
  ) {
    transition:
      color 100ms linear,
      background-color 100ms linear,
      border-color 100ms linear,
      opacity 100ms linear !important;
  }

  .site-deploy-grid .site-deploy-card,
  .secret-key-row,
  .updates-version-diff::after,
  .has-full-tooltip::after {
    transform: none !important;
    transition: opacity 100ms linear !important;
  }

  .secret-key-row.is-removing {
    transform: none !important;
  }
}
```

Consolidate the existing reduced-motion blocks into this single media query.
For `@starting-style`, retain only an opacity difference:

```css
@media (prefers-reduced-motion: reduce) {
  @starting-style {
    .site-deploy-grid .site-deploy-card {
      opacity: 0.85;
      transform: none !important;
    }
  }
}
```

## Repo conventions to follow

- The cockpit already uses `100ms linear` for reduced-motion opacity feedback
  at `apps/exposure-control/styles.css:2935`.
- Hover-only tooltips are gated by
  `@media (hover: hover) and (pointer: fine)` at
  `apps/exposure-control/styles.css:1989`; preserve that pointer gating.
- Keep all reduced-motion overrides near the existing responsive section.

## Steps

1. Replace the three overlapping reduced-motion blocks with one consolidated
   block plus the existing reduced-motion `@starting-style` block.
2. Retain the global `animation: none !important` and
   `transition: none !important` reset so movement cannot leak through.
3. Add the exact interactive-element transition allowlist shown above.
4. Include both `.updates-version-diff::after` and `.has-full-tooltip::after`
   in the opacity-only tooltip override.
5. Keep deploy-card and secret-row transforms disabled while retaining their
   `100ms linear` opacity feedback.
6. Re-check later-added selectors from Plans 004–006 and extend this media query
   only where those plans explicitly require reduced-motion opacity feedback.

## Boundaries

- Do NOT use `prefers-reduced-motion` to remove all visual feedback.
- Do NOT re-enable translate, scale, rotate, scroll, or continuous animation.
- Do NOT change non-motion layout or colors.
- Do NOT remove the `(hover: hover) and (pointer: fine)` gate from tooltips.
- Do NOT add JavaScript media-query listeners in this plan.
- If the reduced-motion section has changed since commit `4b5fb68`, STOP and
  report the drift.

## Verification

- **Mechanical**:
  - `git diff --check` reports no whitespace errors.
  - `rg -n "prefers-reduced-motion" apps/exposure-control/styles.css` shows one
    consolidated behavior block and one scoped `@starting-style` block.
  - `kubectl kustomize apps/exposure-control >/dev/null` exits `0`.
- **Feel check**: emulate `prefers-reduced-motion: reduce` in DevTools.
  - Buttons, links, theme options, and inputs retain a short color/background
    response.
  - Theme thumb, VPN knob, page content, cards, and secret rows do not move.
  - Tooltips fade in without translating.
  - At 10% playback, no transform animation is present.
- **Done when**: reduced-motion users receive clear `100ms` appearance feedback
  and zero positional movement.
