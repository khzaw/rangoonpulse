#!/usr/bin/env python3
"""Exercise external Iris power, enrollment, scrape loss, and cluster/homelab scope."""

import argparse
import copy
import json
import subprocess

import yaml

from test_power_tariff_promql import check_case
from update_power_tariff import DATA, ROOT, RULES, epoch


def run(promtool: str) -> None:
    settings = yaml.safe_load((ROOT / "flux/cluster-settings.yaml").read_text())["data"]
    # Kustomize removes redundant source quotes before Flux substitutes values.
    # Reproduce that ordering and verify Kubernetes env fields stay strings.
    substitutions = settings | yaml.safe_load((ROOT / "flux/kustomizations/media-postgres.yaml").read_text())["spec"]["postBuild"].get("substitute", {})
    rendered = subprocess.check_output(["kubectl", "kustomize", "apps/media-postgres"], cwd=ROOT, text=True)
    for name, value in substitutions.items():
        rendered = rendered.replace("${" + name + "}", str(value))
    cronjob = next(obj for obj in yaml.safe_load_all(rendered) if obj.get("kind") == "CronJob" and obj["metadata"]["name"] == "power-cost-ledger")
    env = cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]["env"]
    assert all(isinstance(item["value"], str) for item in env if "value" in item), "Rendered environment values must remain strings"
    assert next(item["value"] for item in env if item["name"] == "POWER_LEDGER_IRIS_START_SECONDS") == str(settings["IRIS_POWER_COST_START_SECONDS"])
    entries = json.loads(DATA.read_text())
    base = epoch(entries[-1]["start"])
    tariff = float(entries[-1]["sgd_per_kwh"])
    settings["IRIS_POWER_COST_START_SECONDS"] = str(base)
    source = RULES.read_text()
    for name, value in settings.items():
        source = source.replace("${" + name + "}", str(value))
    rules = yaml.safe_load(source)["spec"]["groups"][0]["rules"]
    for rule in rules:
        rule["expr"] = rule["expr"].replace("time()", f"(time() + {base})")

    cluster_inputs = [
        {"series": f'kube_node_info{{node="{node}"}}', "values": "1+0x12"}
        for node in (settings["PRIMARY_NODE_NAME"], settings["UTILITY_NODE_NAME"])
    ] + [
        {"series": f'homelab:node_host_cpu_utilization:ratio{{node="{node}"}}', "values": f"{ratio}+0x12"}
        for node, ratio in ((settings["PRIMARY_NODE_NAME"], .2), (settings["UTILITY_NODE_NAME"], .5))
    ]

    def query(expr: str, samples: list, at: str = "6m") -> dict:
        return {"expr": expr, "eval_time": at, "exp_samples": samples}

    def sample(metric: str, value: float, iris: bool = True) -> list:
        return [{"labels": metric + ('{node="iris"}' if iris else ""), "value": value}]

    def iris_inputs(idle: int = 45, up: str = "1+0x12") -> list:
        return [{
            "series": f'node_cpu_seconds_total{{job="iris-node",host="iris",instance="mac:9100",cpu="{cpu}",mode="idle"}}',
            "values": f"0+{idle}x12",
        } for cpu in (0, 1)] + [{
            "series": 'up{job="iris-node",host="iris",instance="mac:9100"}', "values": up,
        }]

    tests = []
    for idle, ratio, watts in ((45, .25, 19.25), (60, 0, 4), (0, 1, 65), (90, 0, 4)):
        tests.append({
            "interval": "1m", "input_series": cluster_inputs + iris_inputs(idle),
            "promql_expr_test": [
                query("homelab:iris_cpu_utilization:ratio", sample("homelab:iris_cpu_utilization:ratio", ratio)),
                query('homelab:node_estimated_power_watts{node="iris"}', sample("homelab:node_estimated_power_watts", watts)),
                query("homelab:cluster_estimated_power_watts", sample("homelab:cluster_estimated_power_watts", 39, False)),
                query("homelab:estimated_power_watts", sample("homelab:estimated_power_watts", 39 + watts, False)),
                query('homelab:node_estimated_cost_sgd_per_hour{node="iris"}', sample("homelab:node_estimated_cost_sgd_per_hour", watts / 1000 * tariff)),
            ],
        })
    for inputs, at in ((iris_inputs(up="1+0x4 0+0x7"), "6m"), ([], "6m"), (iris_inputs(), "0m")):
        tests.append({
            "interval": "1m", "input_series": cluster_inputs + inputs,
            "promql_expr_test": [
                query('homelab:node_estimated_power_watts{node="iris"}', [], at),
                query('homelab:node_estimated_cost_sgd_per_hour{node="iris"}', [], at),
                query("homelab:estimated_power_watts", sample("homelab:estimated_power_watts", 39, False), at),
            ],
        })
    check_case(promtool, rules, tests)
    enrolled = copy.deepcopy(rules)
    iris_rule = next(rule for rule in enrolled if rule.get("record") == "homelab:iris_cpu_utilization:ratio")
    iris_rule["expr"] = iris_rule["expr"].replace(f">= {base}", f">= {base + 600}")
    check_case(promtool, enrolled, [{
        "interval": "1m", "input_series": cluster_inputs + iris_inputs(),
        "promql_expr_test": [
            query('homelab:node_estimated_power_watts{node="iris"}', [], "6m"),
            query('homelab:node_estimated_power_watts{node="iris"}', sample("homelab:node_estimated_power_watts", 19.25), "10m"),
            # One recorded sample, not an extrapolated hour of pre-enrollment energy/cost.
            query('sum(sum_over_time(homelab:node_estimated_power_watts{node="iris"}[1h])) * 120 / 3600000', sample("{}", 19.25 * 120 / 3600000, False), "10m"),
            query('sum(sum_over_time(homelab:node_estimated_cost_sgd_per_hour{node="iris"}[1h])) * 120 / 3600', sample("{}", 19.25 / 1000 * tariff * 120 / 3600, False), "10m"),
        ],
    }])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promtool", default="promtool")
    run(parser.parse_args().promtool)
