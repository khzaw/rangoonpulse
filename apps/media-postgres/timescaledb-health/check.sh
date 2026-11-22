#!/bin/sh
# Hourly TimescaleDB health check for the tracearr database.
# Any output from check.sql fails the Job, which raises HomelabCronJobTracearrTimescaleUnhealthy.
set -eu

problems=$(psql -X -At -v ON_ERROR_STOP=1 -f /scripts/check.sql)
if [ -n "$problems" ]; then
  echo "tracearr TimescaleDB is unhealthy:"
  echo "$problems"
  exit 1
fi

echo "tracearr TimescaleDB is healthy: $(psql -X -At -c "select format('extension %s, %s scheduled jobs', extversion, (select count(*) from timescaledb_information.jobs where scheduled)) from pg_extension where extname = 'timescaledb'")"
