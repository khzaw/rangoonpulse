---
title: Bazarr
summary: Subtitle-service persistence, background-job concurrency, and performance settings.
status: active
owner: homelab
last_reviewed: 2026-11-11
---

# Bazarr

The subtitle service at `bazarr.khzaw.dev` is declared in
`apps/bazarr/helmrelease.yaml`. Its configuration and database use the node-affined
`bazarr` local-path PVC; media is mounted separately at `/media`.

## Background work

The HelmRelease sets `DYNACONF_GENERAL__CONCURRENT_JOBS=1`. Bazarr's Dynaconf loader
applies this nested environment override to `general.concurrent_jobs` at startup.
Git owns this setting; an application-side edit is not durable across restarts.

One queued job runs at a time, preventing scheduled episode and movie scans from
competing within the container's CPU budget. All scheduled jobs remain enabled;
background batches can take longer. This bounds concurrent work rather than
reducing the total amount of work or guaranteeing lower idle memory.

Adaptive searching, the Sonarr/Radarr embedded-subtitle parser caches, scan
schedules, providers, and subtitle detection/synchronization settings remain
application-managed in `/config/config/config.yaml`. Prefer adaptive searching
and parser caching before disabling subtitle features. Do not replace the complete
configuration with a Git-managed file: it contains application credentials.

## Verification

Check the HelmRelease and workload readiness, the effective concurrent-jobs value
through Bazarr's authenticated settings API, scheduled tasks, completed jobs, and
the health endpoint. Read the API key inside the running container without printing
it. Confirm unrelated settings remain unchanged when adjusting an override.
