---
title: Speedtest Tracker Runtime
summary: Scheduler, file cache store, ephemeral PHP bytecode cache, persistence, and runtime verification.
status: active
owner: homelab
last_reviewed: 2026-11-22
---

# Speedtest Tracker Runtime

`apps/speedtest/helmrelease.yaml` owns the LinuxServer Speedtest Tracker deployment.
Results remain in the shared `media-postgres` database `speedtest_tracker`; `/config`
uses the existing local-path PVC. See [media PostgreSQL](./media-postgres.md) for
database ownership and backup limits.

## Scheduler and CPU

The image runs `php artisan schedule:run` from cron every minute and keeps one
`queue:work` process for dispatched jobs. Keep both: the scheduler checks
`SPEEDTEST_SCHEDULE`, runs nightly queue maintenance, and handles configured result
pruning. Speed tests run at `00:06`, `06:06`, `12:06`, and `18:06` in `Asia/Singapore`
(`6 */6 * * *`). Neither the app nor the image exposes the cron frequency or the
worker's 3-second poll interval; changing either means overriding the image's
crontab or s6 service.

Each scheduler run boots Laravel and Filament, about 0.6-0.7 CPU-s on the Pi even
with the bytecode cache below. That per-minute boot is most of the idle CPU
baseline (roughly 12m). The queue worker and PHP-FPM add only a few millicores.

## Cache Store

`CACHE_STORE=file` keeps Laravel's cache in the container's ephemeral
`storage/framework/cache`. The queue worker reads its pause and restart signals
from the cache on every poll, and the scheduler reads its pause flag every minute.
With the default `database` store, that added three `media-postgres` queries to each
worker poll and opened a database connection every minute. Idle database traffic is
now the worker's `jobs` poll plus sessions from monitoring checks.

Cache entries are disposable: a restart clears only transient state such as the
hourly release check, login rate limits, queue job locks, and the disabled
Prometheus integration's latest-result pointer. Queue jobs, batches, failed jobs,
sessions, and results stay in PostgreSQL. All PHP processes run as `abc` in one
container and share the file store and its locks; keep a single replica. Run
diagnostic `artisan` commands through `s6-setuidgid abc` so cache files never
become root-owned.

## PHP Bytecode Cache

The image enables CLI OPcache, but each short-lived scheduler process otherwise
rebuilds its own compiled code cache. The Git-managed LinuxServer startup script
creates an `abc`-owned, mode-0700 `/run/php-opcache` directory and enables PHP's
[second-level file cache](https://www.php.net/manual/en/opcache.configuration.php#ini.opcache.file-cache).
`PHP_INI_SCAN_DIR` retains the image's default scan directory and `/config/php`,
then reads the generated `/run/php-ini` override. Web and queue workers retain
shared-memory OPcache. Timestamp and checksum validation remain enabled; disabling
them, file-cache-only mode, or smaller shared memory does not measurably reduce
scheduler boot cost.

Cache files live in the container's ephemeral filesystem, not the data PVC.
Container replacement rebuilds them, including on image upgrades. Do not persist
this cache across application versions.

## Verification

- Render the pinned chart before interpreting probes: the current `spec`-only
  probe entries are disabled by app-template's default `enabled: false`. They
  do not generate kubelet HTTP traffic. Gatus monitors the private HTTPS
  service separately.
- Confirm `/api/healthcheck` and `/admin/login` respond through the running app,
  the result count/history survive rollout, and the next scheduled result appears.
- Check `s6-setuidgid abc php artisan about` reports the `file` cache, `database`
  queue, and `database` session drivers. Two `pg_stat_database` samples for
  `speedtest_tracker` taken 60 seconds apart should show no per-minute scheduler
  sessions; idle transactions come from the worker's 3-second `jobs` poll.
- Check `php -i` for `opcache.file_cache`, `opcache.enable_cli`,
  `opcache.validate_timestamps`, and `opcache.file_cache_consistency_checks`.
  Confirm cache files are created by the `abc` user and cron/queue workers remain
  running without PHP warnings.
- Compare CPU only after cache warm-up. Use cAdvisor series filtered by
  `metrics_path="/metrics/cadvisor"` to avoid counting kubelet resource metrics
  twice. Separate scheduled tests, rollout/startup, and diagnostic command CPU
  from steady background usage. Process CPU plus cron's reaped-child CPU can
  distinguish PHP web workers, queue polling, and scheduler startup.
