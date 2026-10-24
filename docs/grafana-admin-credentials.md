---
title: Grafana Admin Credentials
summary: SOPS-managed Grafana credentials, operator retrieval, and rotation of the password stored in the persistent database.
status: active
owner: homelab
last_reviewed: 2026-10-25
---

# Grafana Admin Credentials

Grafana uses `monitoring/grafana-admin`, with keys `admin-user` and
`admin-password`. Its source is
`infrastructure/secrets/monitoring/grafana-admin.yaml`, encrypted with SOPS+age.
The monitoring HelmRelease references it through `grafana.admin.existingSecret`.
The monitoring Flux Kustomization depends on `secrets` so bootstrap waits for
the credential to exist.

## Retrieve the password

Open the Secrets section of [Control Panel](https://controlpanel.khzaw.dev),
select namespace `monitoring`, and reveal `grafana-admin` only when needed.
The username is `admin`. Do not paste the password into logs, commits, or chat.
The normal SOPS and Kubernetes administrator recovery paths also remain available.

## Rotation with an existing database

Grafana persists account passwords in its database. The configured admin password
is [used only on first run](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#admin_password).
Updating a Helm value, Secret, or environment variable does not change an account
that already exists on the PVC.

1. Generate a random password and update the SOPS-managed Secret through Git.
   Keep the current working credential available until rotation is verified.
2. Reconcile `secrets`, then `monitoring`, and verify that the Grafana container
   references `grafana-admin` for both admin environment variables.
3. Change the existing account password through Grafana's authenticated
   `PUT /api/user/password` endpoint over HTTPS, supplying `oldPassword`,
   `newPassword`, and `confirmNew`. Send credentials in memory or on standard
   input, not command-line arguments or logged payloads. See the
   [Grafana User API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/user/#change-password).
4. Verify the stored Secret authenticates to `/api/user` as the administrator,
   the previous password returns 401, and `/api/health` reports a healthy database.
5. Confirm the Secret appears in Control Panel with `existsLive: true` and both
   expected keys, then discard any temporary credential material.

Changing only the Secret in Control Panel performs step 1; it does not perform
the Grafana database update. Do not delete the PVC or database to reset a password.

The encrypted bootstrap value and persisted database password must agree after rotation. A healthy Helm rollout alone does not prove the old login was removed.
