# 006 — Add dithered success feedback

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: LOW
- **Category**: Missed opportunity; feedback and delight
- **Estimated scope**: 2 files, about 90 lines changed

## Problem

Rare, consequential operations currently end by removing a spinner and updating
an inline message. The state is technically correct but emotionally flat; it is
also easy to miss which control completed after a list re-render.

```js
// apps/exposure-control/app.js:1056 — current
async function runSiteDeployment(siteId, button) {
  setBtnLoading(button, true);
  setSiteDeployMsg('Reconciling only ' + siteId + ' through its Flux image automation...');
  try {
    const payload = await request('/api/site-deployments/' + encodeURIComponent(siteId) + '/run', 'POST', {});
    const handled = (payload.steps || []).filter((step) => step.handled).length;
    const total = (payload.steps || []).length;
    setSiteDeployMsg((payload.message || 'Deploy reconcile requested.') + ' ' + handled + '/' + total + ' controller(s) acknowledged the request.');
    await loadSiteDeployments();
  } catch (err) {
    setSiteDeployMsg(err.message, true);
  } finally {
    setBtnLoading(button, false);
  }
}
```

```js
// apps/exposure-control/app.js:1989 — current
async function saveSelectedSecret() {
  // ...
  await loadSecrets({ force: true });
  await openSecret(secret.namespace, secret.name);
  setSecretsMsg('Secret change committed and Flux reconcile requested.');
  // ...
}
```

The stylesheet already contains dormant dither tokens and patterns at
`apps/exposure-control/styles.css:54` and
`apps/exposure-control/styles.css:846`, but the reference-led visual layer
correctly disables ambient page texture at
`apps/exposure-control/styles.css:3192`.

## Target

Use dithering only as a transient, local success signal. Do not restore the
ambient dither background, hero halftone, status pulses, or decorative hover
textures.

```css
/* target */
.is-operation-success {
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

.is-operation-success::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image: repeating-conic-gradient(
    var(--dither-ink) 0% 25%,
    transparent 0% 50%
  );
  background-size: 4px 4px;
  animation: operationDitherConfirm 260ms var(--ease-out) both;
}

@keyframes operationDitherConfirm {
  0% {
    opacity: 0;
    transform: translateX(-100%);
  }
  55% {
    opacity: 0.18;
    transform: translateX(0);
  }
  100% {
    opacity: 0;
    transform: translateX(0);
  }
}
```

This animates only transform and opacity. The dither pattern itself is static.
It overlays the existing control for `260ms` and then disappears completely,
leaving the pure `#ffffff`/`#000000` base untouched.

Add one retriggerable helper:

```js
/* target */
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

function showOperationSuccess(target) {
  if (!target) return;
  target.classList.remove('is-operation-success');
  void target.offsetWidth;
  target.classList.add('is-operation-success');
  const duration = reducedMotionMedia.matches ? 180 : 300;
  window.setTimeout(() => target.classList.remove('is-operation-success'), duration);
}
```

If Plan 005 already added `reducedMotionMedia`, reuse it; do not declare it
twice.

Reduced motion uses a stationary signal and opacity only. Its dedicated
keyframe intentionally overrides the global `animation: none !important` rule
with a more specific opacity-only animation:

```css
@keyframes operationDitherConfirmReduced {
  from {
    opacity: 0.12;
    transform: none;
  }
  to {
    opacity: 0;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-operation-success::after {
    animation: operationDitherConfirmReduced 160ms linear both !important;
    transform: none !important;
  }
}
```

The helper removes the class after `180ms` in reduced-motion mode, after the
stationary opacity animation has completed.

Apply feedback only after successful consequential mutations:

- one-site and all-site deploy requests;
- job configuration save and manual run creation;
- secret save, create, and delete;
- Disable All Exposures;
- Transmission route change.

Routine checks, navigation, filtering, and refresh buttons do not receive the
effect.

## Repo conventions to follow

- Reuse `--dither-ink`, whose light and dark values already exist in the root
  theme token blocks.
- Keep the new CSS near the existing loading/success motion section, not in a
  separate stylesheet.
- Use `setBtnLoading` at `apps/exposure-control/app.js:482` as the precedent for
  small reusable control-state helpers.
- For controls replaced during `loadSiteDeployments` or `loadJobs`, query the
  newly rendered control by its existing data attribute and apply success to
  that new element after the awaited load completes.

## Steps

1. Add `showOperationSuccess` near `setBtnLoading`. Reuse the cached
   `reducedMotionMedia` from Plan 005 if present.
2. Add the exact `.is-operation-success` styles and
   `operationDitherConfirm` keyframes above. Do not enable any existing ambient
   dither selectors.
3. After `runSiteDeployment` reloads cards, locate the new
   `[data-site-deploy-run="<siteId>"]` button with `CSS.escape(siteId)` and
   signal that replacement button.
4. After `runAllSiteDeployments` reloads, signal the persistent Deploy All
   button.
5. After job reloads, signal the replacement save or run control using its
   existing `data-job-save` or `data-job-run` identifier.
6. Signal the persistent originating control after successful secret save,
   create, delete, Disable All Exposures, and Transmission route changes.
7. Never call the helper from `catch` or `finally`; errors retain existing red
   message treatment and receive no celebratory motion.
8. Add the exact reduced-motion override above and verify it appears after the
   global reduced-motion reset from Plan 003.

## Boundaries

- Do NOT restore `body::before`, hero halftones, overview hover dither, terminal
  scanlines, empty-state halos, status pulses, or card hover movement.
- Do NOT animate routine Refresh, Check Now, filtering, navigation, or tooltips.
- Do NOT alter success/error text, request timing, confirmation prompts, or
  GitOps behavior.
- Do NOT cover the viewport or obscure data outside the originating control.
- Do NOT change the literal white/black base colors.
- Do NOT add dependencies.
- If mutation handlers differ from commit `4b5fb68`, STOP and report the drift.

## Verification

- **Mechanical**:
  - `node --check apps/exposure-control/app.js` exits `0`.
  - `git diff --check` reports no whitespace errors.
  - `kubectl kustomize apps/exposure-control >/dev/null` exits `0`.
  - `rg -n "body::before|ditherDrift" apps/exposure-control/styles.css` confirms
    the old ambient effect remains disabled by the reference-led override.
- **Feel check**:
  - Complete one successful deploy or mock the successful API response locally.
    The effect stays inside the completed control and lasts `260ms`.
  - At 10% playback, the static 4px dither pattern travels left-to-right and
    fades; it never scales from zero or changes layout.
  - Trigger an error; no dither signal appears.
  - Trigger two successes close together; the class reset reliably retriggers
    the effect.
  - Check light and dark themes. The signal is visible but restrained, and the
    underlying base remains exactly white or black after it ends.
  - Under `prefers-reduced-motion`, the pattern stays still and uses opacity
    only for `100ms`.
- **Done when**: rare successful mutations have one localized dither signal,
  ordinary interactions remain still, and no ambient texture returns.
