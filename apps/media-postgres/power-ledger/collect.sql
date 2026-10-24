\set ON_ERROR_STOP on
\getenv cutoff POWER_LEDGER_CUTOFF
\getenv expected_nodes POWER_LEDGER_EXPECTED_NODES
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';
SET LOCAL work_mem = '1MB';
-- The checkpoint and additions commit together; retries and concurrent jobs cannot double count.
SELECT pg_advisory_xact_lock(1886353266, 1);
CREATE TEMP TABLE source (body jsonb) ON COMMIT DROP;
-- Control characters cannot occur unescaped in JSON. CSV avoids COPY text unescaping JSON.
\copy source FROM '/tmp/power-samples.json' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
DO $$
BEGIN
  IF (SELECT count(*) FROM source) <> 1 OR EXISTS (
    SELECT 1 FROM source WHERE body->>'status' IS DISTINCT FROM 'success'
      OR body#>>'{data,resultType}' IS DISTINCT FROM 'matrix'
      OR jsonb_typeof(body#>'{data,result}') IS DISTINCT FROM 'array'
      OR jsonb_array_length(coalesce(body->'warnings', '[]'::jsonb)) > 0
  ) THEN
    RAISE EXCEPTION 'Prometheus did not return one complete successful matrix response';
  END IF;
END $$;
CREATE TEMP TABLE samples ON COMMIT DROP AS
SELECT series->'metric'->>'node' AS node,
       (sample->>0)::numeric AS ts,
       (sample->>1)::numeric AS cost_per_hour
FROM source,
     LATERAL jsonb_array_elements(body#>'{data,result}') series,
     LATERAL jsonb_array_elements(series->'values') sample
WHERE sample->>1 ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$';
-- NaN/missing observations count as missing coverage, never zero-valued observations.
CREATE UNIQUE INDEX ON samples (node, ts);
CREATE TEMP TABLE context ON COMMIT DROP AS
SELECT to_timestamp(:'cutoff'::double precision) AS cutoff,
       coalesce(
         (SELECT max(collected_until) FROM power_estimation.monthly_cost),
         to_timestamp(floor((SELECT min(ts) FROM samples) / 120)::double precision * 120)
       ) AS cursor,
       :'expected_nodes'::integer AS expected_nodes;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM context WHERE cursor IS NULL OR expected_nodes NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Cannot initialize without recorded samples and a valid node count';
  END IF;
  IF EXISTS (SELECT 1 FROM samples WHERE cost_per_hour < 0) THEN
    RAISE EXCEPTION 'Negative cost samples';
  END IF;
END $$;
WITH months AS (
  SELECT m::date AS month,
         greatest(c.cursor, m AT TIME ZONE 'Asia/Singapore') AS segment_start,
         least(c.cutoff, (m + interval '1 month') AT TIME ZONE 'Asia/Singapore') AS segment_end,
         c.expected_nodes
  FROM context c,
       LATERAL generate_series(
         date_trunc('month', c.cursor AT TIME ZONE 'Asia/Singapore'),
         date_trunc('month', c.cutoff AT TIME ZONE 'Asia/Singapore'), interval '1 month'
       ) m
), additions AS (
  SELECT m.month, m.segment_end,
         coalesce(sum(s.cost_per_hour) * 120 / 3600, 0) AS cost_sgd,
         count(s.ts) AS observed_samples,
         -- A newly initialized partial month includes its missing prefix in coverage.
         round(extract(epoch FROM (m.segment_end - CASE
           WHEN EXISTS (SELECT 1 FROM power_estimation.monthly_cost old WHERE old.month = m.month)
             THEN m.segment_start
           ELSE m.month::timestamp AT TIME ZONE 'Asia/Singapore'
         END)) / 120 * m.expected_nodes)::bigint AS expected_samples
  FROM months m
  LEFT JOIN samples s ON s.ts >= extract(epoch FROM m.segment_start)
                     AND s.ts < extract(epoch FROM m.segment_end)
  WHERE m.segment_end > m.segment_start
  GROUP BY m.month, m.segment_start, m.segment_end, m.expected_nodes
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
