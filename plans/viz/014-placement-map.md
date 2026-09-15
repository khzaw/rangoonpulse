# 014 — Placement map

- **Status**: IMPLEMENTED — pending live verification
- **Commit**: 630906f
- **Phase**: 2 shape
- **Category**: Visual; topology
- **Estimated scope**: 3 files, about 340 lines (pulse.js, app.js, styles.css)

## Problem

98 pods across two nodes and eleven namespaces have no visual shape on the
panel. The `Efficiency and Placement` Grafana dashboard covers this with
tables. A treemap shows the whole placement in one glance: which node carries
what, which namespaces dominate memory, and which pods are running hot against
their request.

## Design

**Hierarchy.** node → namespace → pod. Cell area is memory request, floored at
32 Mi so pods without requests still appear. Cells are laid out with a
squarified treemap (`Pulse.treemap(items, width, height)`, about 80 lines,
no library). The two node rectangles split the width by their total request,
then namespaces inside each, then pods.

**Fill.** Halftone density from `Pulse.inkStep(usage / request)`:

| ratio | step | look |
| --- | --- | --- |
| no usage data | 0 | hollow, 1 px border only |
| < 0.25 | 1 | sparse dots |
| 0.25–0.5 | 2 | |
| 0.5–0.75 | 3 | |
| 0.75–1.0 | 4 | |
| > 1.0 | 5 | dense dots plus a 1 px `var(--red)` inner hairline |

Dots are an SVG `pattern` per step (five patterns, defined once). Cell
borders are `var(--border)`; namespace outlines `var(--border-strong)`; node
outlines 1.5 px `var(--text-1)`.

**Labels.** Pod name (trimmed with `…`) only when the cell is at least 64 px
wide and 16 px tall. Namespace label always, in the group's top-left, Plex
Mono 11 px. Node name as the block heading.

**Restarts.** A pod with `pod_restarts_24h > 0` gets a 4 px solid square in
its top-right corner. If a silent refresh sees the restart count increase for
a pod since the previous poll, that cell gets the one-shot dither flash from
plan 006 (or, if 006 has not landed, a 600 ms `opacity` blink in normal
motion, none under reduced motion). The previous poll's counts are kept in
`dashboardState.metrics.prevRestarts`.

**Phase.** Pods not in `Running` per `kube_pod_status_phase` render with the
1-bit checkerboard. Add `pod_phase` (instant,
`kube_pod_status_phase{phase!="Succeeded"} == 1`) to the registry in this
plan.

**Interaction.** Hovering a cell sets a fixed detail line under the map:
`default/jellyfin · req 1.0 Gi · use 812 Mi · 0.79 · 0 restarts`. No tooltips
or popovers. Click on a namespace label toggles collapsing that namespace to
a single cell; the state is per session only.

**Data** (instant, added to `loadPulse`): `pod_info`, `pod_mem_request`,
`pod_mem_usage`, `pod_restarts_24h`, `pod_phase`. Join key is
`namespace|pod`. Skip pods whose `pod_info.node` is empty.

**Sizing.** The map is an SVG with `viewBox` set to the container's pixel
width × half that height, re-laid on `resize` with a 200 ms debounce. With
about 100 cells and no per-frame work this is well within budget.

## Changes

1. `pulse.js`: `Pulse.treemap`, `Pulse.placementSvg(model, width, height)`,
   the five dot patterns, and `Pulse.joinPods(metrics)` to build the model.
2. `app.js`: `renderPlacementMap()`, hover and click delegation on
   `#placementMap`, resize debounce, `prevRestarts` tracking.
3. `styles.css`: `.placement-map`, `.placement-detail`, `.is-collapsed`,
   the blink keyframes and reduced-motion override.

## Verification

```bash
kubectl get pods -A -o wide --no-headers | awk '{print $8}' | sort | uniq -c
kubectl get pods -A --no-headers | grep -vE 'Running|Completed'
```

The count of cells per node block must match the first command. Any pod from
the second command must show the checkerboard. Restart a harmless pod
(`kubectl rollout restart deployment/speedtest -n default`) and confirm the
corner marker appears within two silent refreshes. Check layout at 400 px:
the two node blocks stack vertically and labels drop out cleanly.

## Implemented corrections

Namespace header height and padding adapt to tiny rectangles, retaining all pods
without changing memory weights. Memory usage selects the cAdvisor scrape only.
The page supports keyboard and touch details and namespace folding. Restart
feedback is tested with fixtures, without restarting unrelated cluster workloads.
