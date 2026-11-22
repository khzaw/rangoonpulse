#!/usr/bin/env python3
"""Exercise the CoreDNS replica-placement alert with promtool."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import yaml


ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "infrastructure/dns-reliability/prometheusrule-dns-reliability.yaml"
ALERT = "CoreDNSReplicasOnSingleNode"


def series(name, **labels):
    return name + "{" + ",".join(f"{key}={json.dumps(value)}" for key, value in labels.items()) + "}"


def pod(name, node, ready="1+0x90", instance="10.244.0.10:8080"):
    """kube-state-metrics series for one CoreDNS pod; `ready` is the condition=true sample string."""
    scrape = dict(job="kube-state-metrics", instance=instance, namespace="kube-system", pod=name)
    return [
        {"series": series("kube_pod_info", **scrape, node=node, created_by_kind="ReplicaSet"),
         "values": "1+0x90"},
        {"series": series("kube_pod_status_ready", **scrape, condition="true"), "values": ready},
    ]


def case(name, pods, at, firing):
    """`firing` maps node -> ready replica count for each expected alert."""
    rule = next(r for g in yaml.safe_load(RULES.read_text())["spec"]["groups"]
                for r in g["rules"] if r.get("alert") == ALERT)
    expected = [{
        "exp_labels": {"severity": rule["labels"]["severity"], "node": node},
        "exp_annotations": {
            key: text.replace("{{ $labels.node }}", node).replace("{{ $value }}", str(count))
            for key, text in rule["annotations"].items()
        },
    } for node, count in firing.items()]
    return {
        "name": name,
        "interval": "1m",
        "input_series": [s for p in pods for s in p],
        "alert_rule_test": [{"eval_time": at, "alertname": ALERT, "exp_alerts": expected}],
    }


def run(promtool):
    spread = [pod("coredns-a", "primary"), pod("coredns-b", "utility")]
    together = [pod("coredns-a", "primary"), pod("coredns-b", "primary")]
    tests = [
        case("co-located ready replicas stay pending for under 30 minutes", together, "29m", {}),
        case("co-located ready replicas alert after 30 minutes", together, "31m", {"primary": 2}),
        case("spread replicas never alert", spread, "60m", {}),
        case("an unready co-located replica is left to replica-availability alerts",
             [pod("coredns-a", "primary"), pod("coredns-b", "primary", ready="0+0x90")], "60m", {}),
        case("two of three replicas sharing a node is still spread",
             spread + [pod("coredns-c", "primary")], "60m", {}),
        case("rebalancing to the other node clears the alert", [
            pod("coredns-a", "primary"),
            pod("coredns-b", "primary", ready="1+0x40 stale"),
            pod("coredns-c", "utility", ready="_x41 1+0x49"),
        ], "60m", {}),
        case("duplicate kube-state-metrics series count each replica once",
             together + [pod("coredns-a", "primary", instance="10.244.1.10:8080"),
                         pod("coredns-b", "primary", instance="10.244.1.10:8080")],
             "31m", {"primary": 2}),
    ]
    groups = yaml.safe_load(RULES.read_text())["spec"]["groups"]
    with tempfile.TemporaryDirectory(prefix="dns-alert-tests-") as directory:
        folder = Path(directory)
        (folder / "rules.yaml").write_text(yaml.safe_dump({"groups": groups}))
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
