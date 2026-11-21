---
title: Control Panel Activity
summary: Read-only timeline joining Git commits, Flux rollouts, operator actions, and managed job runs in the operator cockpit.
status: active
owner: homelab
last_reviewed: 2026-11-22
---

# Control Panel Activity

The `activity` page at `https://controlpanel.khzaw.dev/#activity` answers two
questions in one place: what changed, and did it land. It is read-only and uses
the same private access boundary, theme, and ConfigMap asset delivery as the rest
of the operator cockpit.

## Data boundary

`GET /api/activity` returns one feed built by
`apps/exposure-control/activity-feed.js` from records the panel already has
access to. It adds no RBAC and no credential.

| Source | Read | Contributes |
| --- | --- | --- |
| Git | GitHub commits on the GitOps branch for the last seven days, plus each commit's changed files | Commit rows and the area each commit touched |
| Flux | Every HelmRelease and Kustomization | Rollout rows, objects that are not Ready, and whether a commit is applied |
| Panel | The latest 200 entries of the audit stream | Share, deploy, job, route, and secret actions |
| Jobs | Jobs owned by the managed CronJobs, without pods or logs | The latest finished run of each, plus retained failures and active runs |

The snapshot is cached for 30 seconds (`ACTIVITY_CACHE_TTL_SECONDS`) with a
shared in-flight request; `?force=1` bypasses the cache. The commit listing is
one GitHub request per snapshot. A commit's file list never changes, so it is
fetched once and kept in memory until the commit leaves the window. The feed
covers 168 hours and at most 240 events.

Each source fails on its own. `sources` reports `live`, `unavailable`, or
`unconfigured` per source, and the page names any source it could not read
beside the refresh control. A count that depends on an unread source is `null`
and prints as `--`, never as zero.

## Reading rules

- **Area.** A changed file belongs to the Flux Kustomization whose `spec.path`
  is its longest matching prefix; that Kustomization's name is the row's tag. A
  HelmRelease takes the name of the Kustomization that owns it. Files outside
  every Kustomization path fall back to their directory (`docs`, `ci`, `repo`).
- **Applied or pending.** A commit is `applied` once every Kustomization that
  owns one of its files reports a `lastAppliedRevision` at or after it. Commits
  that touch no Kustomization path follow the root Kustomization
  (`ACTIVITY_ROOT_KUSTOMIZATION`, default `flux-system`). A revision outside the
  listed window is unknown and the row carries no state.
- **Rollouts.** Each HelmRelease `status.history` entry is one rollout. Helm
  keeps the current and the previous release, so that is the depth available.
- **Attribution.** A rollout quotes the newest commit for its area that landed
  after the release's previous rollout and no more than two hours before this
  one. The committer date is the landing time, because merges to the GitOps
  branch are rebases. A rollout with no such commit is shown without a quote;
  the page does not guess a cause.
- **Now.** HelmReleases and Kustomizations that are not Ready, and active job
  runs, describe the present. They are pinned above the timeline regardless of
  when the condition began and show how long it has held. Suspended objects are
  omitted. `Progressing` and `DependencyNotReady` are work in progress; any
  other not-Ready reason is a failure.
- **Jobs.** A running job shows a measured bar only when a previous successful
  run gives a duration to compare against; otherwise progress is indeterminate.

The headline is derived, in this order: `NO SIGNAL` when Flux could not be
read, `STALLED` when any object has failed, `SYNCING` when something is
reconciling or a commit is pending, otherwise `IN SYNC`. Managed job results do
not change it. The three counters cover the last 24 hours; `Failed` also counts
every failure that is current.

## Presentation

The headline, counters, and time gutter use a dot-matrix face drawn by
`Feed.matrix` in `apps/exposure-control/feed.js`: five-by-seven glyphs rendered
as SVG squares on a unit grid. Each use sets its height to a whole multiple of
the dot pitch so every square lands on a device pixel; keep that property when
changing a size. State is never the lamp alone: the headline word, tag text,
and an accessible label carry it.

Filters select everything, people, automation, rollouts, or failures, and the
two busiest areas get a chip. Any row's area tag filters to that area, which
puts a commit beside the rollout it caused. Rows page forty at a time.

The page refreshes every 60 seconds only while it is visible and selected, and
on entry. A refresh repaints only regions whose markup changed and announces
only events that were not in the previous snapshot. Reduced motion disables
every animation. The page uses no boxes: rows are open type on hairlines, like
the other list pages.

## Delivery and validation

`activity-feed.js` is server-side and holds every rule above as pure functions;
`feed.js` is the browser renderer. Both are registered in the Kustomize
ConfigMap and `npm run check`; `feed.js` is also in the server asset map,
version rewrite, and deferred HTML scripts.

```bash
npm run check
kubectl kustomize apps/exposure-control | kubectl apply --dry-run=client -f -
flux reconcile kustomization exposure-control -n flux-system --with-source
kubectl rollout status deployment/exposure-control -n default --timeout=180s
curl -fsS 'https://controlpanel.khzaw.dev/api/activity' |
  jq '{state, summary, sources, events: (.events | length)}'
```

Verify the page in light and dark themes at desktop and phone widths, and
confirm `sources` reports `live` for all four. Navigating away must stop the
periodic request.
