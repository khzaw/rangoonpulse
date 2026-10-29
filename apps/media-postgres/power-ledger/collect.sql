\set ON_ERROR_STOP on
\getenv cutoff POWER_LEDGER_CUTOFF
\getenv expected_nodes POWER_LEDGER_EXPECTED_NODES
\getenv iris_start POWER_LEDGER_IRIS_START_SECONDS
\getenv nas_start POWER_LEDGER_TRUENAS_START_SECONDS
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL work_mem = '1MB';
-- The checkpoint and additions commit together; retries and concurrent jobs cannot double count.
SELECT pg_advisory_xact_lock(1886353266, 1);
CREATE TEMP TABLE source (body jsonb) ON COMMIT DROP;
-- Control characters cannot occur unescaped in JSON. CSV avoids COPY text unescaping JSON.
\copy source FROM '/tmp/power-samples.json' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
DO $ledger$
BEGIN
  IF (SELECT count(*) FROM source) <> 1 OR EXISTS (
    SELECT 1 FROM source WHERE body->>'status' IS DISTINCT FROM 'success'
      OR body#>>'{data,resultType}' IS DISTINCT FROM 'matrix'
      OR jsonb_typeof(body#>'{data,result}') IS DISTINCT FROM 'array'
      OR jsonb_array_length(coalesce(body->'warnings', '[]'::jsonb)) > 0
  ) THEN
    RAISE EXCEPTION 'Prometheus did not return one complete successful matrix response';
  END IF;
END $ledger$;
CREATE TEMP TABLE samples ON COMMIT DROP AS
SELECT series->'metric'->>'node' AS node,
       (sample->>0)::numeric AS ts,
       (sample->>1)::numeric AS cost_per_hour
FROM source,
     LATERAL jsonb_array_elements(body#>'{data,result}') series,
     LATERAL jsonb_array_elements(series->'values') sample
WHERE sample->>1 ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'
  -- Enrollment never backfills Iris into previously cluster-only accounting.
  AND (series->'metric'->>'node' IS DISTINCT FROM 'iris'
       OR (sample->>0)::numeric >= :'iris_start'::numeric)
  AND (series->'metric'->>'node' IS DISTINCT FROM 'truenas'
       OR (sample->>0)::numeric >= :'nas_start'::numeric);
-- NaN/missing observations count as missing coverage, never zero-valued observations.
CREATE UNIQUE INDEX ON samples (node, ts);
CREATE TEMP TABLE context ON COMMIT DROP AS
SELECT to_timestamp(:'cutoff'::double precision) AS cutoff,
       coalesce(
         (SELECT max(collected_until) FROM power_estimation.monthly_cost),
         to_timestamp(floor((SELECT min(ts) FROM samples) / 120)::double precision * 120)
       ) AS cursor,
       :'expected_nodes'::integer AS expected_nodes,
       to_timestamp(:'iris_start'::double precision) AS iris_since,
       to_timestamp(:'nas_start'::double precision) AS nas_since;
DO $ledger$
BEGIN
  IF EXISTS (SELECT 1 FROM context WHERE cursor IS NULL OR expected_nodes NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Cannot initialize without recorded samples and a valid node count';
  END IF;
  IF EXISTS (SELECT 1 FROM context WHERE iris_since IS NULL OR extract(epoch FROM iris_since) % 120 <> 0) THEN
    RAISE EXCEPTION 'Iris enrollment must align to the 2-minute recording interval';
  END IF;
  IF EXISTS (SELECT 1 FROM context WHERE nas_since IS NULL OR extract(epoch FROM nas_since) % 120 <> 0) THEN
    RAISE EXCEPTION 'TrueNAS enrollment must align to the 2-minute recording interval';
  END IF;
  IF EXISTS (SELECT 1 FROM samples WHERE cost_per_hour < 0) THEN
    RAISE EXCEPTION 'Negative cost samples';
  END IF;
END $ledger$;
WITH months AS (
  SELECT m::date AS month,
         greatest(c.cursor, m AT TIME ZONE 'Asia/Singapore') AS segment_start,
         least(c.cutoff, (m + interval '1 month') AT TIME ZONE 'Asia/Singapore') AS segment_end,
         -- The first partial month includes the unrecorded prefix for existing nodes.
         CASE WHEN EXISTS (SELECT 1 FROM power_estimation.monthly_cost old WHERE old.month = m::date)
           THEN greatest(c.cursor, m AT TIME ZONE 'Asia/Singapore')
           ELSE m AT TIME ZONE 'Asia/Singapore'
         END AS coverage_start,
         c.expected_nodes, c.iris_since, c.nas_since
  FROM context c,
       LATERAL generate_series(
         date_trunc('month', c.cursor AT TIME ZONE 'Asia/Singapore'),
         date_trunc('month', c.cutoff AT TIME ZONE 'Asia/Singapore'), interval '1 month'
       ) m
), additions AS (
  SELECT m.month, m.segment_end,
         coalesce(sum(s.cost_per_hour) * 120 / 3600, 0) AS cost_sgd,
         count(s.ts) AS observed_samples,
         -- Existing nodes keep their historical expectation; Iris starts at enrollment.
         round(extract(epoch FROM (m.segment_end - m.coverage_start)) / 120 * m.expected_nodes
           + greatest(extract(epoch FROM (m.segment_end - greatest(m.coverage_start, m.iris_since))), 0) / 120
           + greatest(extract(epoch FROM (m.segment_end - greatest(m.coverage_start, m.nas_since))), 0) / 120
         )::bigint AS expected_samples
  FROM months m
  LEFT JOIN samples s ON s.ts >= extract(epoch FROM m.segment_start)
                     AND s.ts < extract(epoch FROM m.segment_end)
  WHERE m.segment_end > m.segment_start
  GROUP BY m.month, m.segment_start, m.segment_end, m.coverage_start, m.expected_nodes, m.iris_since, m.nas_since
)
INSERT INTO power_estimation.monthly_cost
  (month, cost_sgd, observed_samples, expected_samples, collected_until)
SELECT month, cost_sgd, observed_samples, expected_samples, segment_end FROM additions
ON CONFLICT (month) DO UPDATE SET
  cost_sgd = power_estimation.monthly_cost.cost_sgd + EXCLUDED.cost_sgd,
  observed_samples = power_estimation.monthly_cost.observed_samples + EXCLUDED.observed_samples,
  expected_samples = power_estimation.monthly_cost.expected_samples + EXCLUDED.expected_samples,
  collected_until = EXCLUDED.collected_until,
  updated_at = now();
COMMIT;
SELECT month, cost_sgd, collected_until,
       round(100.0 * observed_samples / nullif(expected_samples, 0), 2) AS coverage_percent
FROM power_estimation.monthly_cost ORDER BY month DESC LIMIT 2;
