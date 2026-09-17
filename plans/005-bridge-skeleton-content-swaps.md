# 005 — Bridge skeleton-to-content swaps

- **Status**: TODO
- **Commit**: 4b5fb68
- **Severity**: LOW
- **Category**: Missed opportunity; preventing a jarring change
- **Estimated scope**: 1 file, about 45 lines changed

## Problem

The cockpit inserts skeletons before asynchronous loads, then replaces them
with complete HTML in one frame. The loading state is clear, but the finished
content teleports into place. Row-by-row animation would be distracting in this
data-heavy UI; one short container reveal is sufficient.

```js
// apps/exposure-control/app.js:264 — current
if (nextPage === 'secrets' && hasLoadedDashboard && !dashboardState.secrets) {
  secretsListEl.innerHTML = skeletonTableRows(1, 5);
  loadSecrets();
}
if (nextPage === 'jobs' && hasLoadedDashboard && !dashboardState.jobs) {
  jobsOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
  jobsListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
  loadJobs();
}
if (nextPage === 'deploy' && hasLoadedDashboard && !dashboardState.siteDeployments) {
  siteDeployOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
  siteDeployListEl.innerHTML = '<div class="table-shell"><table><tbody>' + skeletonTableRows(4, 3) + '</tbody></table></div>';
  loadSiteDeployments();
}
```

```js
// apps/exposure-control/app.js:2086 — current
overviewStripEl.innerHTML = skeletonOverviewStrip(7);
travelOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
tuningOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
jobsOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
siteDeployOverviewStripEl.innerHTML = skeletonOverviewStrip(4);
rowsEl.innerHTML = skeletonTableRows(6, 4);
auditRowsEl.innerHTML = skeletonTableRows(4, 3);
updatesRowsEl.innerHTML = skeletonTableRows(5, 4);
helmUpdatesRowsEl.innerHTML = skeletonTableRows(6, 4);
tuningRowsEl.innerHTML = skeletonTableRows(8, 5);
```

## Target

Add one reusable Web Animations API helper. It animates only a container that
was known to contain a `.skeleton-line` immediately before its content was
replaced.

```js
/* target */
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

function revealAfterSkeleton(target, hadSkeleton) {
  if (!target || !hadSkeleton) return;
  target.getAnimations().forEach((animation) => animation.cancel());
  const reduced = reducedMotionMedia.matches;
  target.animate(
    reduced
      ? [
          { opacity: 0.85 },
          { opacity: 1 },
        ]
      : [
          { opacity: 0.72, transform: 'translateY(3px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
    {
      duration: reduced ? 100 : 160,
      easing: reduced ? 'linear' : 'cubic-bezier(0.23, 1, 0.32, 1)',
    },
  );
}
```

For each eligible surface, capture
`const hadSkeleton = Boolean(target.querySelector('.skeleton-line'))` before
rendering and call `revealAfterSkeleton(target, hadSkeleton)` after rendering.

Eligible surfaces:

- shared overview strip;
- jobs overview and list;
- deploy overview and list;
- Secrets list;
- image-update and Helm-update scroll containers;
- exposure, audit, and tuning table containers on initial dashboard load.

Do not animate a container on background refresh if it did not contain a
skeleton immediately beforehand.

## Repo conventions to follow

- Keep the helper near `skeletonLine`, `skeletonOverviewStrip`, and
  `skeletonTableRows` at `apps/exposure-control/app.js:488`.
- Reuse the existing `themeMedia` pattern at `apps/exposure-control/app.js:125`
  as the local precedent for a cached `matchMedia` object.
- Use WAAPI for this predetermined one-shot reveal; do not introduce a render
  loop or a third-party motion library.

## Steps

1. Define one cached reduced-motion media query beside the existing media-query
   state. Reuse an existing reduced-motion query if one has appeared.
2. Add `revealAfterSkeleton` beside the skeleton helpers using the exact
   keyframes, durations, and easing above.
3. In each load/render path, capture whether the intended target contains a
   skeleton before replacing its content.
4. Call the helper after successful content insertion only when the captured
   flag is true.
5. For table bodies, animate their stable `.table-shell`, `.updates-scroll`, or
   `.audit-scroll` ancestor rather than individual rows.
6. Do not call the helper on errors that replace the skeleton with an error
   message; error visibility should be immediate.
7. Cancel an existing animation on the target before starting the next one so
   a rapid navigation/load cannot leave stale effects behind.

## Boundaries

- Do NOT add row staggers or animate every table row.
- Do NOT animate ordinary refreshes that never showed a skeleton.
- Do NOT delay content insertion or pointer interaction.
- Do NOT use blur, height, width, margins, or layout animation.
- Do NOT change loading, fetching, or error behavior.
- Do NOT add dependencies.
- If skeleton insertion has changed since commit `4b5fb68`, STOP and report the
  drift.

## Verification

- **Mechanical**:
  - `node --check apps/exposure-control/app.js` exits `0`.
  - `git diff --check` reports no whitespace errors.
  - `kubectl kustomize apps/exposure-control >/dev/null` exits `0`.
- **Feel check**:
  - Open Jobs, Deploy Sites, and Secrets for the first time. The skeleton is
    replaced by one short container settle, not a row cascade.
  - Navigate away and back after data is cached; there is no repeated reveal.
  - At 10% playback, the maximum movement is exactly `3px` and content remains
    interactive throughout.
  - Simulate an API error; the error text appears immediately.
  - Under `prefers-reduced-motion`, the swap uses only a `100ms` opacity fade.
- **Done when**: skeleton replacements have a single `160ms` bridge, normal
  cached renders remain still, and no table row receives an entrance animation.
