#!/usr/bin/env python3
"""Exercise ledger SQL against PostgreSQL; all test objects roll back.

Example: --psql-command 'docker exec -i power-ledger-test psql -U postgres'
Or use kubectl exec -i into the existing PostgreSQL pod. No application table is touched.
"""

import argparse
import json
import shlex
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CODE = ROOT / "apps/media-postgres/power-ledger"


def stamp(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp())


def payload(points: list[tuple[str, str]]) -> dict:
    return {"status": "success", "data": {"resultType": "matrix", "result": [
        {"metric": {"node": node}, "values": [[stamp(at), value] for at, value in points]}
        for node in ("primary", "utility")
    ]}}


def run(command: list[str]) -> None:
    schema = "power_ledger_test_" + uuid.uuid4().hex[:12]
    bootstrap = (CODE / "bootstrap.sql").read_text()
    ddl = bootstrap[bootstrap.index("CREATE SCHEMA IF NOT EXISTS"):bootstrap.index("REVOKE ALL ON power_estimation.monthly_cost")]
    ddl = ddl.replace("power_estimation", schema)
    collect = (CODE / "collect.sql").read_text().replace("power_estimation", schema)

    def collect_case(cutoff: str, body: dict) -> str:
        sql = collect.replace("\\getenv cutoff POWER_LEDGER_CUTOFF", f"\\set cutoff {stamp(cutoff)}")
        sql = sql.replace("\\getenv expected_nodes POWER_LEDGER_EXPECTED_NODES", "\\set expected_nodes 2")
        sql = sql.replace("BEGIN;", "").replace("COMMIT;", "")
        copy_line = next(line for line in sql.splitlines() if line.startswith("\\copy"))
        sql = sql.replace(copy_line, copy_line.replace("'/tmp/power-samples.json'", "stdin") + "\n" + json.dumps(body) + "\n\\.")
        return "DROP TABLE IF EXISTS pg_temp.source, pg_temp.samples, pg_temp.context;\n" + sql

    def assertion(condition: str, message: str) -> str:
        return f"DO $$ BEGIN IF NOT ({condition}) THEN RAISE EXCEPTION '{message}'; END IF; END $$;\n"

    points = [("2026-10-31T23:58:00+08:00", "0.03"), ("2026-11-01T00:00:00+08:00", "0.03")]
    first = collect_case("2026-11-01T00:04:00+08:00", payload(points))
    assert_first = assertion(f"SELECT count(*) = 2 AND sum(cost_sgd) = 0.004 FROM {schema}.monthly_cost", "Month split or initial sum failed")
    second_points = points + [("2026-11-01T00:04:00+08:00", "0.06"), ("2026-11-01T00:06:00+08:00", "999")]
    second = collect_case("2026-11-01T00:06:00+08:00", payload(second_points))
    assert_second = assertion(f"SELECT cost_sgd = 0.006 AND observed_samples = 4 AND expected_samples = 6 FROM {schema}.monthly_cost WHERE month = '2026-11-01'", "Increment, exclusive cutoff or coverage failed")
    # Simulate an outage longer than retention: no old samples available, but totals survive.
    later = collect_case("2026-12-01T00:02:00+08:00", payload([]))
    assert_later = assertion(f"SELECT cost_sgd = 0.006 AND collected_until = '2026-12-01T00:00:00+08:00'::timestamptz AND observed_samples < expected_samples FROM {schema}.monthly_cost WHERE month = '2026-11-01'", "Gap recovery changed saved totals or failed finalization")
    script = ("\\set ON_ERROR_STOP on\nBEGIN;\n" + ddl + first + assert_first + first + assert_first + second + assert_second + second + assert_second + later + assert_later + "ROLLBACK;\n")
    result = subprocess.run(command, input=script, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    print("PASS: month split, retry idempotency, checkpoint advance, zero/missing coverage, retention gap, finalization")
    for name, body in [
        ("empty initialization", payload([])),
        ("API error", {"status": "error", "error": "unavailable"}),
        ("partial API result", dict(payload(points), warnings=["partial response"])),
        ("duplicate samples", payload(points + points)),
    ]:
        result = subprocess.run(command, input="\\set ON_ERROR_STOP on\nBEGIN;\n" + ddl + collect_case("2026-11-01T00:04:00+08:00", body) + "ROLLBACK;\n", text=True, capture_output=True)
        if not result.returncode:
            raise AssertionError(f"Expected rejection: {name}")
        print(f"PASS: rejects {name} without committing any ledger state")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--psql-command", default="psql -X -U postgres -d postgres")
    run(shlex.split(parser.parse_args().psql_command))
