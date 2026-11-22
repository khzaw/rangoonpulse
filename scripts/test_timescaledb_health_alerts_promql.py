#!/usr/bin/env python3
"""Exercise the tracearr TimescaleDB health-check alerts with promtool."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import yaml


ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "infrastructure/monitoring/prometheusrule-cronjob-deadman.yaml"
CRONJOB = "tracearr-timescaledb-health"
UNHEALTHY = "HomelabCronJobTracearrTimescaleUnhealthy"
STALE = "HomelabCronJobStale"
LABELS = {"namespace": "default", "cronjob": CRONJOB}


def series(name, values):
    labels = {"job": "kube-state-metrics", **LABELS}
    selector = ",".join(f"{key}={json.dumps(value)}" for key, value in labels.items())
    return {"series": f"{name}{{{selector}}}", "values": values}


def cronjob(schedule, success=None, suspend="0x400"):
    """Unix-second timestamps as kube-state-metrics reports them; `_` means not reported yet."""
    inputs = [
        series("kube_cronjob_created", "0x400"),
        series("kube_cronjob_spec_suspend", suspend),
        series("kube_cronjob_status_last_schedule_time", schedule),
    ]
    if success is not None:
        inputs.append(series("kube_cronjob_status_last_successful_time", success))
    return inputs


def rules():
    """Only the rules for this CronJob, so absent() rules for other CronJobs stay out of the way."""
    groups = yaml.safe_load(RULES.read_text())["spec"]["groups"]
    return [{**group, "rules": [rule for rule in group["rules"] if CRONJOB in rule["expr"]]}
            for group in groups]


def expected(alert, group):
    rule = next(r for r in group["rules"] if r["alert"] == alert)
    return {"exp_labels": {**LABELS, **rule["labels"]}, "exp_annotations": rule["annotations"]}


def case(name, inputs, checks):
    return {
        "name": name,
        "interval": "1m",
        "input_series": inputs,
        "alert_rule_test": [{"eval_time": at, "alertname": alert, "exp_alerts": alerts}
                            for at, alert, alerts in checks],
    }


def run(promtool):
    group = rules()[0]
    unhealthy = [expected(UNHEALTHY, group)]
    stale = [expected(STALE, group)]
    hourly = "_x59 3600x59 7200x59 10800x59 14400x59 18000x59"
    tests = [
        case("hourly successes never alert", cronjob(hourly, "_x60 3630x59 7230x59 10830x59 14430x59 18030x59"), [
            (at, alert, []) for at in ("65m", "125m", "300m") for alert in (UNHEALTHY, STALE)
        ]),
        case("a failed latest run alerts after ten minutes", cronjob(hourly, "_x60 3630x300"), [
            ("128m", UNHEALTHY, []),
            ("135m", UNHEALTHY, unhealthy),
        ]),
        case("a failed first run alerts without any prior success", cronjob(hourly), [
            ("68m", UNHEALTHY, []),
            ("75m", UNHEALTHY, unhealthy),
        ]),
        case("the next successful run clears the alert",
             cronjob(hourly, "_x60 3630x119 10830x59 14430x59 18030x59"), [
                 ("135m", UNHEALTHY, unhealthy),
                 ("185m", UNHEALTHY, []),
             ]),
        case("a failing check that still runs does not also page as stale", cronjob(hourly, "_x60 3630x300"), [
            ("300m", STALE, []),
        ]),
        case("a check that stops being scheduled pages as stale", cronjob("_x59 3600x340", "_x60 3630x340"), [
            ("254m", STALE, []),
            ("260m", STALE, stale),
        ]),
        case("a suspended check does not page as stale",
             cronjob("_x59 3600x340", "_x60 3630x340", suspend="1x400"), [
                 ("260m", STALE, []),
             ]),
    ]
    with tempfile.TemporaryDirectory(prefix="timescaledb-health-alert-tests-") as directory:
        folder = Path(directory)
        (folder / "rules.yaml").write_text(yaml.safe_dump({"groups": rules()}))
        path = folder / "tests.yaml"
        path.write_text(yaml.safe_dump({
            "rule_files": ["rules.yaml"], "evaluation_interval": "1m", "tests": tests,
        }))
        subprocess.run([promtool, "check", "rules", str(folder / "rules.yaml")], check=True)
        subprocess.run([promtool, "test", "rules", str(path)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promtool", default="promtool")
    run(parser.parse_args().promtool)
