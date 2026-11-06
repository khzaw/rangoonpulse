#!/usr/bin/env python3
"""Exercise Flux alert timing, dependency matching, and recovery with promtool."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import yaml


ROOT = Path(__file__).resolve().parents[1]
ALERTS = (
    "FluxResourceNotReady",
    "FluxChartVersionUnavailable",
    "FluxSourceGitRepositoryReconcileErrors",
)


def metric(kind, name, namespace="flux-system", reason="InvalidChartReference",
           revision="1.0.0", **labels):
    fields = dict(kind=kind, name=name, exported_namespace=namespace, ready="False",
                  suspended="False", reason=reason, revision=revision)
    if kind in {"HelmChart", "HelmRelease"}:
        fields["source_name"] = "example-charts"
    fields.update(labels)
    return "flux_resource_info{" + ",".join(
        f"{key}={json.dumps(value)}" for key, value in fields.items()
    ) + "}"


def counts(at, **expected):
    return [{
        "expr": f'count(ALERTS{{alertname="{name}",alertstate="firing"}}) or vector(0)',
        "eval_time": at,
        "exp_samples": [{"labels": "{}", "value": expected.get(name, 0)}],
    } for name in ALERTS]


def case(name, series, checks, interval="2m", repository_url="https://example.test/charts",
         repository_ready="True"):
    # Keep the metrics-absence watchdog independent of each failure fixture.
    healthy = metric("GitRepository", "flux-system", ready="True", reason="Succeeded")
    repository = [{
        "series": metric("HelmRepository", "example-charts", ready=repository_ready,
                         reason="Succeeded" if repository_ready == "True" else "FetchFailed",
                         url=repository_url),
        "values": "1+0x1700",
    }] if repository_url else []
    return {
        "name": name,
        "interval": interval,
        "input_series": [{"series": healthy, "values": "1+0x1700"}] + repository + series,
        "promql_expr_test": checks,
    }


def run(promtool):
    groups = []
    for source in (
        "infrastructure/monitoring/prometheusrule-flux-reconciliation.yaml",
        "infrastructure/dns-reliability/prometheusrule-dns-reliability.yaml",
    ):
        groups.extend(yaml.safe_load((ROOT / source).read_text())["spec"]["groups"])

    chart = metric("HelmChart", "monitoring-example")
    release = metric("HelmRelease", "example", namespace="monitoring", reason="SourceNotReady")
    persistent = [{"series": s, "values": "1+0x800"} for s in (chart, release)]
    tests = [
        case("daily index lag produces no short-lived or duplicate notifications", persistent,
             counts("2h") + counts("25h58m")
             + counts("26h", FluxChartVersionUnavailable=1)),
        case("index recovery within a day clears the pending alert", [
            {"series": s, "values": "1+0x89 stale"} for s in (chart, release)
        ], counts("2h") + counts("4h") + counts("26h")),
        case("a different release from the same repository still alerts", persistent + [{
            "series": metric("HelmRelease", "other", namespace="monitoring", reason="SourceNotReady"),
            "values": "1+0x800",
        }], counts("16m", FluxResourceNotReady=1)
             + counts("26h", FluxResourceNotReady=1, FluxChartVersionUnavailable=1)),
        case("an initial installation with no previous revision alerts normally", [
            {"series": metric("HelmChart", "monitoring-example", revision=""), "values": "1+0x20"},
            {"series": metric("HelmRelease", "example", namespace="monitoring",
                              reason="SourceNotReady", revision=""), "values": "1+0x20"},
        ], counts("16m", FluxResourceNotReady=2)),
        case("a first install cannot inherit an existing chart's grace period", [
            persistent[0],
            {"series": metric("HelmRelease", "example", namespace="monitoring",
                              reason="SourceNotReady", revision=""), "values": "1+0x20"},
        ], counts("16m", FluxResourceNotReady=1)),
        case("missing chart telemetry cannot hide a release failure", [persistent[1]],
             counts("16m", FluxResourceNotReady=1)),
        case("a chart in another namespace cannot suppress a generated-chart failure", [
            {"series": metric("HelmChart", "monitoring-example", namespace="other"),
             "values": "1+0x20"}, persistent[1],
        ], counts("16m", FluxResourceNotReady=2)),
        case("OCI references have no daily HTTP index grace period", persistent,
             counts("16m", FluxResourceNotReady=2), repository_url="oci://example.test/charts"),
        case("missing repository telemetry fails open to normal notifications", persistent,
             counts("16m", FluxResourceNotReady=2), repository_url=None),
        case("a broken repository cannot be treated as a healthy cached index", persistent,
             counts("16m", FluxResourceNotReady=3), repository_ready="False"),
        case("source download failures retain the normal alert threshold", [
            {"series": metric("HelmChart", "monitoring-example", reason="FetchFailed"),
             "values": "1+0x20"}, persistent[1],
        ], counts("16m", FluxResourceNotReady=2)),
        case("a failed upgrade still alerts even when its chart is unavailable", [
            persistent[0],
            {"series": metric("HelmRelease", "example", namespace="monitoring",
                              reason="RollbackSucceeded"), "values": "1+0x20"},
        ], counts("16m", FluxResourceNotReady=1)),
        case("a suspended chart cannot suppress an active release failure", [
            {"series": metric("HelmChart", "monitoring-example", suspended="True"),
             "values": "1+0x20"}, persistent[1],
        ], counts("16m", FluxResourceNotReady=1)),
    ]
    errors = ('controller_runtime_reconcile_errors_total{namespace="flux-system",'
              'pod="source-controller-test",controller="gitrepository"}')
    tests += [
        case("a recovered one-off Git error never fires", [
            {"series": errors, "values": "0 1+0x30"},
        ], sum((counts(f"{minute}m") for minute in range(1, 31)), []), interval="1m"),
        case("repeated Git failures alert and then recover", [
            {"series": errors, "values": "0+1x20 20+0x15"},
        ], counts("9m") + counts("12m", FluxSourceGitRepositoryReconcileErrors=1)
             + counts("30m"), interval="1m"),
    ]
    with tempfile.TemporaryDirectory(prefix="flux-alert-tests-") as directory:
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
