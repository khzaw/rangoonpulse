---
title: GitHub Credentials and Permissions
summary: Existing GitHub credential locations, verified capabilities, selection guidance, and safe revalidation without exposing values.
status: active
owner: homelab
last_reviewed: 2026-09-15
---

# GitHub Credentials and Permissions

## Start Here

Before asking the user to generate a GitHub token, check the existing credentials
below for the required operation. Reuse a suitable credential within the task's
authorized scope. Request a new token only when the existing credentials are
invalid or lack the necessary access.

This is a permission snapshot verified on **2026-09-15** against
`khzaw/rangoonpulse`. Recheck the relevant credential when using it; revocation,
rotation, repository access, and permissions can change. This document contains
Secret names, key names, and scope names only, never credential values.

## Available Credentials

| Location | Key / consumer | Verified capabilities | Use and limits |
|---|---|---|---|
| `default/exposure-control-github` | `GITHUB_TOKEN`; Control Panel environment and secret-commit helper Jobs | GitHub CLI OAuth credential; reported scopes `repo`, `read:org`, `gist`. Authentication, repository/tree reads, contents-write authorization, and Actions workflow-dispatch authorization passed. | Existing choice for Control Panel Secrets, managed Jobs configuration, Renovate status, and Run Renovate. `repo` is the relevant scope; the other observed scopes are not application requirements. This OAuth credential is broader than a repository-scoped PAT. |
| `monitoring/resource-advisor-github` | `token`; injected as `GITHUB_TOKEN` into Resource Advisor's apply-PR CronJob | Fine-grained PAT. Authentication, contents-write authorization, and pull-request-write authorization passed. Tree, workflow-run, PR, and issue reads succeeded on this public repository. **Actions write returned HTTP 403.** | Existing choice for Resource Advisor repository/PR work. Can support secret inventory and repository writes, but cannot replace the complete Control Panel integration because Run Renovate needs Actions write. Successful public reads do not establish the token's corresponding fine-grained grants. |
| `default/dynacat-github` | `token`; injected as `GITHUB_RELEASES_TOKEN` into Dynacat | Same credential as `monitoring/resource-advisor-github`, verified by comparing values in memory without printing them. | Existing choice for authenticated public-release lookups. The widget only reads, but the copied token retains the broader Resource Advisor permissions. Rotate both copies together. |
| `default/ghcr-pull-secret` and `flux-system/ghcr-pull-secret` | `.dockerconfigjson`; GHCR authentication entry | Same classic PAT in both copies; reported scope **`read:packages`**. Authentication passed. | Registry pulls and Flux image scans. Not a repository-write or workflow-dispatch credential, even though public repository API reads may return HTTP 200. Rotate both copies together. |

Encrypted sources:

- [Control Panel](../infrastructure/secrets/default/exposure-control-github.yaml)
- [Resource Advisor](../infrastructure/secrets/monitoring/resource-advisor-github.yaml)
- [Dynacat](../infrastructure/secrets/default/dynacat-github.yaml)
- [Workload GHCR pulls](../infrastructure/secrets/default/ghcr-pull-secret.yaml)
- [Flux GHCR scans](../infrastructure/secrets/flux-system/ghcr-pull-secret.yaml)

Related authentication sources:

| Location | Key / name | Purpose and availability |
|---|---|---|
| `flux-system/flux-system` | `identity`, `identity.pub`, `known_hosts` | SSH credential referenced by the [Flux GitRepository](../flux/flux-system/gotk-sync.yaml). It is not an HTTP API Bearer token. Source reconciliation proves read access; write access was not tested in this audit. |
| GitHub Actions repository secret | `RENOVATE_TOKEN` | Used by the [Renovate workflow](../.github/workflows/renovate.yaml). This is a GitHub-hosted secret, not a Kubernetes Secret; its stored value cannot be retrieved through the Actions secrets API. Its grants were not audited here. |
| Local GitHub CLI saved login | `gh` credential store; no Kubernetes key | Existing `khzaw` login supplied the Control Panel repair on 2026-09-15. Treat it as a fallback after checking cluster credentials. `GH_TOKEN` or `GITHUB_TOKEN` environment variables can override the saved login. Recheck its identity and required access before any reuse. |

No expiration was reported by the API for the credentials tested here. That is
not proof that they never expire or cannot be revoked.

## Which Credential To Use

| Operation | Existing choice | Permission needed for a fine-grained replacement |
|---|---|---|
| Control Panel Secrets inventory | `default/exposure-control-github` | Contents: read, followed by the existing Kubernetes Secret-read RBAC |
| Secret commits and managed Jobs configuration | `default/exposure-control-github` | Contents: read/write; the actor must also be allowed to push the target branch |
| Renovate workflow status and dispatch | `default/exposure-control-github` | Actions: read/write |
| Renovate PR and Dependency Dashboard display | `default/exposure-control-github` | Pull requests: read; Issues: read |
| Resource Advisor branch, contents, and PR updates | `monitoring/resource-advisor-github` | Contents: read/write; Pull requests: read/write |
| Dynacat public-release widget | `default/dynacat-github` | Authenticated public-release reads; the current shared token has additional permissions |
| GHCR private image pulls/scans | Namespace-local `ghcr-pull-secret` | Existing classic PAT scope `read:packages`, with access to the packages |

The complete Control Panel replacement needs **Contents read/write, Actions
read/write, Pull requests read, Issues read**, and automatically included
Metadata read for `khzaw/rangoonpulse`. Dispatching an existing workflow does not
require the separate Workflows-write permission. Editing workflow files would
be a different operation. See GitHub's [permission reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

## Revalidate Without Exposing Values

1. Read the named Secret into process memory. Keep values out of terminal output,
   command arguments, shell tracing, logs, screenshots, and documentation.
2. Check GitHub authentication and the exact repository operation needed. Print
   only the credential location, HTTP status, returned scope names, and a
   sanitized error. For `.dockerconfigjson`, select the `ghcr.io` entry in memory.
3. For classic/OAuth credentials, `X-OAuth-Scopes` reports the granted scopes.
   Fine-grained PATs do not provide an equivalent complete grant list there.
   `X-Accepted-GitHub-Permissions` describes an endpoint's requirements, not the
   token's actual grants. Repository `permissions.push` describes the account's
   repository role and does not prove that the token allows writes.
4. A public repository GET returning HTTP 200 does not prove write access or
   fine-grained read grants. Check required writes separately without performing
   a real commit, creating a PR, or dispatching a workflow just for diagnosis.

The 2026-09-15 audit sent authenticated requests with the deliberately incomplete
JSON body `{}` to these endpoints. Each lacks required fields and cannot perform
the operation. HTTP 422 with the listed missing-field error showed the request
reached validation. Classify HTTP 403 using its body and headers: it can mean a
permission failure or a rate limit. These are authorization checks, not proof
that a real write passed branch policy or completed end to end.

| Capability | Method and repository-relative endpoint | Validation response for an authorized request |
|---|---|---|
| Contents write | `PUT /contents/infrastructure/secrets/kustomization.yaml` | HTTP 422: missing `content`, `message`, `sha` |
| Pull requests write | `POST /pulls` | HTTP 422: missing `base`, `head` |
| Actions dispatch | `POST /actions/workflows/renovate.yaml/dispatches` | HTTP 422: missing `ref` |

Base URL: `https://api.github.com/repos/khzaw/rangoonpulse`. Interpret the actual
error body, not just HTTP 422; other validation errors can have different causes.
The Resource Advisor credential returned 403 with `Resource not accessible by
personal access token` for dispatch, while the Control Panel credential returned
the expected missing-`ref` validation error.

To verify the saved CLI login independently of environment overrides, this
command prints only its account name:

```bash
env -u GH_TOKEN -u GITHUB_TOKEN gh api user --jq '{login: .login}'
```

## Repair and Rotation

- Change the appropriate SOPS-encrypted source, commit/push, and reconcile
  `flux-system/secrets`. Permanent live-only Secret patches are not the repair.
- Account for copies: Resource Advisor/Dynacat share one credential; both GHCR
  Secrets share another. The Control Panel credential was sourced from the local
  saved CLI login, so revoking that same OAuth credential also affects its copy.
- Kubernetes environment variables are captured at pod startup. Verify the
  consuming workload restarts and uses the current Secret after rotation; the
  Control Panel also captures `GITHUB_TOKEN` once when its server starts.
- Verify the actual feature after reconcile, including any required write
  capability. For Secrets, check metadata only:

```bash
curl -fsS --max-time 30 'https://controlpanel.khzaw.dev/api/secrets?force=1' |
  jq '{configured, error, count: (.items | length),
       missing: [.items[]? | select(.existsLive != true) | {namespace, name}]}'
```

For Renovate status, use `/api/renovate?force=1` to bypass its cache. Check the
rendered lists after recovery. Avoid individual secret-detail endpoints during
authentication checks: they return plaintext values and do not exercise GitHub.
For Dynacat, verify rendered release entries after its rollout because release
lookups cache for 24 hours. Verify GHCR credentials through an image scan or pull;
a successful GitHub `/user` request alone does not prove package access.

In the 2026-09-15 incident, an invalid classic PAT caused `/api/secrets` to return
`Bad credentials` before Kubernetes inventory reads. The original pod matched
its Secret, so a restart alone could not repair it. Commit `9799a08` replaced the
encrypted credential from the existing CLI login; Flux applied it and the app
restarted. A forced inventory refresh then returned 26 managed entries, all
present live. The inventory count can grow as services are added.

See [secrets management](./secrets-management-current-state-options-and-plan.md)
for the editor and SOPS model, and [secrets inventory](./secrets-inventory.md) for
all service consumers.
