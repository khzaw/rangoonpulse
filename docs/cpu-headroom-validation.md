---
title: CPU Headroom Validation
summary: Git and CI capacity checks for resource edits, new workloads, and replica scaling without live admission enforcement.
status: active
owner: homelab
last_reviewed: 2026-10-22
---

# CPU Headroom Validation

Resource Advisor and the Git/CI preflight share the per-node reserve
`max(1000m, replacement CPU + 150m for a job)`. Manual resource changes and new
services must pass this check before pushing. Kubernetes API writes are not
intercepted: there is no validating webhook, admission listener, or admission TLS.
Resource Advisor retains its own proposal safety gate.

## Git and CI checks

```sh
make check-git-capacity BASE=origin/master
KUBECONFIG="$PWD/kubeconfig" make check-capacity FILE=/tmp/rendered-workloads.yaml
```

The Git check builds both revisions' Flux paths with Kustomize, substitutes shared
cluster settings, resolves Git-managed ConfigMap Helm values, and renders changed
Helm releases with their pinned chart versions. It compares actual workload CPU,
replicas, placement, and surge settings. Image-only and CPU-neutral changes do not
need spare reservation budget. Chart defaults are included; HelmRelease values
alone are not an acceptable substitute for rendering.

CI compares a PR to its base, or a master push to its previous commit. Changed
workloads are checked together, so two services cannot independently spend the
same snapshot headroom. Unmerged or unfinished downsizes cannot pay for growth.
Unsupported Helm post-renderers, chartRef, and Secret-backed values fail validation.
Operator CRs with resource fields may pass only when their entire rendered objects
are identical in both revisions. New or changed operator objects, including
replica, placement, or resource-field removal, fail validation; add explicit
rendering support before changing those inputs. This allows a Grafana credential
change without bypassing checks on Prometheus or Alertmanager resource changes.

## Snapshot publication

`monitoring/resource-advisor-capacity-snapshot` runs every 15 minutes. It reads
nodes, pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, and Jobs through
the existing Resource Advisor service account. It publishes only allowlisted CPU
requests, placement, replica/rollout settings, identities, and lifecycle state to
`capacity-snapshot.json` on the dedicated `capacity-state` Git branch. Effective
CPU already includes init containers, restartable sidecars, limit-defaulted
requests, Pod-level requests, and overhead. Environment, images, volumes,
application configuration, and credentials are excluded.

The publisher reuses `monitoring/resource-advisor-github` (contents write); CI
reads the public branch without cluster or GitHub write credentials. The branch
is runtime state, is outside Flux's master source, and does not trigger master CI.
It must never be merged into master. The Control Panel Jobs view exposes the
publisher's schedule, last result, and manual run action.

Snapshots older than 30 minutes fail capacity-changing CI checks. No-change
builds do not require a snapshot. To refresh immediately:

```sh
kubectl create job -n monitoring --from=cronjob/resource-advisor-capacity-snapshot resource-advisor-capacity-refresh
kubectl logs -n monitoring job/resource-advisor-capacity-refresh
```

Use `--snapshot <file>` with `scripts/check_git_capacity.py` for an offline test.
The local rendered-manifest preflight reads the cluster directly and does not
publish or change any workload.

## Scope and limits

The validator covers Deployments, StatefulSets, DaemonSets, ReplicaSets, Pods,
Jobs and CronJobs. It respects node selectors and required node affinity; growth
without fixed placement must fit every eligible node. Live pod reservations and
controller intent are both counted. Deployment surge can increase the reserve.
Jobs can use the 150m job allowance while retaining rollout space.

This is a preflight against a point-in-time snapshot. Separate concurrent PRs,
direct API writes, autoscalers, and changes after CI can consume capacity later.
Rerun the live preflight before delivery and validate an HPA's intended maximum
replicas explicitly. CI failure is a repository check, not a Kubernetes admission
policy or a substitute for branch protection. A direct master push can reach Flux
before CI finishes. Check live placement, rollout, and alerts after reconciliation.

The prior API webhook has been removed through GitOps, along with its registration,
TLS resources, network policy and listener. Deletes and manual recovery require no
admission break-glass procedure. Script ConfigMaps retain content hashes so policy
changes automatically roll the running exporter and update subsequent Jobs.
