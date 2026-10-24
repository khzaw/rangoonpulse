\set ON_ERROR_STOP on
\set ECHO none
\getenv writer_password POWER_LEDGER_WRITER_PASSWORD
\getenv reader_password POWER_LEDGER_READER_PASSWORD
BEGIN;
SELECT pg_advisory_xact_lock(1886353266, 2);
SELECT 'CREATE ROLE power_ledger_writer LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'power_ledger_writer')
\gexec
SELECT 'CREATE ROLE power_ledger_reader LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'power_ledger_reader')
\gexec
ALTER ROLE power_ledger_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD :'writer_password';
ALTER ROLE power_ledger_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD :'reader_password';
ALTER ROLE power_ledger_writer SET statement_timeout = '60s';
ALTER ROLE power_ledger_reader SET statement_timeout = '15s';
CREATE SCHEMA IF NOT EXISTS power_estimation;
REVOKE ALL ON SCHEMA power_estimation FROM PUBLIC;
CREATE TABLE IF NOT EXISTS power_estimation.monthly_cost (
  month date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  cost_sgd numeric(20,10) NOT NULL CHECK (cost_sgd >= 0),
  observed_samples bigint NOT NULL CHECK (observed_samples >= 0),
  expected_samples bigint NOT NULL CHECK (expected_samples >= observed_samples),
  collected_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (collected_until >= month::timestamp AT TIME ZONE 'Asia/Singapore'),
  CHECK (collected_until <= (month::timestamp + interval '1 month') AT TIME ZONE 'Asia/Singapore')
);
REVOKE ALL ON power_estimation.monthly_cost FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO power_ledger_writer, power_ledger_reader;
GRANT USAGE ON SCHEMA power_estimation TO power_ledger_writer, power_ledger_reader;
GRANT SELECT, INSERT, UPDATE ON power_estimation.monthly_cost TO power_ledger_writer;
GRANT SELECT ON power_estimation.monthly_cost TO power_ledger_reader;
COMMIT;
