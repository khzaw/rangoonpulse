\set ON_ERROR_STOP on
\getenv snapshot_token POWER_LEDGER_SNAPSHOT_TOKEN
\pset format unaligned
\pset tuples_only on
\o /tmp/ledger-snapshot.json
SELECT jsonb_build_object(
  'token', :'snapshot_token',
  'recordedAt', now(),
  'months', coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(month, 'YYYY-MM'),
    'costSgd', cost_sgd,
    'observedSamples', observed_samples,
    'expectedSamples', expected_samples,
    'collectedUntil', collected_until
  ) ORDER BY month), '[]'::jsonb)
) FROM power_estimation.monthly_cost;
\o
