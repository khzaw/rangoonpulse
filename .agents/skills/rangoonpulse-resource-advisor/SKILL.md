---
name: rangoonpulse-resource-advisor
description: "Use for rangoonpulse Resource Advisor reports, apply-PR policy, exporter, cockpit tuning UI, and service eligibility."
---

# Rangoonpulse Resource Advisor

Read `docs/resource-advisor.md` plus the affected dashboard/service doc.

## Current Contract

- source: `infrastructure/resource-advisor/`
- Flux: `resource-advisor`
- namespace: `monitoring`
- report: daily 02:30 Asia/Singapore
- apply PR: Monday 03:30 Asia/Singapore
- metrics window: 14 days
- runtime report: `ConfigMap/monitoring/resource-advisor-latest`
- operator UI: `controlpanel.khzaw.dev/#tuning`

The runtime report ConfigMap is not Flux-owned.

## Policy

Apply-PR generation may modify only mapped HelmRelease resource fields. Current eligibility is authoritative in `APP_TEMPLATE_RELEASE_FILE_MAP` inside `infrastructure/resource-advisor/advisor.py`; do not copy the allowlist into docs.

Check every mapping path before claiming support. A stale path means the service is not safely auto-applicable even if a display name remains in policy.

Credentials are SOPS-managed. Do not create imperative replacement Secrets.

## Change Surface

Depending on scope, inspect:

- `infrastructure/resource-advisor/advisor.py`
- `infrastructure/resource-advisor/cronjob-apply-pr.yaml`
- `infrastructure/resource-advisor/capacity.py` and `capacity_snapshot.py` for shared CPU headroom and Git/CI snapshots; read `docs/cpu-headroom-validation.md`
- exporter Deployment/ServiceMonitor
- control-panel tuning API/UI
- the target HelmRelease's resource shape

## Verification

```bash
flux get kustomization resource-advisor -n flux-system
kubectl get cronjob,job -n monitoring | grep resource-advisor
kubectl get configmap resource-advisor-latest -n monitoring -o yaml
curl -s https://controlpanel.khzaw.dev/api/tuning | jq '.fetch,.applyPreflight.selectedCount,.lastApply.status,.schedule.nextRunAt'
```

Inspect the latest Job logs and live preflight before changing recommendation or apply policy.

Preserve the 14-day maturity gates, service floors, per-node rollout/job reserve, and conservative budget across separate PRs. Unknown placement or changed live requests must not silently pass. Keep every container visible, including missing-metrics rows. The Tuning preview must not imply resources were applied or treat unknown capacity as passing.

Script ConfigMaps use content hashes to roll the exporter automatically. The runtime report ConfigMap and `capacity-state` branch remain outside master desired state; never merge the snapshot branch into `master`.
