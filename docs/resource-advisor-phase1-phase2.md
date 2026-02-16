# Resource Advisor (Phase 1 + Phase 2)

## Overview
This component provides policy-driven resource tuning recommendations for the homelab cluster.

- Phase 1: report-only analysis (daily CronJob).
- Phase 2: automated PR generation with recommendations (weekly CronJob).

It is intentionally lightweight and runs as short-lived CronJobs in the `monitoring` namespace.

## GitOps Paths
- `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/`
- `/Users/khz/Code/rangoonpulse/flux/kustomizations/resource-advisor.yaml`
- `/Users/khz/Code/rangoonpulse/flux/kustomization.yaml`

## What It Analyzes
- Deployments and StatefulSets in namespaces configured by `TARGET_NAMESPACES`.
- Per-container p95 CPU and memory from Prometheus over 7 days.
- Restart trends from `kube_pod_container_status_restarts_total`.
- Current requests/limits from workload specs.

## Guardrails
- Max per-run adjustment step is capped (`MAX_STEP_PERCENT`, default 25%).
- Request/limit buffer percentages are configurable.
- Memory downscaling is blocked when restart activity is detected.
- High-variance workloads are excluded from automatic downscaling (`DOWNSCALE_EXCLUDE`).

## Outputs
The latest report is written to ConfigMap:
- Namespace: `monitoring`
- Name: `resource-advisor-latest`
- Keys:
  - `latest.json`
  - `latest.md`
  - `lastRunAt`
  - `mode`

## Schedules
- `resource-advisor-report`: daily at `02:30`.
- `resource-advisor-pr`: weekly at `03:00` on Monday.

## Phase 2 PR Mode Requirements
PR mode requires a GitHub token in Kubernetes secret:

```bash
kubectl create secret generic resource-advisor-github \
  -n monitoring \
  --from-literal=token='<YOUR_GITHUB_TOKEN>'
```

Token should have permissions required to push branches and create PRs for `khzaw/rangoonpulse`.

## Manual Trigger
```bash
kubectl create job -n monitoring --from=cronjob/resource-advisor-report resource-advisor-report-manual-$(date +%s)
kubectl create job -n monitoring --from=cronjob/resource-advisor-pr resource-advisor-pr-manual-$(date +%s)
```

## Notes
- This version generates recommendation artifacts and PRs containing generated reports.
- It does not auto-edit HelmRelease resource blocks yet.
- Keeping PR automation report-only avoids unsafe direct runtime changes.
