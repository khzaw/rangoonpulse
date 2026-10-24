---
title: GitHub Credentials and Permissions
summary: Credential ownership, operation-specific permissions, reuse, and rotation without exposing values.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# GitHub Credentials and Permissions

Before requesting a new token, inspect the existing credential's purpose and revalidate the exact operation needed. Reuse a suitable credential within the task's authorization. Revocation, rotation, repository access, and grants can change independently of Git configuration.

This document records wiring and permission requirements, not a guarantee that a saved token is currently valid. Keep values, fingerprints, and private keys out of logs and docs.

## Credential Ownership

| Location | Key / consumer | Required capability |
| --- | --- | --- |
| `default/exposure-control-github` | `GITHUB_TOKEN`; Control Panel and secret-commit Jobs | Repository tree reads, contents writes, PR/issue reads, and Actions workflow status/dispatch |
| `monitoring/resource-advisor-github` | `token`; advisor apply Jobs and capacity publisher | Repository contents and pull-request writes; does not require Actions dispatch |
| `default/dynacat-github` | `token` → `GITHUB_RELEASES_TOKEN` | Authenticated public-release reads only |
| `default/ghcr-pull-secret` | `.dockerconfigjson`; private workload image pulls | GHCR package reads |
| `flux-system/ghcr-pull-secret` | `.dockerconfigjson`; private Flux image scans | GHCR package reads |
| `flux-system/flux-system` | `identity`, `identity.pub`, `known_hosts` | SSH Git authentication; not an HTTP API Bearer token |
| Actions `TARIFF_UPDATE_TOKEN` | Power-tariff workflow | Contents/PR writes; inspect branch-policy requirements |
| Actions `RENOVATE_TOKEN` | Renovate workflow | Renovate's repository/PR operations; inspect workflow and token grants |
| Local `gh` saved login | GitHub CLI credential store | Fallback only after identity and required access are checked |

Encrypted sources live under `infrastructure/secrets/default/`, `infrastructure/secrets/monitoring/`, and `infrastructure/secrets/flux-system/`. Actions secrets and Flux's bootstrap SSH identity have separate ownership; the Actions API cannot return stored secret values.

Rotation dependencies must account for all copies: Resource Advisor, Dynacat, and Actions `TARIFF_UPDATE_TOKEN` share the documented reuse path; the two GHCR objects also need coordinated rotation. Compare current values in memory if identity matters. Do not assume files with different names contain independent credentials.

## Permission Selection

A fine-grained Control Panel replacement needs Contents read/write, Actions read/write, Pull requests read, Issues read, and included Metadata read on `khzaw/rangoonpulse`. Dispatching an existing workflow differs from editing its workflow file; verify the endpoint's actual requirements.

Resource Advisor's contents/PR-write credential is not automatically a complete Control Panel replacement. Successful reads on a public repository do not prove write or workflow-dispatch permission. Dynacat needs only release reads even if a reused token has broader grants. GHCR package reads do not imply Git repository writes.

## Revalidate Without Exposing Values

1. Read a named Secret or saved CLI credential into process memory. Keep values out of argv, tracing, output, screenshots, and files. For Docker credentials, select the `ghcr.io` entry in memory.
2. Verify authentication and the exact required repository operation. Print only credential location, HTTP status, scope names, and sanitized errors.
3. For classic/OAuth credentials, `X-OAuth-Scopes` reports scopes. Fine-grained PATs have no equivalent complete grant list there. `X-Accepted-GitHub-Permissions` describes an endpoint's requirements, not actual token grants; repository `permissions.push` describes the account role.
4. Public GET success is insufficient write evidence. Avoid real commits, PRs, or workflow dispatches merely to diagnose access.

An authenticated request with the deliberately incomplete JSON body `{}` can test whether an endpoint reaches required-field validation without creating the object:

| Capability | Method and repository-relative endpoint | Expected missing-field validation |
| --- | --- | --- |
| Contents write | `PUT /contents/infrastructure/secrets/kustomization.yaml` | Missing `content`, `message`, `sha` |
| Pull-request write | `POST /pulls` | Missing `base`, `head` |
| Workflow dispatch | `POST /actions/workflows/renovate.yaml/dispatches` | Missing `ref` |

Base: `https://api.github.com/repos/khzaw/rangoonpulse`. Interpret the actual HTTP 422 error body, not the status alone. Classify HTTP 403 using body and rate-limit headers. Reaching validation is not proof a real write passes branch policy or succeeds end to end.

To inspect the saved CLI identity without environment overrides:

```bash
env -u GH_TOKEN -u GITHUB_TOKEN gh api user --jq '{login: .login}'
```

No reported expiration is not proof a credential cannot expire or be revoked.

## Repair And Rotation

Update the encrypted source, commit/push, reconcile `secrets`, and verify consumer restarts. Environment-based tokens are captured at process startup; restarting with an invalid unchanged Secret cannot repair authentication.

For the private Secrets inventory, GitHub reads precede the Kubernetes join. `Bad credentials` can therefore hide valid live Secrets. Refresh and inspect only metadata:

```bash
curl -fsS --max-time 30 'https://controlpanel.khzaw.dev/api/secrets?force=1' |
  jq '{configured, error, count: (.items | length),
       missing: [.items[]? | select(.existsLive != true) | {namespace, name}]}'
```

Use `/api/renovate?force=1` for status refresh. Individual Secret-detail endpoints return plaintext values and are unsuitable for routine authentication checks. Verify Dynacat's rendered release entries after rotation because release lookups cache for 24 hours; verify GHCR through the required image pull or scan.

See [secrets management](./secrets-management.md), [inventory](./secrets-inventory.md), and [power-tariff automation](./power-estimation-dashboard.md) for consumers and recovery.
