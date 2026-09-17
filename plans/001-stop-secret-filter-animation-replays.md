# 001 — Stop secret filter animation replays

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: HIGH
- **Category**: Purpose and frequency; interruptibility
- **Estimated scope**: 2 files, about 20 lines removed or simplified

## Problem

Typing in the Secrets search field re-renders the grouped list on every
keystroke. Each newly inserted `.secret-app-group` then starts the same
`220ms` keyframe animation, while the entire list also receives a temporary
filter transition. This is keyboard-initiated, high-frequency interaction;
motion makes filtering feel less direct and restarts from the beginning when
the next character arrives.

```js
// apps/exposure-control/app.js:2268 — current
secretsSearchInputEl.addEventListener('input', () => {
  secretsListEl.classList.add('is-filtering');
  renderSecretsList(dashboardState.secrets);
});
secretsNamespaceFilterEl.addEventListener('change', () => {
  secretsListEl.classList.add('is-filtering');
  renderSecretsList(dashboardState.secrets);
});
```

```js
// apps/exposure-control/app.js:1914 — current
window.setTimeout(() => secretsListEl.classList.remove('is-filtering'), 180);
```

```css
/* apps/exposure-control/styles.css:2697 — current */
.secrets-list {
  display: grid;
  gap: 4px;
  margin-top: 18px;
  max-height: 680px;
  overflow: auto;
  scrollbar-width: thin;
  transition: filter 180ms ease, opacity 180ms ease;
}

.secrets-list.is-filtering {
  filter: saturate(1.12) brightness(1.06);
}

.secret-app-group {
  display: grid;
  gap: 3px;
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--subtle-line);
  animation: secretRowIn 220ms var(--ease-out) both;
}
```

## Target

Filtering and namespace changes update the list immediately with no opacity,
filter, transform, or group-entry animation. Remove the `is-filtering` state
entirely and remove `animation` from `.secret-app-group`.

Keep the existing `.secret-key-row` entry/removal motion. Adding or removing a
key is an occasional, explicit action and legitimately benefits from state
indication.

```css
/* target */
.secrets-list {
  display: grid;
  gap: 4px;
  margin-top: 18px;
  max-height: 680px;
  overflow: auto;
  scrollbar-width: thin;
}

.secret-app-group {
  display: grid;
  gap: 3px;
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--subtle-line);
}
```

The target deliberately adds no replacement animation.

## Repo conventions to follow

- UI behavior lives in `apps/exposure-control/app.js`; styling lives in
  `apps/exposure-control/styles.css`.
- Keep the existing `secretRowIn 220ms var(--ease-out)` animation on
  `.secret-key-row` at `apps/exposure-control/styles.css:2837`.
- Do not introduce a motion library. The cockpit uses plain JavaScript and CSS.

## Steps

1. In `apps/exposure-control/app.js`, remove both
   `secretsListEl.classList.add('is-filtering')` calls from the search and
   namespace handlers.
2. Remove every `secretsListEl.classList.remove('is-filtering')` call and the
   associated `180ms` timeout from `renderSecretsList`.
3. In `apps/exposure-control/styles.css`, remove the list-level `filter` and
   `opacity` transition and delete `.secrets-list.is-filtering`.
4. Remove `animation: secretRowIn 220ms var(--ease-out) both` from
   `.secret-app-group` only.
5. Confirm `.secret-key-row` still uses its existing entry animation and
   opacity/transform removal transition.

## Boundaries

- Do NOT change search matching, namespace filtering, grouping, or selection.
- Do NOT remove `.secret-key-row` add/remove feedback.
- Do NOT animate replacement list groups with a different keyframe.
- Do NOT add dependencies.
- If the cited handlers or selectors have materially changed since commit
  `4b5fb68`, STOP and report the drift instead of improvising.

## Verification

- **Mechanical**:
  - `node --check apps/exposure-control/app.js` exits `0`.
  - `git diff --check` reports no whitespace errors.
  - `rg -n "is-filtering" apps/exposure-control` returns no matches.
  - `rg -n -U "\\.secret-app-group\\s*\\{[^}]*animation" apps/exposure-control/styles.css`
    returns no matches.
- **Feel check**: open Secrets and type rapidly into the filter.
  - Matching groups update immediately without flashing, sliding, or replaying.
  - In DevTools, set animation playback to 10%; typing still starts no animation
    on `.secret-app-group`.
  - Add a key and remove it; that row still enters and exits clearly.
  - Toggle `prefers-reduced-motion`; filtering remains immediate.
- **Done when**: filtering creates zero animations in
  `document.getAnimations()` for `.secrets-list` and `.secret-app-group`, while
  explicit key-row add/remove feedback remains intact.
