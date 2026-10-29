"""Test NAS freshness, enrollment, source isolation, accounting and recovery."""

import argparse

import yaml
from test_power_estimation_promql import ROOT, RULES, query, render
from test_power_tariff_promql import check_case

POWER = "homelab:node_estimated_power_watts"
COST = "homelab:node_estimated_cost_sgd_per_hour"
NAS = "homelab:truenas_estimated_power_watts"


def run(promtool):
    settings = yaml.safe_load((ROOT / "flux/cluster-settings.yaml").read_text())["data"]
    objects = list(yaml.safe_load_all((ROOT / "infrastructure/storage/democratic-csi/truenas-pvc-dataset-exporter.yaml").read_text()))
    monitor = next(obj for obj in objects if obj["kind"] == "ServiceMonitor")
    endpoint = next(item for item in monitor["spec"]["endpoints"] if item["path"] == "/power")
    assert endpoint.get("honorLabels") is True, "Preserve raw host labels without exported_host breaking up joins"
    assert endpoint["interval"] == "120s" and endpoint["scrapeTimeout"] == "15s"
    base = int(settings["TRUENAS_POWER_COST_START_SECONDS"])
    spec = render(RULES, settings, base)
    assert spec["groups"][0]["interval"] == "2m"
    rules = spec["groups"][0]["rules"]
    cluster = [
        {"series": f'kube_node_info{{node="{node}"}}', "values": "1+0x20"}
        for node in (settings["PRIMARY_NODE_NAME"], settings["UTILITY_NODE_NAME"])
    ] + [
        {"series": f'homelab:node_host_cpu_utilization:ratio{{node="{node}"}}', "values": f"{ratio}+0x20"}
        for node, ratio in ((settings["PRIMARY_NODE_NAME"], .2), (settings["UTILITY_NODE_NAME"], .5))
    ]
    labels = 'job="truenas-pvc-dataset-exporter",host="truenas",telemetry="power",instance="exporter:9118",namespace="democratic-csi",service="truenas-pvc-dataset-exporter",endpoint="http",pod="exporter-a"'

    def inputs(watts="34+0x20", timestamp="fresh", up="1+0x20", success="1+0x20", extra_labels="", clock=base):
        return [{"series": f'{name}{{{labels}{extra_labels}}}', "values": values}
                for name, values in (
                    ("truenas_estimated_power_watts", watts),
                    ("truenas_power_sample_timestamp_seconds", f"{clock}+60x20" if timestamp == "fresh" else timestamp),
                    ("truenas_power_scrape_success", success), ("up", up),
                    ("truenas_power_cpu_utilization_ratio", ".1+0x20"),
                ) if values is not None]

    def expected(watts, at="6m"):
        host = lambda name, value: [{"labels": name+'{node="truenas"}', "value": value}]
        return [
            query(NAS, [] if watts is None else host(NAS, watts), at),
            query(f'{POWER}{{node="truenas"}}', [] if watts is None else host(POWER, watts), at),
            query(f'{COST}{{node="truenas"}}', [] if watts is None else host(COST, watts / 1000 * .3116), at),
            query("homelab:cluster_estimated_power_watts", [{"labels": "homelab:cluster_estimated_power_watts", "value": 39}], at),
            query("homelab:estimated_power_watts", [{"labels": "homelab:estimated_power_watts", "value": 39+(watts or 0)}], at),
            query("homelab:truenas_power_sample_available", host("homelab:truenas_power_sample_available", int(watts is not None)), at),
        ]

    tests = []
    def case(name, data, watts, extra=None):
        tests.append({"name": name, "interval": "1m", "input_series": cluster+data,
                      "promql_expr_test": expected(watts)+(extra or [])})

    case("Fresh NAS estimate joins homelab, not Kubernetes", inputs(), 34)
    for name, kwargs in (
        ("down target", {"up": "0+0x20"}), ("failed NAS read", {"success": "0+0x20"}),
        ("no timestamp", {"timestamp": None}), ("missing target", {"up": None}),
        ("stale sample", {"timestamp": f"{base-181}+60x20"}),
        ("future sample", {"timestamp": f"{base+1}+60x20"}),
        ("NaN sample", {"watts": "NaN+0x20"}), ("infinite sample", {"watts": "+Inf+0x20"}),
        ("zero sample", {"watts": "0+0x20"}), ("negative sample", {"watts": "-1+0x20"}),
    ):
        case("Reject "+name, inputs(**kwargs), None)
    case("Missing NAS never becomes an idle estimate", [], None)
    case("Exactly 180-second sample age accepted", inputs(timestamp=f"{base-180}+60x20"), 34)
    case("Duplicate target labels normalize without summing", inputs()+inputs(extra_labels=',replica="b"'), 34)
    case("Invalid duplicate cannot borrow freshness", inputs()+inputs(watts="99+0x20", timestamp=f"{base-181}+60x20", extra_labels=',replica="b"'), 34)
    case("Outage leaves an accounting gap and recovers", inputs(success="1+0x2 0+0x2 1+0x15"), 34, [
        query(f'{POWER}{{node="truenas"}}', [], "4m"),
        query(f'sum(sum_over_time({COST}{{node="truenas"}}[1h])) * 120 / 3600', [{"labels": "{}", "value": 34*3/1000*.3116*120/3600}]),
    ])
    case("Down duplicate cannot borrow a healthy up", inputs()+inputs(watts="99+0x20", up="0+0x20", extra_labels=',replica="b"'), 34)
    tests.append({"name": "NAS warning has a ten-minute recovery grace", "interval": "1m",
                  "input_series": cluster, "alert_rule_test": [
                      {"eval_time": "8m", "alertname": "TrueNASPowerSampleUnavailable", "exp_alerts": []},
                      {"eval_time": "10m", "alertname": "TrueNASPowerSampleUnavailable", "exp_alerts": [{
                          "exp_labels": {"severity": "warning", "node": "truenas"},
                          "exp_annotations": next(r["annotations"] for r in rules if r.get("alert") == "TrueNASPowerSampleUnavailable"),
                      }]},
                  ]})
    check_case(promtool, rules, tests)
    shifted = render(RULES, settings, base-600)["groups"][0]["rules"]
    check_case(promtool, shifted, [{
        "name": "NAS enrollment never backfills old history", "interval": "1m",
        "input_series": cluster+inputs(clock=base-600),
        "promql_expr_test": expected(None, "8m")+expected(34, "10m"),
    }])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promtool", default="promtool")
    run(parser.parse_args().promtool)
