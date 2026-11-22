-- Prints one line per TimescaleDB problem in tracearr; no output means healthy.
-- The CronJob runs it read-only as the tracearr role, which owns the database and its jobs.

-- The server library moves with the image, but the extension stays on its installed version.
select format('extension %s differs from the server library %s; update it per docs/media-postgres.md#extension-updates',
              coalesce(installed_version, 'missing'), default_version)
from pg_available_extensions
where name = 'timescaledb'
  and installed_version is distinct from default_version

union all

-- Failing jobs back off, so judge them by their last success rather than the latest run.
select format('job %s (%s) last succeeded %s, latest run %s; allowed gap %s',
              j.job_id, j.application_name, coalesce(s.last_successful_finish::text, 'never'),
              coalesce(s.last_run_status, 'none'), greatest(3 * j.schedule_interval, interval '2 hours'))
from timescaledb_information.jobs j
join timescaledb_information.job_stats s using (job_id)
where j.scheduled
  and j.proc_name <> 'policy_telemetry'
  and s.total_runs > 0
  and coalesce(s.last_successful_finish, '-infinity') < now() - greatest(3 * j.schedule_interval, interval '2 hours')

union all

-- A due job that never starts means the database's scheduler is not running.
select format('job %s (%s) was due at %s and has not started; check the TimescaleDB scheduler',
              j.job_id, j.application_name, s.next_start)
from timescaledb_information.jobs j
join timescaledb_information.job_stats s using (job_id)
where j.scheduled
  and j.proc_name <> 'policy_telemetry'
  and s.job_status <> 'Running'
  and s.next_start < now() - interval '1 hour';
