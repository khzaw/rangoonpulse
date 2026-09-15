---
title: Service Onboarding
summary: Required GitOps, dashboard, Control Panel, tuning, secrets, and live verification surfaces for every new application.
status: active
owner: homelab
last_reviewed: 2026-09-15
---

# Service Onboarding

Deploying a new app includes its complete operator setup: a healthy workload and hostname, dashboard and
monitoring entries, update and exposure controls, resource tuning, and the correct secrets inventory.
Complete these together before reporting the deployment done.

This is the default scope of a service deployment request in this repo. Follow explicit session instructions;
do not add a separate approval gate for work the user has already authorized. Keep the canonical hostname
private unless the user explicitly requests public access. Provisioning a disabled share route does not enable it.

## Required surfaces and evidence

| Surface | GitOps source or contract | Completion evidence |
| --- | --- | --- |
| Application | `apps/<name>/`, `flux/kustomizations/<name>.yaml`, `flux/kustomization.yaml`; prefer a HelmRelease | Reconciled revision, ready Flux/Helm objects, ready workload and endpoints, working canonical URL, and a representative app action |
| Dashboard | [Dynacat HelmRelease](../apps/dynacat/helmrelease.yaml), [dashboard guide](./dashboards-dynacat.md) | Bookmark opens the canonical HTTPS URL; the relevant Health monitor is present and healthy on the configured dashboard |
| Image and chart updates | [Control Panel server](../apps/exposure-control/server.js), [update policy](../apps/exposure-control/update-policy.js), [Renovate config](../renovate.json), [update guide](./dependency-updates-renovate-and-flux-image-automation.md) | Fresh image and Helm rows identify the correct workload/release and installed versions; Updates UI shows the rows and the intended maintenance path |
| Exposure control | [service catalog](../apps/exposure-control/services.json), [public-edge HelmRelease](../infrastructure/public-edge/helmrelease.yaml), [share DNS aliases](../infrastructure/public-edge/share-hosts-cname.yaml) | Exposure row exists; canonical access remains private; share DNS/tunnel routing resolves to the intended backend and the new share is disabled |
| Resource tuning | [advisor](../infrastructure/resource-advisor/advisor.py), [report CronJob](../infrastructure/resource-advisor/cronjob-report.yaml), [apply CronJob](../infrastructure/resource-advisor/cronjob-apply-pr.yaml), [exporter](../infrastructure/resource-advisor/exporter.py) | A fresh report contains the actual workload/container, the Tuning UI displays it, and live policy agrees with the intended HPA and apply behavior |
| Credentials | [encrypted secret tree](../infrastructure/secrets/), [inventory](./secrets-inventory.md), [Secrets UI contract](./secrets-management-current-state-options-and-plan.md) | Every introduced credential is encrypted in Git, referenced by its consumer, documented, live, and visible with the correct ownership and reveal/edit behavior on the Secrets page |
| Operating docs | [docs index](./README.md), [root overview](../README.md), [agent routing](../AGENTS.md), focused app guide | The app's access, resources/HPA, maintenance, credentials, and any concrete limitations are recorded |

Use `N/A` only for an actual unsupported or inapplicable integration, with the technical reason and evidence in
the app guide and final handoff. It is not a way to defer a required surface or skip it because the app already works.
A failed refresh, missing row, or unverified assumption is unfinished work. An explicit user-requested exception
must also be recorded so the next operator does not silently undo it.

## Dashboard and monitoring

Use **Dynacat at `https://rangoonpulse.khzaw.dev`**. Add a bookmark in the appropriate group and a monitor on the
relevant Health page. Give the bookmark the canonical HTTPS URL; use a cluster-local service health URL for the
monitor where supported. Add an upstream release watcher when an appropriate release source exists.

Render the embedded configuration and inspect the live configured pages after rollout. A successful
`/api/healthz` response alone is insufficient: Dynacat can expose it during initial setup as well. Open the new
bookmark, confirm the monitor result, and check the app itself. Do not use the retired Glance hostname or workload.

## Image and Helm update management

The Control Panel discovers image rows from live pods and chart rows from live HelmReleases. Discovery is only
an implementation detail; it is not proof that the new app has appeared in the operator UI.

Inspect `IMAGE_UPDATE_NAMESPACES`, `IMAGE_UPDATE_EXCLUDED_WORKLOADS`, the workload limit, workload identity,
primary-container selection, image reference parsing, and Helm source resolution in
[`server.js`](../apps/exposure-control/server.js). Extend the supported discovery path when necessary. Keep
version pins compatible with the tracker and verify any registry/version-family limitation explicitly.

Ordinary third-party images and charts use Renovate. Verify that their files are included by the relevant manager
and not excluded by an ignore or package rule. Selected self-built images may use Flux image automation under
[`infrastructure/image-automation/`](../infrastructure/image-automation/). Use one writer per image field; a
Control Panel row does not by itself establish update automation.

Force fresh snapshots after the app is running:

```bash
curl -fsS --max-time 180 'https://controlpanel.khzaw.dev/api/image-updates?refresh=1' |
  jq '{checkedAt,source,stale,error,items:[.items[] | select(.id == "<workload>")]}'
curl -fsS --max-time 180 'https://controlpanel.khzaw.dev/api/helm-updates?refresh=1' |
  jq '{checkedAt,source,stale,error,items:[.items[] | select(.id == "<release>")]}'
```

Check `checkedAt`, `source`, `stale`, and row details: refresh errors can return an older cached snapshot.
Then open [Control Panel Updates](https://controlpanel.khzaw.dev/#updates) and verify both rows and their
maintenance status. `Unknown` requires investigation or a documented concrete upstream limitation; it does not
mean the update path was verified. A workload without a HelmRelease may mark the chart row inapplicable, while
still completing its image maintenance path.

## Private access and disabled share setup

The normal canonical route uses the private ingress VIP on LAN and Tailscale. Keep ingress, DNS annotations,
TLS hosts, and the intended access boundary aligned. See the [access model](./networking-current-state-and-simplification.md)
and [exposure-control guide](./exposure-control-phase2-phase3-mvp.md).

For each new app, add the exposure catalog row and the corresponding disabled-by-default share plumbing:

1. `apps/exposure-control/services.json`: stable service ID, display name, cluster-local target, and share hostname.
2. `infrastructure/public-edge/helmrelease.yaml`: matching tunnel route to `exposure-control`.
3. `infrastructure/public-edge/share-hosts-cname.yaml`: matching ExternalDNS alias.

Preserve the existing share authentication defaults. Verify the actual catalog/API entry, public DNS and route,
and disabled response after reconciliation. Confirm both `enabled` and `desiredEnabled` are false:

```bash
curl -fsS 'https://controlpanel.khzaw.dev/api/services' |
  jq '.services[] | select(.id == "<service>") |
      {id,target,publicHost,enabled,desiredEnabled,authMode,defaultAuthMode}'
```

Open [Exposure Control](https://controlpanel.khzaw.dev/#exposure) and check the visible row. Leave the new share
disabled. A public Access challenge can verify the outer boundary; verify the disabled application gate through
the exposure backend as well when authentication prevents observing it directly. Do not enable public access
solely to complete a private deployment check.

A no-share exception must be explicit and recorded in the focused app guide with its reason and scope. Private
canonical access by itself is not a no-share exception: a disabled share route is part of ordinary onboarding.

## Resource tuning and HPA ownership

Set explicit requests and limits, and define a bounded HPA when requested or appropriate. Check placement and
capacity at the maximum replica count, including rollout overlap. Integrate the workload into the advisor's
report scope and make an intentional choice for automated resource changes.

Inspect `TARGET_NAMESPACES`, `APP_TEMPLATE_RELEASE_FILE_MAP`, any `APPLY_ALLOWLIST` override, service profiles,
floors, and downscale exclusions. For a supported app-template release, register its file mapping and appropriate
policy. A non-app-template release can remain report-only when the writer cannot safely edit its resources;
document that technical limitation. See the [resource-advisor contract](./resource-advisor-phase1-phase2.md).

An HPA must not accidentally fight resource tuning. For utilization targets, changing the request changes the
scaling threshold. Use a compatible policy that preserves the HPA's controlled requests or deliberately separates
the scaling signal from requests, and document the chosen ownership. Do not hide the app from reporting or
disable all tuning merely to avoid deciding how the HPA and resource recommendations interact.

After reconciling advisor changes, run a fresh **report** job, wait for completion, and inspect the result. New
services need not wait for the regular daily schedule to become visible. Preserve maturity gates; limited history
is a reason to defer automatic changes, not a reason to omit the row. Refresh/restart the exporter as required by
its documented ConfigMap loading behavior, then verify:

```bash
curl -fsS 'https://controlpanel.khzaw.dev/api/tuning' |
  jq '{fetch,rows:[.report.recommendations[] |
      select(.workload == "<workload>" or .release == "<release>")],
      applyPreflight:{selected:.applyPreflight.selected,skipped:.applyPreflight.skipped}}'
kubectl get hpa -n <namespace> <name>
```

Open [Control Panel Tuning](https://controlpanel.khzaw.dev/#tuning). Check the workload/container identity,
current resources, policy notes, report timestamp, and any apply skip reason. For an HPA, verify its target,
min/max replicas, live metrics, and conditions. A mapping edit or old report without the new workload is insufficient.

## Credentials and Secrets page

Inventory every new app credential: admin/bootstrap passwords, database credentials, API keys, signing/session
secrets, registry credentials, and widget credentials. Reuse an existing credential only when its ownership and
scope actually fit. Store newly introduced credential material with SOPS under
`infrastructure/secrets/<namespace>/`, add the namespace Kustomize entry, and reference the Secret from its
consumers. Keep values out of plaintext Git, docs, logs, screenshots, and final responses.

Document namespace/name, key names, consumers, management owner, and rotation/bootstrap behavior in
[`secrets-inventory.md`](./secrets-inventory.md) and the app guide. For app-generated credentials, establish the
supported encrypted source and lifecycle; if upstream prevents this, document the exact limitation and resolve
the operator workflow rather than silently omitting those credentials.

The [Secrets page](https://controlpanel.khzaw.dev/#secrets) is a required operator surface. Verify its namespace
allowlist/RBAC and inventory source support the introduced objects. Refresh the metadata endpoint and check the
actual row after the encrypted commit and Flux reconciliation:

```bash
curl -fsS 'https://controlpanel.khzaw.dev/api/secrets?refresh=1' |
  jq '{configured,checkedAt,items:[.items[] |
      select(.namespace == "<namespace>" and .name == "<secret>")]}'
```

Check that the live key names and consumer references agree. Validate reveal/edit availability only for objects
the page is entitled to manage. The detail endpoint `/api/secrets/<namespace>/<name>` returns plaintext values
for revealable secrets; do not dump its response into terminal output or evidence. Check metadata or key presence
without retaining values, and inspect the UI without capturing revealed credentials.

Cert-manager TLS material has different ownership. Record the Certificate, namespace, TLS Secret name, issuer,
and consuming hostname/ingress as managed TLS metadata. If the Secrets page supports a separate managed-TLS
inventory, verify its read-only entry and ownership there; do not expose private keys or offer app-secret edits.
If it does not support that inventory, record this exact UI limitation while verifying the live Certificate/Secret
metadata separately. Do not create an empty or fake application Secret for an app that only needs managed TLS;
record `application credentials: none` with the reason.

## Delivery and final verification

Validate all changed renderings/configuration, inspect the shared worktree, and stage only this task's hunks.
Commit and push according to the [shared-worktree skill](../.agents/skills/rangoonpulse-shared-worktree/SKILL.md).
Reconcile every affected Flux component, including supporting surfaces such as `secrets`, `dynacat`,
`exposure-control`, `public-edge`, `resource-advisor`, and `image-automation` when changed. Wait for their actual
rollouts; refresh caches and scheduled reports when those hide newly deployed state.

Close with concrete evidence for each required surface, the pushed revision, the intended access behavior, and
the resource/HPA policy. Include the concise operator-learning summary required by the shared-worktree skill.
Keep any real unsupported/inapplicable case explicit. A missing integration remains unfinished work until fixed
or addressed by an explicit user instruction.
