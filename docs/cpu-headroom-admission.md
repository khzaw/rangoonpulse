---
title: CPU Headroom Admission
summary: Live CPU reservation enforcement for manual changes, new workloads, scaling, and controller-created rollout pods.
status: active
owner: homelab
last_reviewed: 2026-10-22
---

# CPU Headroom Admission

The Resource Advisor TLS admission endpoint enforces the same per-node CPU reserve
as its proposal planner: `max(1000m, replacement CPU + 150m for a job)`. It checks
rendered Kubernetes workloads, so chart defaults and manual Kubernetes API writes
are covered alongside GitOps changes. CPU-neutral pinned updates and recovery
reductions remain available when the reserve is short.

## What is checked

- Deployments, StatefulSets, DaemonSets, standalone ReplicaSets and Pods, Jobs,
  CronJobs, workload `/scale`, and Pod `/resize` requests.
- Live nodes, pods, controller templates, desired replicas, and accepted writes
  that have not yet appeared in API reads. Two simultaneous deployments cannot
  each spend the same observed free space within this single admission process.
- Controller intent reserves CPU before its first pod exists. Existing pod
  requests remain counted until termination, so an unfinished downsize does not
  pay for another change. Active Jobs count; completed/failed Jobs do not.
- A proposal without a fixed node must fit on every eligible node. Node selectors
  and required node affinity narrow that set. Utility-node capacity cannot fund
  primary-node placement.
- Deployment surge replicas increase replacement space. Standard and restartable
  init containers, sidecars, pod-level requests, and pod overhead count.
- Controlled children must match a real controller UID, stay within its template
  CPU/placement and replica/rollout budget, and fit allocatable CPU. Approved
  replacements can consume the space reserved for them. Job creation can use the
  150m job allowance while retaining rollout space; CronJobs are checked again
  through their actual Jobs at execution time.

The check rejects CPU growth with a node-specific free/required CPU message.
Admission dry runs never hold reservations or create resources. Accepted writes
are held for up to five minutes until observed in the API. Rejected/failed writes
can temporarily make that budget conservative. The ledger is in memory; the
webhook uses one exporter replica. Its purpose is operational capacity protection,
not an authorization boundary against cluster administrators.

## Runtime and TLS

- Code: `infrastructure/resource-advisor/capacity.py` and `admission.py`.
- Backend: existing `monitoring/resource-advisor-exporter`, HTTPS port 8443,
  `/validate`; no public ingress or separate application hostname.
- Cert-manager owns `resource-advisor-admission-ca` and
  `resource-advisor-admission-tls`. The stable CA signs a rotating service
  certificate. The server reloads the certificate at the next TLS connection;
  cainjector supplies the webhook trust bundle. These generated keys are not
  Git-managed SOPS credentials.
- The NetworkPolicy allows TLS admission traffic from node IPs and the exporter
  itself. Port 8081 retains the existing Tuning and metrics access.
- Activation lives in a separate Flux Kustomization depending on the backend, so
  a new cluster brings up the listener before registering the admission webhook.
- `failurePolicy: Fail` rejects guarded changes if the endpoint cannot validate
  them. Deletes, status updates, and mirror Pods are outside its rules. The
  exporter's own Deployment and its labelled Pods/ReplicaSets are exempt so the
  admission backend can recover without calling itself.
- Controller-created Pods and ReplicaSets in core networking, DNS, Flux, TLS,
  storage, ingress, and Tailscale namespaces can also bootstrap without the
  webhook. Their Deployment/StatefulSet/DaemonSet templates, scaling, and Pod
  resource resizing still pass the guard. This prevents a cold-start dependency
  cycle in which CNI/DNS would need a webhook Pod that cannot start without CNI.
- The backend has no workload-readiness dependencies and retries failed bootstrap
  applies every minute until its namespace and cert-manager CRDs exist. A blocked
  workload update must not prevent delivery of an admission repair. Activation
  still waits for the backend Deployment and TLS Certificate to become ready.
- `resource_advisor_cpu_admission_total{kind,allowed}` records decisions alongside
  the existing headroom metrics. Tuning remains at `controlpanel.khzaw.dev`.

This infrastructure endpoint has no user-facing bookmark/share route or update
row of its own. It uses the existing Python image, deployment, health checks,
ServiceMonitor, Tuning surface, and Resource Advisor update ownership.

## Read-only preflight

Render chart values into actual workload manifests before testing capacity:

```sh
KUBECONFIG="$PWD/kubeconfig" make check-capacity FILE=/tmp/rendered-workloads.yaml
KUBECONFIG="$PWD/kubeconfig" kubectl apply --dry-run=server -f /tmp/rendered-workloads.yaml
```

`check-capacity` checks the complete file as one proposed batch against a live
snapshot; it writes no cluster objects. HelmRelease values alone are rejected
because they omit chart defaults. CI runs the shared validator's regression tests;
CI has no cluster credentials, so the live admission check remains authoritative
for actual rollout. Use the preflight for manual resource edits and new services,
including the intended replica count and surge settings.

## Verification and recovery

Verify the backend rollout, Certificate Ready, nonempty injected CA, and Flux
activation readiness. Server-side dry runs should reject a reserve-breaking new
Deployment and CPU upsize, permit a small safe workload and unchanged restart,
and create no test objects. Check that ordinary rollout children still become
ready and that the Tuning API remains healthy.

If the endpoint fails, inspect exporter logs, the TLS Certificate/Secret metadata,
Service endpoints, RBAC, and NetworkPolicy first. The backend's own recovery
objects and deletion of the webhook are exempt from admission. For emergency
recovery only, suspend the activation Kustomization, delete the
`resource-advisor-cpu-headroom` ValidatingWebhookConfiguration, repair the
Git-managed backend, then resume/reconcile activation and rerun dry-run checks.
Never remove the policy permanently through a live-only patch.
