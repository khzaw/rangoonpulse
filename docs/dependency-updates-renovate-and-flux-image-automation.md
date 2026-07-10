# Dependency Updates: Renovate and Flux Image Automation

## Purpose
This doc defines the current split between service dependency updates and direct promotion of self-built artifacts.

## Current Model
- Flux remains the in-cluster deploy authority.
- Renovate runs through GitHub Actions and opens PRs for service dependency updates.
- Flux image automation remains narrow and writes directly to `master` only for explicitly selected self-built image flows.

## Why The Split Exists
- Service dependency maintenance benefits from reviewable PRs, batching, labels, and dashboard visibility.
- Self-built artifact promotion benefits from direct image-to-Git updates after a publish pipeline completes.
- These are different policies and should not target the same fields.

## Renovate Scope
- Config file: `/Users/khz/Code/rangoonpulse/renovate.json`
- Workflow: `/Users/khz/Code/rangoonpulse/.github/workflows/renovate.yaml`
- Execution model: GitHub-hosted Actions, not in-cluster
- Current enabled managers:
  - `flux` for `HelmRelease` chart version updates
  - `helm-values` for container image tags in Helm values style YAML
  - `github-actions` for workflow action updates
- Helm chart and service image updates are intentionally not broadly grouped.
  Each chart/image dependency should get its own Renovate branch and PR so a bad rollout can be reverted without backing out unrelated services.

## Renovate Guardrails
- PR concurrency and hourly creation are capped at five each to avoid floods while letting the nightly run
  drain a normal service-update backlog.
- Dependency dashboard enabled through GitHub Issues
- Static-site app paths are ignored by Renovate:
  - `/Users/khz/Code/rangoonpulse/apps/blog/helmrelease.yaml`
  - `/Users/khz/Code/rangoonpulse/apps/mmcal/helmrelease.yaml`
  - `/Users/khz/Code/rangoonpulse/apps/rangoon-mapper/helmrelease.yaml`
  - `/Users/khz/Code/rangoonpulse/apps/ericaknight/helmrelease.yaml`
- The intentionally pinned `alexfozor/flaresolverr` image is excluded from Renovate
- LinuxServer images use explicit regex versioning rules so Renovate can update tags with moving `-ls###`
  build suffixes instead of treating that suffix as immutable Docker compatibility
- The two AdGuard Home image references are intentionally split into file-specific branches and PRs:
  - `/Users/khz/Code/rangoonpulse/apps/adguard/primary/helmrelease.yaml`
  - `/Users/khz/Code/rangoonpulse/apps/adguard/secondary/helmrelease.yaml`
- GitHub Actions patch/minor updates may be grouped because they only touch workflow dependencies.
- Generated Flux install manifests under `flux/flux-system/**` are ignored
- `controlpanel.khzaw.dev` can dispatch the Renovate workflow and link matching open PRs from the updates tab

## Flux Image Automation Scope
- GitOps path: `/Users/khz/Code/rangoonpulse/infrastructure/image-automation/`
- Writer object: `/Users/khz/Code/rangoonpulse/infrastructure/image-automation/image-update-automation.yaml`
- Current scope:
  - `blog`
  - `mmcal`
  - `rangoon-mapper`
  - `ericaknight`
  - `interview-prep`

## Scan And Write Cadence

- The shared `ImageUpdateAutomation/flux-system` writer checks for policy changes every `1h`.
- `ImageRepository/interview-prep` scans GHCR every `1h` while the app is under active development.
- The static-site image repositories remain at `6h`; an hourly writer does not trigger extra registry scans for them.
- `Kustomization/image-automation` remains at `6h` because it reconciles the automation definitions, not published image tags.
- Return Interview Prep and the shared writer to `6h` when the active tweaking period ends.

## Operating Rule
- Do not let Renovate and Flux image automation manage the same image tag field.
- Use Flux image automation only for selected self-built artifacts that should promote directly after image publish.
- Use Renovate for ordinary service image and chart maintenance where PR review is desired.
- When the control panel detects updates for a tag family, confirm Renovate has a matching versioning rule before expecting
  PRs. Docker tags with suffixes are especially sensitive because Renovate preserves compatibility suffixes by default.
- For dual AdGuard, keep Renovate updates one instance per PR even when both files track the same upstream tag.
- Subarr image updates are given higher Renovate priority so user-visible update nags do not sit behind the
  broader media-service backlog.
- Do not add a broad `groupName` package rule for the `flux` or `helm-values` managers. That recreates oversized "helm chart patch and minor updates" PRs and hides standalone service PRs.

## Verification
```bash
# Trigger Renovate manually from GitHub
gh workflow run renovate.yaml

# Watch the latest run
gh run list --workflow renovate.yaml --limit 5

# Inspect opened PRs
gh pr list --search "label:renovate"

# Control panel triggers
curl -s https://controlpanel.khzaw.dev/api/renovate | jq
curl -s -X POST https://controlpanel.khzaw.dev/api/renovate/run | jq
```
