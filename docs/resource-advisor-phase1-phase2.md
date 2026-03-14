# Resource Advisor (Phase 1 + Phase 2 + Phase 3)

## Overview
This component provides policy-driven resource tuning recommendations for the homelab cluster.

- Phase 1: report-only analysis (daily CronJob) published to Kubernetes ConfigMap.
- Phase 2: capacity-aware apply planning (live pod footprint, hard node-fit simulation, and advisory cluster posture).
- Phase 3: safe apply PR generation with maturity gates and hard node-capacity blocking (weekly CronJob).

Report PR generation is intentionally disabled to keep the repository clean.

It is intentionally lightweight and runs as short-lived CronJobs in the `monitoring` namespace.

## Automation Contract (Current Behavior)
This is fully automated with Kubernetes CronJobs. No manual trigger is required for normal operation.

- `resource-advisor-report` (`batch/v1 CronJob`, namespace `monitoring`)
  - runs daily (`02:30`, timezone `Asia/Singapore`)
  - computes resource analysis
  - writes report data to ConfigMap `monitoring/resource-advisor-latest`
  - does not create branches or PRs
- `resource-advisor-apply-pr` (`batch/v1 CronJob`, namespace `monitoring`)
  - runs weekly (`03:30` Monday, timezone `Asia/Singapore`)
  - computes safe, per-service apply plan
  - creates a unique `tune/...` branch from the latest `master`
  - opens one apply PR per run when eligible changes exist
  - applies only allowlisted HelmRelease resource changes
- finished jobs are auto-cleaned by TTL:
  - `ttlSecondsAfterFinished: 21600` (6 hours)
- reporting PR flow is disabled by design

Apply PR cleanliness:
- only HelmRelease resource diffs are committed
- no generated `docs/resource-advisor/*.json` or `*.md` artifacts are committed
- all rationale is embedded in the PR description
- PR description includes deadband, advisory cluster posture, node-fit snapshot, selected changes, and skipped reason summary

## GitOps Paths
- `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/`
- `/Users/khz/Code/rangoonpulse/flux/kustomizations/resource-advisor.yaml`
- `/Users/khz/Code/rangoonpulse/flux/kustomization.yaml`

## Operator UI Surface
- Canonical operator cockpit: `https://controlpanel.khzaw.dev` (`Tuning` section)
- Backend-native resource-advisor surface: `https://tuning.khzaw.dev`
- Served by: `monitoring/resource-advisor-exporter`
- Purpose:
  - provide tuning data and a backend-native UI for the latest runtime-owned report,
  - power the combined operator cockpit without merging backends,
  - expose live apply preflight snapshot data from the same report plus current cluster state,
  - expose raw/report endpoints:
    - `/latest.json`
    - `/latest.md`
    - `/metrics`
    - `/api/ui.json`
- Source files:
  - `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/exporter.py`
  - `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/ingress-exporter.yaml`
- Operational note:
  - `exporter.py` is mounted from a ConfigMap; after a Git change to the exporter code, reconcile alone updates the file but does not restart the running Python process.
  - Run `kubectl rollout restart deployment/resource-advisor-exporter -n monitoring` after the reconcile when you need the new code live immediately.

## What It Analyzes
- Deployments and StatefulSets in namespaces configured by `TARGET_NAMESPACES`.
- Per-container p95 CPU and memory from Prometheus over a 14-day window (`METRICS_WINDOW=14d`).
- Restart trends from `kube_pod_container_status_restarts_total`.
- Current requests/limits from workload specs.

## Node Constraint Awareness
The report and apply planner are aware of cluster posture, but the hard safety gate is node capacity:
- Uses allocatable node CPU/memory from Kubernetes API.
- Phase 2 uses live pod request footprint (Kubernetes API) for planner context (includes replicas and all namespaces).
- Phase 2 runs a node-fit simulation based on current pod placement and blocks only changes that would exceed allocatable node capacity.
- Advisory request ceilings are still computed and shown in the report/UI:
  - `MAX_REQUESTS_PERCENT_CPU` (default 60%)
  - `MAX_REQUESTS_PERCENT_MEMORY` (default 65%)
- Advisory pressure does not hard-freeze safe right-sizing changes; it only influences selection order and operator visibility.

## Data Maturity Gates
Prometheus can be recently deployed and data may be immature.

Phase 3 applies gates:
- `MIN_DATA_DAYS_FOR_UPSIZE` (default 14)
- `MIN_DATA_DAYS_FOR_DOWNSIZE` (default 14)

Before maturity, only restart-guarded upsizes can pass.
Downsizes are blocked until the 14-day window is sufficiently populated.

## Prometheus Durability Dependency
Resource Advisor quality depends on Prometheus keeping enough history to satisfy `METRICS_WINDOW=14d`.

Current monitoring guardrails:
- Prometheus TSDB is persisted on node-local PVC (`local-path`, `12Gi`) on `talos-7nf-osf`
  via `infrastructure/monitoring/helmrelease.yaml`.
- `retention: 14d` keeps the advisor window aligned.
- `retentionSize: 8GB` bounds disk usage and auto-prunes old blocks before the PVC fills.
- `walCompression: true` reduces WAL footprint and helps maintain retention coverage under bounded storage.

Operational expectation:
- One-time cutover behavior: migrating from `emptyDir` to PVC resets Prometheus history once at rollout time (ephemeral blocks cannot be preserved in-place).
- Prometheus pod restarts should not reset advisor data maturity.
- If metric volume increases enough to hit `retentionSize`, older samples are dropped automatically; advisor keeps running but may report `<14` coverage until utilization stabilizes or limits are adjusted.

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
- Current live apply selection order is:
  - upsizes that do not worsen an active advisory pressure dimension
  - safe mature downsizes
  - remaining safe upsizes under advisory pressure

## Current Apply Scope Policy
Auto-apply (Phase 3 PR commits) is currently enabled for:
- `adguard`, `adguard-secondary`, `anki-server`, `audiobookshelf`, `autobrr`, `bazarr`, `booklore`, `booklore-mariadb`
- `calibre`, `calibre-web-automated`, `chartsdb`, `ersatztv`, `exposure-control`, `flaresolverr`, `glance`, `shelfmark`
- `isponsorblock-tv`, `profilarr`, `tracerr`, `jellyfin`, `jellyseerr`, `nodecast-tv`
- `obsidian-livesync`, `prowlarr`, `radarr`, `sabnzbd`, `sonarr`, `speedtest`, `transmission`, `tunarr`
- `uptime-kuma`, `vaultwarden`

Analyzed but intentionally excluded from auto-apply (manual-only adjustments):
- `actualbudget` (non-`app-template` chart), `immich`, `immich-postgres`, `media-postgres`, `vaultwarden-postgres`,
  `blog`, `mmcal`

## Outputs
The latest report is written to ConfigMap:
- Namespace: `monitoring`
- Name: `resource-advisor-latest`
- Keys:
  - `latest.json`
  - `latest.md`
  - `lastRunAt`
  - `mode`

Important:
- `resource-advisor-latest` is runtime state owned by the CronJobs. It should not be reconciled by Flux, or it will
  be reset back to the Git version on every reconciliation interval.
- The CronJobs create the ConfigMap automatically if it does not exist.

Repository artifacts:
- Phase 3 apply PR branch updates only:
  - selected HelmRelease resource blocks for allowlisted apps
  - no generated report/apply JSON or Markdown artifacts are committed

Live exporter-only surfaces:
- `https://tuning.khzaw.dev` computes an in-memory apply preflight snapshot on refresh.
- `https://tuning.khzaw.dev/api/ui.json` exposes the structured tuning payload consumed by `controlpanel.khzaw.dev`.
- Prometheus metrics include:
  - `resource_advisor_apply_plan_selected_total`
  - `resource_advisor_apply_advisory_cpu_pressure`
  - `resource_advisor_apply_advisory_memory_pressure`

## Schedules
- `resource-advisor-report`: daily at `02:30` (`Asia/Singapore`).
- `resource-advisor-apply-pr`: weekly at `03:30` on Monday (`Asia/Singapore`).

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

# Confirm Prometheus persistence + retention guardrails
kubectl get pvc -n monitoring | rg kube-prometheus-stack-prometheus
kubectl get prometheus -n monitoring kube-prometheus-stack-prometheus -o yaml | rg 'retention|retentionSize|walCompression'

# Inspect latest report in-cluster
kubectl get configmap resource-advisor-latest -n monitoring -o yaml

# Open the UI / raw surfaces
curl -I --max-time 20 https://tuning.khzaw.dev
curl -s https://tuning.khzaw.dev/api/ui.json | jq '.fetch,.applyPreflight.selectedCount'
curl -s https://tuning.khzaw.dev/latest.json | jq '.summary,.budget'
curl -s https://tuning.khzaw.dev/metrics | rg '^resource_advisor_'

# Inspect recent jobs
kubectl get jobs -n monitoring | rg resource-advisor
```

## Workflow After Phase 3
1. Phase 1 keeps publishing visibility reports to `monitoring/resource-advisor-latest`.
2. The exporter shows a live apply preflight view using the current report and cluster footprint.
3. Phase 3 proposes safe, node-fit-checked HelmRelease updates in a dedicated apply PR.
4. Apply PR description contains decision rationale, constraints, and skip reasons.
5. Operator reviews and merges the apply PR.
6. Flux reconciles and applies.
7. Next cycles adjust incrementally from new baseline.

This keeps tuning iterative, auditable, and bounded by node constraints.
