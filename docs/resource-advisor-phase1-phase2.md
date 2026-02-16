# Resource Advisor (Phase 1 + Phase 2 + Phase 3)

## Overview
This component provides policy-driven resource tuning recommendations for the homelab cluster.

- Phase 1: report-only analysis (daily CronJob).
- Phase 2: automated PR generation with report artifacts (weekly CronJob).
- Phase 3: safe apply PR generation with budget and data-maturity gates (weekly CronJob).

It is intentionally lightweight and runs as short-lived CronJobs in the `monitoring` namespace.

## GitOps Paths
- `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/`
- `/Users/khz/Code/rangoonpulse/flux/kustomizations/resource-advisor.yaml`
- `/Users/khz/Code/rangoonpulse/flux/kustomization.yaml`

## What It Analyzes
- Deployments and StatefulSets in namespaces configured by `TARGET_NAMESPACES`.
- Per-container p95 CPU and memory from Prometheus over a 14-day window (`METRICS_WINDOW=14d`).
- Restart trends from `kube_pod_container_status_restarts_total`.
- Current requests/limits from workload specs.

## Node Constraint Awareness
The report and apply planner are constrained by node capacity:
- Uses allocatable node CPU/memory from Kubernetes API.
- Tracks current request footprint and projected request footprint.
- Enforces apply budget ceilings:
  - `MAX_REQUESTS_PERCENT_CPU` (default 60%)
  - `MAX_REQUESTS_PERCENT_MEMORY` (default 65%)

This prevents unconstrained upsize drift.

## Data Maturity Gates
Prometheus can be recently deployed and data may be immature.

Phase 3 applies gates:
- `MIN_DATA_DAYS_FOR_UPSIZE` (default 14)
- `MIN_DATA_DAYS_FOR_DOWNSIZE` (default 14)

Before maturity, only restart-guarded upsizes can pass.
Downsizes are blocked until the 14-day window is sufficiently populated.

## Guardrails
- Max per-run adjustment step is capped (`MAX_STEP_PERCENT`, default 25%).
- Request/limit buffer percentages are configurable.
- Memory downscaling is blocked when restart activity is detected.
- High-variance workloads can be excluded from automatic downscaling.
- Apply mode is allowlisted to app-template-backed releases only.

## Outputs
The latest report is written to ConfigMap:
- Namespace: `monitoring`
- Name: `resource-advisor-latest`
- Keys:
  - `latest.json`
  - `latest.md`
  - `lastRunAt`
  - `mode`

Repository artifacts:
- Phase 2 branch/PR updates:
  - `docs/resource-advisor/latest.json`
  - `docs/resource-advisor/latest.md`
- Phase 3 branch/PR updates:
  - `docs/resource-advisor/latest.json`
  - `docs/resource-advisor/latest.md`
  - `docs/resource-advisor/apply-plan.json`
  - `docs/resource-advisor/apply-plan.md`
  - selected HelmRelease resource blocks for allowlisted apps

## Schedules
- `resource-advisor-report`: daily at `02:30`.
- `resource-advisor-pr`: weekly at `03:00` on Monday.
- `resource-advisor-apply-pr`: weekly at `03:30` on Monday.

## Phase 2 and Phase 3 Requirements
Both PR phases require a GitHub token secret:

```bash
kubectl create secret generic resource-advisor-github \
  -n monitoring \
  --from-literal=token='<YOUR_GITHUB_TOKEN>'
```

Token must be authorized for `khzaw/rangoonpulse` with:
- Contents: Read and write
- Pull requests: Read and write

## Manual Trigger
```bash
kubectl create job -n monitoring --from=cronjob/resource-advisor-report resource-advisor-report-manual-$(date +%s)
kubectl create job -n monitoring --from=cronjob/resource-advisor-pr resource-advisor-pr-manual-$(date +%s)
kubectl create job -n monitoring --from=cronjob/resource-advisor-apply-pr resource-advisor-apply-pr-manual-$(date +%s)
```

## Workflow After Phase 3
1. Phase 2 keeps publishing visibility reports.
2. Phase 3 proposes safe, budget-constrained HelmRelease updates in a dedicated apply PR.
3. Operator reviews and merges the apply PR.
4. Flux reconciles and applies.
5. Next cycles adjust incrementally from new baseline.

This keeps tuning iterative, auditable, and bounded by node constraints.
