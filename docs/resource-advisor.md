---
title: Resource Advisor
summary: Current reporting, recommendation, apply-PR, exporter, and control-panel contract.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Resource Advisor

## Runtime Contract

Source of truth: `infrastructure/resource-advisor/`.

- `resource-advisor-report`: daily at 02:30 Asia/Singapore
- `resource-advisor-apply-pr`: Monday at 03:30 Asia/Singapore
- `resource-advisor-capacity-snapshot`: every 15 minutes; publishes the runtime `capacity-state` branch for Git/CI validation
- metrics window: 14 days
- runtime report state: `ConfigMap/monitoring/resource-advisor-latest`
- operator UI: `https://controlpanel.khzaw.dev/#tuning`

The runtime ConfigMap is intentionally not reconciled by Flux. Git owns code, schedules, policy, RBAC, and deployment; the CronJob owns the latest report payload.

Reports create no Git branches or PRs. Apply jobs persist their execution artifacts in the runtime ConfigMap and create or update one stable `tune/...` branch and PR per selected service/action from current `master`. Only HelmRelease resource blocks are committed; rationale belongs in the PR description, not generated docs. Review, merge, and Flux rollout are separate from generating a PR. Finished report/apply Jobs expire after six hours.

## Recommendation Model

The advisor combines Prometheus history with current workload state, requests, limits, restart activity, node capacity, and safety policy. Recommendations are advisory until the apply-PR job selects an allowlisted HelmRelease resource change.

The apply path is deliberately narrow:

- only mapped HelmRelease resource fields are eligible
- live preflight checks can reject stale or unsafe recommendations
- the job commits a Git change and opens a bounded PR rather than patching workloads directly
- service eligibility is authoritative in `APP_TEMPLATE_RELEASE_FILE_MAP` inside `infrastructure/resource-advisor/advisor.py`

Do not duplicate the allowlist in docs. Inspect the mapping and validate its paths. The two AdGuard entries map to independent HelmReleases under `apps/adguard/primary/` and `apps/adguard/secondary/`.

## Data And Policy Gates

The advisor analyzes Deployments/StatefulSets in `TARGET_NAMESPACES`, using per-container p95 CPU/memory, throttling, restarts, and declared resources. Every discovered container remains in the report, including deadband and awaiting-metrics rows. The p95 window samples hourly; live measurements do not guarantee an immediate historical sample for a newly deployed container.

Inspect `advisor.py` and the job environment for exact policy. Current defaults include:

- A 14-day maturity window for upsizes and downsizes; before maturity, only restart-guarded upsizes can pass.
- A maximum 25% adjustment step; deadband of 10%, 25m CPU, and 64Mi memory.
- Apply minimum total savings of 50m CPU or 256Mi memory across replicas; minimum growth of 25m CPU or 128Mi memory, including limit growth.
- No automatic limit downsizing; mixed proposals preserve current shrinking request dimensions while keeping eligible growth.
- Restart activity prevents memory downscaling; CPU throttling guards prevent artificially low observed usage from looking safe to downsize.
- Service profiles preserve interactive request floors for bursty workloads. Critical/manual services can exclude downsizing; RomM is upsize-only until representative scans establish a floor.

BentoPDF uses an absolute HPA CPU target of `35m`, so request tuning does not alter its scaling threshold. Percentage targets and automatic request tuning must be designed together for other autoscaled services.

Prometheus must preserve the analysis window: its node-local TSDB, retention duration/size, and WAL compression are declared in `infrastructure/monitoring/helmrelease.yaml`. Retention size can prune history early; missing history must remain visible as immature data.

## Node Capacity And Headroom

Allocatable CPU/memory and per-node placement are hard limits. The apply planner includes replicas, live whole-cluster pod reservations, and pinned pending pods. Advisory request ceilings influence selection order and visibility; they do not themselves freeze safe changes.

CPU increases must leave each node `max(1000m, largest replacement pod CPU + 150m job allowance)`. Effective pod requests include sidecars, init requests, and overhead. The exporter and apply job share `MIN_FREE_CPU_M_PER_NODE=1000` and `JOB_CPU_RESERVE_M_PER_NODE=150`.

Separate PRs share a conservative growth budget: unmerged downsizes never fund increases. Unknown pending placement blocks CPU increases; a changed live CPU request defers a stale report candidate. CPU-neutral changes and eligible downsizes can still pass subject to the other gates. The reserve covers one replacement plus a job; concurrent rollouts can need more.

Inspect `applyPreflight.cpuHeadroom` or `node_fit.cpu_headroom` for per-node required reserve, free CPU, and shortfall. Common skip reasons include `cpu_headroom_block`, `cpu_headroom_unknown_placement`, and `live_cpu_request_changed`. Refresh the report after manual sizing or rollouts.

[CPU headroom validation](./cpu-headroom-validation.md) extends the policy to Git/CI changes. It is a preflight, not live Kubernetes admission enforcement. Never merge the runtime `capacity-state` branch into `master`.

## Secrets

GitHub credentials are SOPS-managed in `infrastructure/secrets/` and consumed as Kubernetes Secrets. Do not create replacement plaintext or imperative secrets for routine operation.

## Exporter And UI

The exporter exposes report-derived metrics to Prometheus. The control panel reads the current report, preflight, schedule, and apply status through the resource-advisor backend.

The script ConfigMap has a content hash. Kustomize rewrites Deployment and CronJob references, so source/policy changes roll the exporter automatically. Verify the rollout and API; a manual restart is only recovery when the normal update cannot complete.

The Tuning page is a read-only preview. A valid `applyPreflight.selected` list controls the proposed-change ledger; missing or inconsistent evidence makes the preview unavailable rather than falsely empty. Impact reflects selected changes to whole-cluster reservations including replicas, not usage savings or every raw recommendation.

Deferred, No change, and All workloads views retain every report container. Counts are container rows, not service/PR counts. Selected rows use adjusted current/proposed requests and limits from the preflight, including limit-only changes. Other rows are report advice. Namespace, workload, container, and release join identities together; ambiguous skip reasons must not be assigned to the wrong row. Missing measurements remain missing; zero remains zero.

Report time, metrics coverage, preflight time, next scheduled PR run, and last persisted execution are separate evidence. A PR link does not establish merge or deployment. Filters and disclosures survive refresh; unavailable responses clear old readings. Implementation and regressions live in `apps/exposure-control/tuning.js` and `apps/exposure-control/tuning.test.js`.

Raw cockpit surfaces include `/api/tuning/latest.json`, `/api/tuning/latest.md`, and `/api/tuning/metrics`. The exporter also serves persisted `/apply-plan.json` and `/apply-plan.md`. Runtime ConfigMap keys include `latest.json`, `latest.md`, `lastRunAt`, `mode`, `apply-plan.json`, `apply-plan.md`, and `applyLastRunAt`.

## Service Integration

When a service should enter or leave apply scope, inspect and update:

- `infrastructure/resource-advisor/advisor.py`
- `infrastructure/resource-advisor/cronjob-apply-pr.yaml` when job behavior changes
- the service HelmRelease resource shape
- current operating docs only when the contract changes

## Verification

```bash
flux get kustomization resource-advisor -n flux-system
kubectl get cronjobs,jobs -n monitoring | grep resource-advisor
kubectl get configmap resource-advisor-latest -n monitoring -o yaml
kubectl auth can-i get cronjobs.batch -n monitoring --as=system:serviceaccount:monitoring:resource-advisor
curl -s https://controlpanel.khzaw.dev/api/tuning | jq '.fetch,.applyPreflight.selectedCount,.lastApply.status,.schedule.nextRunAt'
```

Inspect the latest report or apply Job logs before changing policy.
