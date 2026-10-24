#!/usr/bin/env python3
"""Test generated tariff PromQL at real quarter boundaries with promtool.

Requires PyYAML and promtool on PATH (or --promtool /path/to/promtool).
The test clock is shifted, not the effective-date constants, to avoid simulating
56 years of rule evaluations from Prometheus's epoch-zero test clock.
"""

import argparse
import copy
import json
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

import yaml

from update_power_tariff import DATA, ROOT, RULES, epoch


def run(promtool: str) -> None:
    spec = yaml.safe_load(RULES.read_text())["spec"]
    subprocess.run([promtool, "check", "rules", "/dev/stdin"],
                   input=yaml.safe_dump(spec), text=True, check=True)
    entries = json.loads(DATA.read_text())
    tariff = "homelab:singapore_household_tariff_sgd_per_kwh"
    cost = "homelab:node_estimated_cost_sgd_per_hour"
    expiry = "homelab:singapore_household_tariff_valid_until_seconds"
    selected = [rule for rule in spec["groups"][0]["rules"]
                if rule.get("record") in {tariff, cost, expiry}
                or rule.get("alert") == "SingaporePowerTariffStale"]
    for index in range(1, len(entries)):
        previous, current = entries[index - 1:index + 1]
        base = epoch(current["start"]) - 120
        rules = copy.deepcopy(selected)
        for rule in rules:
            rule["expr"] = rule["expr"].replace("time()", f"(time() + {base})")
        sample_cost = (float(previous["sgd_per_kwh"]) + float(current["sgd_per_kwh"])) * .1 * 120 / 3600
        tests = [{
            "interval": "2m",
            "input_series": [{"series": 'homelab:node_estimated_power_watts{node="test"}', "values": "100+0x40"}],
            "promql_expr_test": [
                {"expr": tariff, "eval_time": "0m", "exp_samples": [{"labels": tariff, "value": float(previous["sgd_per_kwh"])}]},
                {"expr": tariff, "eval_time": "2m", "exp_samples": [{"labels": tariff, "value": float(current["sgd_per_kwh"])}]},
                {"expr": f"sum(sum_over_time({cost}[4m])) * 120 / 3600", "eval_time": "2m", "exp_samples": [{"labels": "{}", "value": sample_cost}]},
            ],
        }]
        check_case(promtool, rules, tests)
    last = entries[-1]
    end = (date.fromisoformat(last["end"]) + timedelta(days=1)).isoformat()
    base = epoch(end) - 120
    rules = copy.deepcopy(selected)
    for rule in rules:
        rule["expr"] = rule["expr"].replace("time()", f"(time() + {base})")
    check_case(promtool, rules, [{
        "interval": "2m",
        "promql_expr_test": [
            {"expr": tariff, "eval_time": "62m", "exp_samples": [{"labels": tariff, "value": float(last["sgd_per_kwh"])}]},
        ],
        "alert_rule_test": [
            {"eval_time": "0m", "alertname": "SingaporePowerTariffStale", "exp_alerts": []},
            {"eval_time": "62m", "alertname": "SingaporePowerTariffStale", "exp_alerts": [{
                "exp_labels": {"severity": "warning"},
                "exp_annotations": next(r["annotations"] for r in rules if r.get("alert") == "SingaporePowerTariffStale"),
            }]},
        ],
    }])


def check_case(promtool: str, rules: list, tests: list) -> None:
    with tempfile.TemporaryDirectory(prefix="power-tariff-") as directory:
        folder = Path(directory)
        (folder / "rules.yaml").write_text(yaml.safe_dump({"groups": [{"name": "tariff-test", "interval": "2m", "rules": rules}]}))
        path = folder / "tests.yaml"
        path.write_text(yaml.safe_dump({"rule_files": ["rules.yaml"], "evaluation_interval": "2m", "tests": tests}))
        subprocess.run([promtool, "test", "rules", str(path)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promtool", default="promtool")
    run(parser.parse_args().promtool)
