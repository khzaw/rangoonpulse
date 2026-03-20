---
name: rangoonpulse-resource-advisor
description: "Use when touching /Users/khz/Code/rangoonpulse/infrastructure/resource-advisor, the tuning UI in controlpanel, auto-apply policy, or service integration with the resource-advisor automation."
---

# Rangoonpulse Resource Advisor

Use this skill only when the active workspace is `/Users/khz/Code/rangoonpulse`.

## Read First

Open the smallest relevant subset:
- `/Users/khz/Code/rangoonpulse/docs/resource-advisor-phase1-phase2.md`
- `/Users/khz/Code/rangoonpulse/docs/homelab-operations-dashboards.md` when dashboard surfaces change
- `/Users/khz/Code/rangoonpulse/docs/node-capacity-dashboard.md` when node-fit or capacity assumptions change
- `/Users/khz/Code/rangoonpulse/docs/metrics-server-operational-metrics.md` when Metrics API assumptions change

## Current Contract

- GitOps path: `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/`
- Flux kustomization: `resource-advisor`
- Runtime model: CronJobs in namespace `monitoring`
  - `resource-advisor-report`: daily at `02:30` (`Asia/Singapore`)
  - `resource-advisor-apply-pr`: Monday at `03:30` (`Asia/Singapore`)
- Runtime state lives in `ConfigMap/monitoring/resource-advisor-latest`
  - do not reconcile that ConfigMap with Flux
- The combined operator UI entry is `https://controlpanel.khzaw.dev` in the `Tuning` section

## Important Rules

- Apply PR generation is intentionally narrow: commit only HelmRelease resource changes.
- The default auto-apply allowlist comes from `APP_TEMPLATE_RELEASE_FILE_MAP` in `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/advisor.py`.
- If a service should enter or leave auto-apply scope, update the advisor mapping and the relevant docs in the same change.
- Prometheus durability matters because the advisor depends on a 14-day metrics window.
- Exporter code is mounted from a ConfigMap. A reconcile updates the mounted file, but a running exporter process may still need:

```bash
kubectl rollout restart deployment/resource-advisor-exporter -n monitoring
```

## Service Touch Points

When a service change should affect tuning behavior, inspect:
- `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/advisor.py`
- `/Users/khz/Code/rangoonpulse/infrastructure/resource-advisor/cronjob-apply-pr.yaml`
- the focused docs that describe auto-apply scope or tuning policy

## Verification

```bash
flux get kustomizations -n flux-system | rg resource-advisor
kubectl get cronjobs -n monitoring | rg resource-advisor
kubectl get jobs -n monitoring | rg resource-advisor
kubectl get configmap resource-advisor-latest -n monitoring -o yaml
kubectl auth can-i get cronjobs.batch -n monitoring --as=system:serviceaccount:monitoring:resource-advisor
curl -s https://controlpanel.khzaw.dev/api/tuning | jq '.fetch,.applyPreflight.selectedCount,.lastApply.status,.schedule.nextRunAt'
```

If a report or apply run looks wrong, inspect the recent Job logs before changing policy:

```bash
kubectl logs -n monitoring job/<job-name>
```
