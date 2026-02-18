# AGENTS.md - rangoonpulse

## Project Overview
Homelab Kubernetes infrastructure-as-code repository using Flux CD GitOps.

This file documents how this cluster is operated today so a new LLM session can
continue work without re-discovery.

## Cluster Profile
- Kubernetes: Talos Linux cluster (primary `amd64` node + smaller `arm64` utility node)
- GitOps: Flux CD v2 (`Kustomization` + `HelmRelease`)
- Primary ingress: ingress-nginx with MetalLB
- DNS/TLS: Cloudflare + external-dns + cert-manager (Let's Encrypt)
- DNS automation model: external-dns (Cloudflare); tofu/terraform controller path is not active
- Remote access: Tailscale operator + subnet router (`Connector`)
- Storage mix: `local-path`, TrueNAS NFS classes (`truenas-*`), democratic-csi present
- Timezone standard: `Asia/Singapore`

## Repository Structure
- `apps/`: user-facing applications (mostly `namespace: default`)
- `core/`: core components (for example ingress-nginx base install/patch)
- `infrastructure/`: infra components and non-app services
- `flux/`: Helm repositories + Flux Kustomizations
- `talos/`: Talos machine configuration
- `docs/`: architectural notes, migration docs, backup planning

## Non-Negotiable Working Rules
- Use GitOps. Do not rely on direct `kubectl apply` for permanent changes.
- `kubectl apply --dry-run=client` is fine for validation.
- Prefer `HelmRelease` changes over raw manifests.
- Do not introduce a separate `values.yaml` when an app can be fully configured inline in `helmrelease.yaml`.
- Keep ingress, DNS annotation, and TLS settings aligned for every externally accessed app.
- Do not commit plaintext passwords/API keys in manifests.

## Documentation Hygiene (For Agents)
- If you change conventions (networking/access model, DNS/hostnames, storage classes, secrets patterns, app charts),
  update `AGENTS.md` and the most relevant doc(s) under `docs/`.
- If you find a new operational gotcha or incident pattern, add a short focused doc in `docs/` and link it from
  `AGENTS.md` ("Useful Reference Docs").
- Keep docs actionable: file paths, k8s object names, and concrete commands beat long narratives.
- Don’t churn docs for small tweaks; update docs only when it improves future ops/debugging.

## Current Access Model (Important)
The cluster uses a simplified unified path:
- LAN path: user -> `10.0.0.231` (MetalLB ingress IP)
- Remote path: user on Tailscale -> routed to `10.0.0.231` via subnet router

Implemented via:
- `infrastructure/tailscale-subnet-router/connector.yaml`
  - advertises routes:
    - `10.0.0.197/32` (Talos node / Kubernetes API)
    - `10.0.0.231/32` (ingress)
    - `10.0.0.210/32` (NAS)
    - `10.0.0.1/32` (router)
- `infrastructure/lan-gateway/` for NAS/router hostname access through ingress
  - `nas.khzaw.dev` -> service/endpoints -> `10.0.0.210:80`
  - `router.khzaw.dev` -> service/endpoints -> `10.0.0.1:80`
  - TLS terminates at ingress with cert-manager

Notes:
- Old Tailscale ingress-proxy/DNS indirection was removed in favor of subnet routing.
- `lan-access` Flux kustomization points to `./infrastructure/lan-gateway`.
  - If NFS-backed PVCs suddenly fail (democratic-csi probe timeout / pods stuck `ContainerCreating`), first check
    the TrueNAS Tailscale app has **"Accept Routes" disabled** to avoid asymmetric routing. See:
  - `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`

## Nodes (Current)
- Primary node: `talos-7nf-osf` (`amd64`, `10.0.0.197`)
- Utility node (Raspberry Pi): `talos-uua-g6r` (`arm64`, `10.0.0.38`)

## Scheduling / Node Placement (Important)
- Default policy: pin userland workloads to the primary node (`talos-7nf-osf`).
  - For `bjw-s-charts/app-template` (common v4), use:
    - `values.defaultPodOptionsStrategy: merge`
    - `values.defaultPodOptions.nodeSelector.kubernetes.io/hostname: talos-7nf-osf`
- Allowed on the Raspberry Pi (`talos-uua-g6r`) today:
  - `apps/glance` (dashboard)
  - `apps/profilarr`
  - `apps/adguard`
  - `apps/chartsdb`
  - `apps/uptime-kuma`
  - `apps/speedtest`
- Remember: `local-path` PVs are node-affined. Moving an app between nodes usually implies wiping/recreating the PVC
  (or migrating storage to NFS).

## Ingress and DNS Pattern
For public or tailnet-only app hostnames, use:
- ingress class: `nginx`
- annotation: `external-dns.alpha.kubernetes.io/hostname`
- annotation: `cert-manager.io/cluster-issuer: letsencrypt-prod`
- annotation: `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
- TLS section with matching hosts

Important external-dns behavior:
- external-dns is configured to ignore `spec.rules[].host` and `spec.tls[].hosts` on Ingress resources.
  You must declare hostnames via the `external-dns.alpha.kubernetes.io/hostname` annotation or DNS will not be created.
- external-dns also watches Services (`--source=service`), which enables clean CNAME aliases via `ExternalName`
  Services (example: `infrastructure/monitoring/monitoring-cname.yaml`).

## App Deployment Conventions
- Standard app layout:
  - `apps/<name>/helmrelease.yaml`
  - `apps/<name>/kustomization.yaml`
  - `flux/kustomizations/<name>.yaml`
  - add entry in `flux/kustomization.yaml`
- Most apps use `bjw-s-charts/app-template` chart.
- Keep resources explicit (requests and limits) for homelab capacity control.
- Validate manifests before pushing.

## Storage Conventions and Current Decisions
- Default StorageClass intent: `truenas-nfs` (NFS-backed default), not `local-path`.
- Immich:
  - photos/library on NFS PVC `immich-library` (`truenas-hdd-media`, RWX, 500Gi, expandable)
  - Postgres on `local-path` for low-latency/stability
- media-postgres (shared TimescaleDB):
  - Postgres/Timescale on `local-path` (node-local) for reliability; see `docs/media-postgres.md`
- Vaultwarden:
  - data on NFS (`truenas-nfs`, 5Gi, expandable)
- Grafana:
  - persistent storage enabled on `local-path` (currently 1Gi PVC)
- Uptime Kuma:
  - data on NFS (`truenas-nfs`, 1Gi, expandable)
- Tunarr:
  - config/state on NFS (`truenas-nfs`, mounted at `/root/.local/share/tunarr`)
- ErsatzTV:
  - config/state on NFS (`truenas-nfs`, mounted at `/config`)
  - media is mounted read-only from existing PVC claim `media`
- PVC object names in Kubernetes are dynamically generated by the provisioner and are not controlled by desired claim name.
- democratic-csi:
  - controller runs `hostNetwork: true` so the driver can reliably reach the TrueNAS API on `10.0.0.210`
  - refs: `infrastructure/storage/democratic-csi/hr-hdd.yaml`, `infrastructure/storage/democratic-csi/hr-nvme.yaml`

## Secrets and Credentials
- Runtime state: native Kubernetes Secrets.
- GitOps state: **SOPS + age** encrypted secret manifests under `infrastructure/secrets/**`, decrypted by Flux.
  - Flux decryption key Secret: `flux-system/sops-age`
  - SOPS rules: `.sops.yaml`
- Expected usage pattern in manifests:
  - `env` or chart values referencing `secretKeyRef`
  - no inline plaintext credentials
- Dashboard widget API keys are stored in `homepage-widget-secrets` and consumed by Glance via `envFrom`.
- Secret inventory (service -> secret mapping): `docs/secrets-inventory.md`
- Background/plan doc: `docs/secrets-management-current-state-options-and-plan.md`

## Dashboard (Glance)
- Glance:
  - `apps/glance/helmrelease.yaml` embeds `glance.yml` via ConfigMap and uses `envFrom: homepage-widget-secrets`
    so widgets can reference `${SONARR_API_KEY}`, `${JELLYFIN_API_KEY}`, etc.
  - Hostnames: `https://glance.khzaw.dev` and `https://hq.khzaw.dev` (alias)
  - When writing Glance `custom-api` templates inside HelmRelease YAML, wrap the template in `{{\` ... \`}}`
    so Helm doesn't interpret Glance's `{{ ... }}`.

## Uptime Kuma Status Page Gotcha
- If Glance shows `Status Page Not Found` for slug `rangoonpulse`, create + publish a Status Page in
  Uptime Kuma with that slug (UI: `Status Pages` -> `New Status Page` -> `Slug` -> `Publish`).

## Monitoring/Grafana Notes
- Monitoring stack: `infrastructure/monitoring/helmrelease.yaml`
- Grafana hostnames:
  - primary: `grafana.khzaw.dev`
  - alias: `monitoring.khzaw.dev` (CNAME via `infrastructure/monitoring/monitoring-cname.yaml`)
- Current critical settings:
  - `nodeExporter.enabled: false` (correct key for chart line in use)
  - Prometheus retention policy tuned for advisor window:
    - `retention: 14d`
    - `retentionSize: 6GB`
    - `storageSpec.emptyDir.sizeLimit: 8Gi`
  - Grafana persistence enabled
  - Grafana `defaultDashboardsTimezone: browser`
- If Grafana auth/state seems wrong, first verify PVC mount and user records before assuming full data loss.

## Naming and Migration Notes
- Jellyseerr -> Seerr migration is in progress.
- Path is `apps/seerr`, image is Seerr (`ghcr.io/seerr-team/seerr`), but some legacy Kubernetes object names still use `jellyseerr` for continuity.
- Do not rename release/object names casually when PVC/state continuity matters.

## Resource Tuning Guidance
- This is a primary-node homelab with mixed workloads (media + photos + utilities) plus a smaller ARM utility node.
- Keep requests realistic and limits bounded to reduce OOM/restart loops.
- Jellyfin can have occasional higher transcode load (rare 3-4 streams); avoid over-allocation across the rest of the stack.
- When tuning, prefer incremental adjustments and check restart counts/events after reconciliation.

## Resource Advisor Automation (Important)
- GitOps path: `infrastructure/resource-advisor/` via Flux Kustomization `resource-advisor`.
- Runtime model is Kubernetes CronJobs in namespace `monitoring`:
  - `resource-advisor-report`:
    - daily run at `02:30` (`Asia/Singapore`)
    - report-only mode
    - writes `latest.json` and `latest.md` to ConfigMap `resource-advisor-latest`
  - `resource-advisor-apply-pr`:
    - weekly run at `03:30` Monday (`Asia/Singapore`)
    - apply-PR mode with budget and data-maturity guards
    - creates unique `tune/...` branches from latest `master`
    - supports multiple simultaneous recommendation branches/PRs
- Report PR flow is disabled by design.
- Apply PR flow rules:
  - commit only HelmRelease resource changes
  - do not commit generated report/apply artifacts into repository
  - include decision rationale, constraints, and skipped reasons in PR description
  - apply planner uses live pod request footprint + current pod placement for node-fit simulation; see `docs/resource-advisor-phase1-phase2.md`
  - do not chase raw averages; deadband is enforced by default:
    - `DEADBAND_PERCENT=10`
    - `DEADBAND_CPU_M=25`
    - `DEADBAND_MEM_MI=64`
- Required secret for apply PR creation:
  - `monitoring/resource-advisor-github` with key `token`
  - token scopes: repo contents write + pull requests write
- Troubleshooting sequence:
  - `flux get kustomizations`
  - `kubectl get cronjobs -n monitoring | rg resource-advisor`
  - `kubectl get jobs -n monitoring | rg resource-advisor`
  - `kubectl logs -n monitoring job/<job-name>`
  - `kubectl get configmap resource-advisor-latest -n monitoring -o yaml`
  - Note: `resource-advisor-latest` is runtime-owned state and should not be reconciled by Flux. The CronJobs
    create/update it directly.

## Validation and Operations Commands
```bash
# Validate manifest structure
kubectl apply --dry-run=client -f <file>

# Flux health and rollout status
flux get kustomizations
flux get hr -A
flux reconcile kustomization <name> --with-source

# Troubleshooting
kubectl get pods -A
kubectl describe hr -n <ns> <name>
kubectl get events -n <ns> --sort-by=.lastTimestamp

# Talos node checks
talosctl -n 10.0.0.197 dashboard
```

## Commit Message Convention
Use:
- `<service>: <message>`

Examples:
- `tailscale-operator: bump chart to latest stable`
- `monitoring: fix nodeExporter disable key`
- `homepage: reorganize groups and widgets`

## Useful Reference Docs
- `docs/resource-advisor-phase1-phase2.md`
- `docs/networking-current-state-and-simplification.md`
- `docs/networking-simplified-migration-todo.md`
- `docs/lan-access-current-state-and-lean-plan.md`
- `docs/secrets-management-current-state-options-and-plan.md`
- `docs/truenas-tailscale-accept-routes-caused-democratic-csi-outage.md`
- `docs/arm64-node-canal-flexvol-exec-format-error.md`
- `docs/router-dns-rebind-private-a-records.md`
- `docs/dashboards-homepage-glance.md`
- `docs/tv-channels-tunarr-ersatztv.md`
- `docs/tracerr.md`
- `docs/isponsorblocktv.md`
- `docs/media-postgres.md`
- `docs/backup-plan.md`
- `docs/blog-static-site-gitops-deployment-plan.md`
