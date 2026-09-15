# 015 — Storage tanks

- **Status**: IMPLEMENTED — pending live verification
- **Commit**: 630906f
- **Phase**: 2 shape
- **Category**: Visual; capacity
- **Estimated scope**: 3 files, about 220 lines (pulse.js, app.js, styles.css)

## Problem

48 PVCs, 40 `local-path` and 8 NFS on TrueNAS, with utilization already
computed in `homelab:pvc_utilization:ratio` (including NAS datasets via the
dataset exporter). The Storage Risk dashboard lists them; the panel shows
nothing. Volume fill is naturally a vertical gauge and suits the halftone
material well.

Build this before 014. It proves the halftone fill primitive on a simpler
shape.

## Design

**Layout.** Two groups inside `#storageTanks`, each with a subsection bar:
`local-path` (node-affined, cannot expand) and `truenas-nfs` (expandable).
Tanks sort by utilization descending within a group. Show the top 16 per
group with a `show all` button that reveals the rest; the button text
carries the hidden count.

**Tank.** A 36 px wide, 88 px tall SVG: 1 px outline in `var(--text-1)`,
inside it a rect from the bottom whose height is the utilization, filled with
the dot pattern at `Pulse.inkStep(util)` density. Above 0.85 the outline and
dots switch to `var(--yellow)`; above 0.95 to `var(--red)`. Match these two
thresholds to whatever `grafana-dashboard-storage-risk-overview.yaml` uses;
adjust if the dashboard differs. A hairline at 0.85 across every tank marks
the warning level.

Beneath each tank: claim name trimmed to 14 characters, then
`used / capacity` in `Pulse.fmt.bytes`. Full name in `title` on the SVG.

**Projection.** With `pvc_util_7d` (range, 1 h step) fit a least-squares
line per claim. If the slope is positive and the projected time to 1.0 is
under 30 days, add `full in N d` under the size in `var(--yellow)`. Under
7 days, `var(--red)`. Otherwise nothing. Keep the fit in
`Pulse.projectFull(values, stepSeconds)`.

**Data** (added to `loadPulse`): `pvc_util`, `pvc_used`, `pvc_capacity`
instant; `pvc_util_7d` range. Join on `persistentvolumeclaim` and
`namespace`. Storage class comes from the label if the recording rule carries
it; if the pre-flight check shows it does not, add `pvc_class` (instant,
`kube_persistentvolumeclaim_info`) to the registry and join through it.

**Section detail.** `48 claims · 3 above 85 % · 1 projected full < 30 d`.

## Changes

1. `pulse.js`: `Pulse.tankSvg(model)`, `Pulse.projectFull`, `Pulse.joinPvcs`.
2. `app.js`: `renderStorageTanks()`, show-all toggle, group split.
3. `styles.css`: `.tank-grid` (auto-fill, min 72 px columns), `.tank`,
   `.tank-name`, `.tank-size`, `.tank-eta`, `.tank-more`.

## Verification

```bash
kubectl get pvc -A --no-headers | wc -l
kubectl get pvc -A --no-headers | awk '{print $7}' | sort | uniq -c
```

Tank count must equal the first command; group sizes must match the second.
Pick the fullest claim in Grafana's Storage Risk dashboard and confirm the
same claim leads the panel with the same percentage. Confirm `show all`
reveals the remainder and the count in the button is right.

## Implemented corrections

Live inventory is authoritative, including all TrueNAS storage-class variants.
Current recording rules cover 19 of 48 claims; local usage is unavailable, so
local tanks show requested capacity separately. Warning/danger match Grafana at
80/90 percent. Projections require at least 12 observations spanning 24 hours.
