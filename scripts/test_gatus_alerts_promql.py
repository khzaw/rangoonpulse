#!/usr/bin/env python3
"""Exercise the Gatus 60s-tier endpoint and deadman alerts with promtool."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

import yaml


ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "infrastructure/monitoring/prometheusrule-gatus.yaml"
FAILING = "GatusEndpointFailing"
STALE = "GatusResultsStale"
ABSENT = "GatusMetricsAbsent"
ALERTS = (FAILING, STALE, ABSENT)
VALKEY = dict(key="data-services_immich-valkey", group="Data services", name="Immich Valkey", type="TCP")
POSTGRES = dict(key="data-services_shared-postgresql", group="Data services", name="Shared PostgreSQL", type="TCP")
GRAFANA = dict(key="infrastructure_grafana", group="Infrastructure", name="Grafana", type="HTTP")
OLD_POD = dict(pod="gatus-old", instance="10.244.1.10:8080")
NEW_POD = dict(pod="gatus-new", instance="10.244.1.11:8080")


def series(name, labels, values):
    selector = ",".join(f"{key}={json.dumps(value)}" for key, value in labels.items())
    return {"series": f"{name}{{{selector}}}", "values": values}


def gatus(endpoint, success, results, pod=OLD_POD, tier="60s"):
    """Scraped success gauge and result counter for one endpoint; one sample per minute."""
    labels = dict(job="gatus", namespace="default", service="gatus", endpoint="http", **pod, **endpoint)
    if tier:
        labels["tier"] = tier
    return [
        series("gatus_results_endpoint_success", labels, success),
        series("gatus_results_total", {**labels, "success": "true"}, results),
    ]


def rules():
    return yaml.safe_load(RULES.read_text())["spec"]["groups"]


def expected(alert, labels):
    rule = next(r for g in rules() for r in g["rules"] if r.get("alert") == alert)

    def render(text):
        return re.sub(r"{{ \$labels\.(\w+) }}", lambda m: labels[m.group(1)], text)

    return {
        "exp_labels": {**labels, **rule["labels"]},
        "exp_annotations": {key: render(text) for key, text in rule["annotations"].items()},
    }


def failing(endpoint):
    return expected(FAILING, dict(key=endpoint["key"], group=endpoint["group"],
                                  type=endpoint["type"], gatus_endpoint=endpoint["name"]))


def stale(endpoint):
    return expected(STALE, dict(key=endpoint["key"], gatus_endpoint=endpoint["name"]))


def case(name, inputs, checks):
    return {
        "name": name,
        "interval": "1m",
        "input_series": inputs,
        "alert_rule_test": [{"eval_time": at, "alertname": alert, "exp_alerts": alerts}
                            for at, alert, alerts in checks],
    }


def quiet(*times):
    return [(at, alert, []) for at in times for alert in ALERTS]


def run(promtool):
    counting = "0+1x60"
    tests = [
        case("healthy checks never alert", gatus(VALKEY, "1x60", counting), quiet("5m", "20m", "60m")),
        case("a single failed scrape does not alert", gatus(VALKEY, "1x9 0 1x50", counting),
             quiet("10m", "11m", "12m", "13m", "15m")),
        case("three consecutive failed scrapes do not alert", gatus(VALKEY, "1x9 0x2 1x48", counting),
             quiet("12m", "13m", "14m", "20m")),
        case("four consecutive failed scrapes alert per endpoint",
             gatus(VALKEY, "1x9 0x50", counting) + gatus(POSTGRES, "1x9 0x50", counting), [
                 ("12m", FAILING, []),
                 ("13m", FAILING, [failing(VALKEY), failing(POSTGRES)]),
                 ("30m", FAILING, [failing(VALKEY), failing(POSTGRES)]),
                 ("30m", STALE, []),
                 ("30m", ABSENT, []),
             ]),
        case("the first successful scrape clears the alert", gatus(VALKEY, "1x9 0x10 1x40", counting), [
            ("20m", FAILING, [failing(VALKEY)]),
            ("21m", FAILING, []),
        ]),
        case("checks outside the 60s tier never alert",
             gatus(VALKEY, "1x60", counting) + gatus(GRAFANA, "0x60", counting, tier=None),
             quiet("10m", "30m")),
        case("a failed first result after a Gatus restart does not alert",
             gatus(VALKEY, "1x9 stale", "0+1x9 stale")
             + gatus(VALKEY, "_x10 0 1x40", "_x10 1+1x40", pod=NEW_POD),
             quiet("11m", "12m", "13m", "14m", "20m")),
        case("an outage that spans a Gatus restart keeps alerting",
             gatus(VALKEY, "1x4 0x5 stale", "0+1x10 stale")
             + gatus(VALKEY, "_x11 0x40", "_x11 1+1x40", pod=NEW_POD), [
                 ("7m", FAILING, []),
                 ("8m", FAILING, [failing(VALKEY)]),
                 ("10m", FAILING, [failing(VALKEY)]),
                 ("11m", FAILING, [failing(VALKEY)]),
                 ("12m", FAILING, [failing(VALKEY)]),
                 ("20m", FAILING, [failing(VALKEY)]),
             ]),
        case("results that stop advancing alert as stale after about 15m",
             gatus(VALKEY, "1x60", "0+1x20 20x40"), [
                 ("33m", STALE, []),
                 ("34m", STALE, [stale(VALKEY)]),
                 ("34m", FAILING, []),
                 ("34m", ABSENT, []),
             ]),
        case("a Gatus scrape outage alerts as absent after 15m, not as failing or stale",
             gatus(VALKEY, "1x10 stale", "0+1x10 stale") + [series("up", dict(job="gatus"), "1x10 0x50")], [
                 ("25m", ABSENT, []),
                 ("26m", ABSENT, [expected(ABSENT, {"tier": "60s"})]),
                 ("26m", FAILING, []),
                 ("26m", STALE, []),
             ]),
        case("metrics without the tier label alert as absent",
             gatus(VALKEY, "1x60", counting, tier=None), [
                 ("14m", ABSENT, []),
                 ("15m", ABSENT, [expected(ABSENT, {"tier": "60s"})]),
             ]),
    ]
    with tempfile.TemporaryDirectory(prefix="gatus-alert-tests-") as directory:
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
