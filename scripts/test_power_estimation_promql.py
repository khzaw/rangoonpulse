#!/usr/bin/env python3
"""Exercise Iris sensor validation, normalization, enrollment, totals and alerts."""

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import yaml

from test_power_tariff_promql import check_case
from update_power_tariff import DATA, ROOT, RULES, epoch


IRIS_RULES = ROOT / "infrastructure/monitoring/prometheusrule-iris.yaml"
SENSOR = "homelab:iris_system_power_watts"
POWER = "homelab:node_estimated_power_watts"
COST = "homelab:node_estimated_cost_sgd_per_hour"


def render(path: Path, settings: dict, base: int = 0) -> dict:
    source = path.read_text()
    for name, value in settings.items():
        source = source.replace("${" + name + "}", str(value))
    spec = yaml.safe_load(source)["spec"]
    for group in spec["groups"]:
        for rule in group["rules"]:
            rule["expr"] = rule["expr"].replace("time()", f"(time() + {base})")
    return spec


def query(expr: str, samples: list, at: str = "6m") -> dict:
    return {"expr": expr, "eval_time": at, "exp_samples": samples}


def sample(metric: str, value: float, iris: bool = True) -> list:
    return [{"labels": metric + ('{node="iris"}' if iris else ""), "value": value}]


def run(promtool: str) -> None:
    settings = yaml.safe_load((ROOT / "flux/cluster-settings.yaml").read_text())["data"]
    # Keep the existing enrollment and ledger environment contract. Rendering is
    # local only: this suite never contacts Kubernetes or reads cluster credentials.
    assert str(settings["IRIS_POWER_COST_START_SECONDS"]) == "1793176200"
    substitutions = settings | yaml.safe_load((ROOT / "flux/kustomizations/media-postgres.yaml").read_text())["spec"]["postBuild"].get("substitute", {})
    renderer = ["kustomize", "build"] if shutil.which("kustomize") else ["kubectl", "kustomize"]
    rendered = subprocess.check_output(renderer + ["apps/media-postgres"], cwd=ROOT, text=True)
    for name, value in substitutions.items():
        rendered = rendered.replace("${" + name + "}", str(value))
    cronjob = next(obj for obj in yaml.safe_load_all(rendered) if obj.get("kind") == "CronJob" and obj["metadata"]["name"] == "power-cost-ledger")
    env = cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]["env"]
    assert all(isinstance(item["value"], str) for item in env if "value" in item), "Rendered environment values must remain strings"
    assert next(item["value"] for item in env if item["name"] == "POWER_LEDGER_IRIS_START_SECONDS") == str(settings["IRIS_POWER_COST_START_SECONDS"])

    base = int(settings["IRIS_POWER_COST_START_SECONDS"])
    entries = json.loads(DATA.read_text())
    tariff = float(next(entry for entry in reversed(entries) if epoch(entry["start"]) <= base)["sgd_per_kwh"])
    spec = render(RULES, settings, base)
    assert spec["groups"][0]["interval"] == "2m", "Energy/cost integration assumes 120-second samples"
    rules = spec["groups"][0]["rules"]
    cluster_inputs = [
        {"series": f'kube_node_info{{node="{node}"}}', "values": "1+0x20"}
        for node in (settings["PRIMARY_NODE_NAME"], settings["UTILITY_NODE_NAME"])
    ] + [
        {"series": f'homelab:node_host_cpu_utilization:ratio{{node="{node}"}}', "values": f"{ratio}+0x20"}
        for node, ratio in ((settings["PRIMARY_NODE_NAME"], .2), (settings["UTILITY_NODE_NAME"], .5))
    ]

    def iris_inputs(watts: str | None = "17.5+0x20", timestamp: str | None = "fresh",
                    up: str | None = "1+0x20", idle: int | None = 45,
                    labels: str = 'job="iris-node",host="iris",instance="mac:9100",service="iris-node",endpoint="metrics",namespace="monitoring"',
                    clock: int = base) -> list:
        inputs = []
        if idle is not None:
            inputs.extend({
                "series": f'node_cpu_seconds_total{{{labels},cpu="{cpu}",mode="idle"}}',
                "values": f"0+{idle}x20",
            } for cpu in (0, 1))
        for metric, values in (("up", up), ("iris_system_power_watts", watts),
                               ("iris_power_sample_timestamp_seconds", f"{clock}+60x20" if timestamp == "fresh" else timestamp)):
            if values is not None:
                inputs.append({"series": f"{metric}{{{labels}}}", "values": values})
        return inputs

    def power_queries(watts: float | None, at: str = "6m") -> list:
        return [
            query(SENSOR, [] if watts is None else sample(SENSOR, watts), at),
            query(f'{POWER}{{node="iris"}}', [] if watts is None else sample(POWER, watts), at),
            query(f'{COST}{{node="iris"}}', [] if watts is None else sample(COST, watts / 1000 * tariff), at),
            query("homelab:cluster_estimated_power_watts", sample("homelab:cluster_estimated_power_watts", 39, False), at),
            query("homelab:estimated_power_watts", sample("homelab:estimated_power_watts", 39 + (watts or 0), False), at),
        ]

    tests = []

    def case(name: str, inputs: list, watts: float | None, at: str = "6m", extra: list | None = None) -> None:
        tests.append({"name": name, "interval": "1m", "input_series": cluster_inputs + inputs,
                      "promql_expr_test": power_queries(watts, at) + (extra or [])})

    for idle, ratio in ((45, .25), (60, 0), (0, 1), (90, 0), (None, None)):
        case(f"Exact sensor watts independent of CPU idle={idle}", iris_inputs(idle=idle), 17.5, extra=[
            query("homelab:iris_cpu_utilization:ratio", [] if ratio is None else sample("homelab:iris_cpu_utilization:ratio", ratio)),
            *[query(f'{metric}{{node="iris"}}', []) for metric in (
                "homelab:node_idle_power_watts", "homelab:node_max_power_watts",
                "homelab:node_power_model_cpu_utilization:ratio")],
            query(f'{POWER}{{node="{settings["PRIMARY_NODE_NAME"]}"}}', [{"labels": f'{POWER}{{node="{settings["PRIMARY_NODE_NAME"]}"}}', "value": 31}]),
            query(f'{POWER}{{node="{settings["UTILITY_NODE_NAME"]}"}}', [{"labels": f'{POWER}{{node="{settings["UTILITY_NODE_NAME"]}"}}', "value": 8}]),
        ])
    case("Sensor works immediately without a CPU rate window", iris_inputs(), 17.5, "0m")
    case("Sensor is unsmoothed", iris_inputs(watts="17.5+0x4 29+0x15"), 29)
    for watts in ("NaN", "+Inf", "-Inf", "-5", "0"):
        case(f"Reject {watts} watts without CPU fallback", iris_inputs(watts=f"{watts}+0x20"), None)
    for label, stamp in (("missing", None), ("stale", f"{base - 91}+60x20"),
                         ("future", f"{base + 1}+60x20"), ("NaN", "NaN+0x20"),
                         ("positive infinity", "+Inf+0x20"), ("negative infinity", "-Inf+0x20")):
        case(f"Reject {label} timestamp", iris_inputs(timestamp=stamp), None)
    case("Timestamp age exactly 90 seconds accepted", iris_inputs(timestamp=f"{base - 90}+60x20"), 17.5)
    case("Reject missing sensor despite valid CPU", iris_inputs(watts=None), None)
    case("Reject down exporter", iris_inputs(up="1+0x4 0+0x15"), None)
    case("Reject missing up", iris_inputs(up=None), None)
    case("Reject missing host", [], None)
    for labels in ('job="other",host="iris",instance="mac:9100"',
                   'job="iris-node",host="other",instance="mac:9100"'):
        case("Reject sensor from unrelated job or host " + labels, iris_inputs(labels=labels, idle=None), None)

    duplicate = 'job="iris-node",host="iris",instance="mac:9100",service="duplicate",endpoint="metrics",namespace="monitoring",replica="b"'
    case("Duplicate scrape labels normalize to one node without summing", iris_inputs() + iris_inputs(labels=duplicate, idle=None), 17.5)
    case("Invalid duplicate cannot contaminate accepted value", iris_inputs() + iris_inputs(watts="+Inf+0x20", labels=duplicate, idle=None), 17.5)
    case("Stale duplicate cannot borrow fresh timestamp", iris_inputs() + iris_inputs(watts="99+0x20", timestamp=f"{base - 91}+60x20", labels=duplicate, idle=None), 17.5)
    case("Down duplicate cannot borrow successful up", iris_inputs() + iris_inputs(watts="99+0x20", up="0+0x20", labels=duplicate, idle=None), 17.5)
    case("Complementary invalid duplicates cannot create a valid sample",
         iris_inputs(watts="99+0x20", timestamp=f"{base - 91}+60x20") + iris_inputs(watts=None, labels=duplicate, idle=None), None)

    # Accepted samples at 0m and 2m, rejected at 4m, then 29W at 6m.
    # Missing power/cost must leave a gap, never idle watts or extrapolated energy.
    case("Energy and tariff integration preserve gaps and exact sensor watts",
         iris_inputs(watts="17.5+0x2 0+0x2 29+0x15"), 29, extra=[
             query(f'sum(sum_over_time({POWER}{{node="iris"}}[1h])) * 120 / 3600000', sample("{}", (35 + 29) * 120 / 3600000, False)),
             query(f'sum(sum_over_time({COST}{{node="iris"}}[1h])) * 120 / 3600', sample("{}", (35 + 29) / 1000 * tariff * 120 / 3600, False)),
             query(f'{POWER}{{node="iris"}}', [], "4m"),
             query(f'{COST}{{node="iris"}}', [], "4m"),
         ])
    check_case(promtool, rules, tests)

    # Shift the clock across the ORIGINAL enrollment, never edit that threshold
    # or introduce a second macmon cutover date. Deployment is the forward switch.
    enrolled = render(RULES, settings, base - 600)["groups"][0]["rules"]
    check_case(promtool, enrolled, [{
        "name": "Original enrollment boundary gates sensor watts and cost", "interval": "1m",
        "input_series": cluster_inputs + iris_inputs(clock=base - 600),
        "promql_expr_test": [
            query(f'{POWER}{{node="iris"}}', [], "8m"),
            query(f'{COST}{{node="iris"}}', [], "8m"),
            query(f'{POWER}{{node="iris"}}', sample(POWER, 17.5), "10m"),
            query(f'sum(sum_over_time({POWER}{{node="iris"}}[1h])) * 120 / 3600000', sample("{}", 17.5 * 120 / 3600000, False), "10m"),
            query(f'sum(sum_over_time({COST}{{node="iris"}}[1h])) * 120 / 3600', sample("{}", 17.5 / 1000 * tariff * 120 / 3600, False), "10m"),
        ],
    }])
    check_alerts(promtool, settings)
    check_dashboard_cpu(promtool)


def check_dashboard_cpu(promtool: str) -> None:
    """CPU panels must include Iris without adding it back to power-model inputs."""
    source = (ROOT / "infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml").read_text()
    dashboard = json.loads(yaml.safe_load(source)["data"]["node-power-estimation.json"])
    panels = {panel["id"]: panel for panel in dashboard["panels"]}
    model = "homelab:node_power_model_cpu_utilization:ratio"
    diagnostic = "homelab:iris_cpu_utilization:ratio"
    ratios = {"primary": .2, "utility": .5, "truenas": .1, "iris": .25}
    inputs = [
        {"series": f'{model}{{node="{node}"}}', "values": f"{ratio}+0x10"}
        for node, ratio in ratios.items() if node != "iris"
    ] + [{"series": f'{diagnostic}{{node="iris"}}', "values": ".25+0x10"}]

    def checks(selector: str, expected: dict, at: str = "6m") -> list:
        graph = panels[11]["targets"][0]["expr"].replace("$node", selector)
        stat = panels[9]["targets"][0]["expr"].replace("$node", selector)
        return [
            query(graph, [{"labels": f'{{node="{node}"}}', "value": ratio}
                          for node, ratio in expected.items()], at),
            query(stat, sample("{}", sum(expected.values()) / len(expected), False)
                  if expected else [], at),
        ]

    tests = [{
        "name": "Iris CPU panels stay live after leaving the power model",
        "interval": "1m", "input_series": inputs,
        "promql_expr_test": checks("iris", {"iris": .25}),
    }]
    for selector in (".*", "primary", "truenas"):
        expected = ratios if selector == ".*" else {selector: ratios[selector]}
        tests.append({
            "name": f"CPU selector preserves each host once: {selector}",
            "interval": "1m", "input_series": inputs,
            "promql_expr_test": checks(selector, expected),
        })
    tests.append({
        "name": "Missing Iris CPU remains unavailable rather than zero",
        "interval": "1m", "input_series": inputs[:-1],
        "promql_expr_test": checks("iris", {}),
    })
    tests.append({
        "name": "Historical model to diagnostic crossover keeps one Iris series",
        "interval": "1m", "input_series": inputs[:-1] + [
            {"series": f'{model}{{node="iris"}}', "values": ".25+0x3 stale"},
            {"series": f'{diagnostic}{{node="iris"}}', "values": ".25+0x3 .4+0x6"},
        ],
        "promql_expr_test": checks("iris", {"iris": .25}, "2m")
        + checks("iris", {"iris": .4}, "6m"),
    })
    check_case(promtool, [], tests)
    assert panels[9]["title"] == "Selected Scope CPU Utilization"
    assert panels[11]["title"] == "CPU Utilization by Host"


def check_alerts(promtool: str, settings: dict) -> None:
    # Native fixtures use epoch-zero timestamps. Enrollment is tested above with
    # its real value; only this independent alert fixture clock enrolls at zero.
    power = render(RULES, settings | {"IRIS_POWER_COST_START_SECONDS": "0"})
    alerts = render(IRIS_RULES, settings)
    fixtures = yaml.safe_load((ROOT / "native/iris/alerts.test.yaml").read_text())
    fixtures["group_eval_order"] = [group["name"] for group in power["groups"] + alerts["groups"]]
    with tempfile.TemporaryDirectory(prefix="iris-power-alerts-") as directory:
        folder = Path(directory)
        (folder / "iris-rules.yaml").write_text(yaml.safe_dump({"groups": power["groups"] + alerts["groups"]}))
        path = folder / "alerts.test.yaml"
        path.write_text(yaml.safe_dump(fixtures))
        subprocess.run([promtool, "test", "rules", str(path)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promtool", default="promtool")
    run(parser.parse_args().promtool)
