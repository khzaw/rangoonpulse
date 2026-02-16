# Resource Advisor (Phase 1 + Phase 3)

## Overview
This component provides policy-driven resource tuning recommendations for the homelab cluster.

- Phase 1: report-only analysis (daily CronJob) published to Kubernetes ConfigMap.
- Phase 3: safe apply PR generation with budget and data-maturity gates (weekly CronJob).

Phase 2 (report PR generation) is intentionally disabled to keep the repository clean.

It is intentionally lightweight and runs as short-lived CronJobs in the `monitoring` namespace.

## Automation Contract (Current Behavior)
This is fully automated with Kubernetes CronJobs. No manual trigger is required for normal operation.

- `resource-advisor-report` (`batch/v1 CronJob`, namespace `monitoring`)
  - runs daily (`02:30`)
  - computes resource analysis
  - writes report data to ConfigMap `monitoring/resource-advisor-latest`
  - does not create branches or PRs
- `resource-advisor-apply-pr` (`batch/v1 CronJob`, namespace `monitoring`)
  - runs weekly (`03:30` Monday)
  - computes safe, budget-aware apply plan
  - creates a unique `tune/...` branch from the latest `master`
  - opens one apply PR per run when eligible changes exist
  - applies only allowlisted HelmRelease resource changes
- reporting PR flow is disabled by design

Apply PR cleanliness:
- only HelmRelease resource diffs are committed
- no generated `docs/resource-advisor/*.json` or `*.md` artifacts are committed
- all rationale is embedded in the PR description
- PR description includes deadband, budget, maturity, selected changes, and skipped reason summary

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
- Deadband policy ignores small deltas:
  - `DEADBAND_PERCENT` (default 10%)
  - `DEADBAND_CPU_M` (default 25m)
  - `DEADBAND_MEM_MI` (default 64Mi)
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
- Phase 3 apply PR branch updates only:
  - selected HelmRelease resource blocks for allowlisted apps
  - no generated report/apply JSON or Markdown artifacts are committed

## Schedules
- `resource-advisor-report`: daily at `02:30`.
- `resource-advisor-apply-pr`: weekly at `03:30` on Monday.

## Phase 3 Requirements
Apply PR generation requires a GitHub token secret:

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
kubectl create job -n monitoring --from=cronjob/resource-advisor-apply-pr resource-advisor-apply-pr-manual-$(date +%s)
```

## Verification Commands
```bash
# Confirm CronJobs exist
kubectl get cronjobs -n monitoring | rg resource-advisor

# Inspect latest report in-cluster
kubectl get configmap resource-advisor-latest -n monitoring -o yaml

# Inspect recent jobs
kubectl get jobs -n monitoring | rg resource-advisor
```

## Workflow After Phase 3
1. Phase 1 keeps publishing visibility reports to `monitoring/resource-advisor-latest`.
2. Phase 3 proposes safe, budget-constrained HelmRelease updates in a dedicated apply PR.
3. Apply PR description contains decision rationale, constraints, and skip reasons.
4. Operator reviews and merges the apply PR.
5. Flux reconciles and applies.
6. Next cycles adjust incrementally from new baseline.

This keeps tuning iterative, auditable, and bounded by node constraints.
