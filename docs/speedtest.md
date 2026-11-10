---
title: Speedtest Tracker Runtime
summary: Scheduler, ephemeral PHP bytecode cache, persistence, and runtime verification.
status: active
owner: homelab
last_reviewed: 2026-11-03
---

# Speedtest Tracker Runtime

`apps/speedtest/helmrelease.yaml` owns the LinuxServer Speedtest Tracker deployment.
Results remain in the shared `media-postgres` database `speedtest_tracker`; `/config`
uses the existing local-path PVC. See [media PostgreSQL](./media-postgres.md) for
database ownership and backup limits.

## Scheduler and CPU

The image runs `php artisan schedule:run` every minute and keeps a separate
`queue:work` process for dispatched jobs. Keep both: the scheduler checks
`SPEEDTEST_SCHEDULE`, runs nightly queue maintenance, and handles configured result
pruning. Speed tests run at `00:06`, `06:06`, `12:06`, and `18:06` in `Asia/Singapore`
(`6 */6 * * *`).

The image enables CLI OPcache, but each short-lived scheduler process otherwise
rebuilds its own compiled code cache. The Git-managed LinuxServer startup script
creates an `abc`-owned, mode-0700 `/run/php-opcache` directory and enables PHP's
[second-level file cache](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.file-cache).
`PHP_INI_SCAN_DIR` retains the image's default scan directory and `/config/php`,
then reads the generated `/run/php-ini` override. Web and queue workers retain
shared-memory OPcache. Timestamp and checksum validation remain enabled.

Cache files live in the container's ephemeral filesystem, not the data PVC.
Container replacement rebuilds them, including on image upgrades. No custom
scheduler, changed test frequency, database change, or resource reduction is
needed. Do not persist this cache across application versions.

## Verification

- Render the pinned chart before interpreting probes: the current `spec`-only
  probe entries are disabled by app-template's default `enabled: false`. They
  do not generate kubelet HTTP traffic. Gatus monitors the private HTTPS
  service separately.
- Confirm `/api/healthcheck` and `/admin/login` respond through the running app,
  the result count/history survive rollout, and the next scheduled result appears.
- Check `php -i` for `opcache.file_cache`, `opcache.enable_cli`,
  `opcache.validate_timestamps`, and `opcache.file_cache_consistency_checks`.
  Confirm cache files are created by the `abc` user and cron/queue workers remain
  running without PHP warnings.
- Compare CPU only after cache warm-up. Use cAdvisor series filtered by
  `metrics_path="/metrics/cadvisor"` to avoid counting kubelet resource metrics
  twice. Separate scheduled tests, rollout/startup, and diagnostic command CPU
  from steady background usage. Process CPU plus cron's reaped-child CPU can
  distinguish PHP web workers, queue polling, and scheduler startup.
