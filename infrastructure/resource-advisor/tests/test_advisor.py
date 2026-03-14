import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import advisor


class FakeKubeClient:
    def __init__(self, nodes, pods):
        self._nodes = nodes
        self._pods = pods

    def list_nodes(self):
        return self._nodes

    def list_pods(self, namespace=None):
        return self._pods


def make_node(name: str, cpu: str = "4000m", memory: str = "8192Mi") -> dict:
    return {
        "metadata": {"name": name},
        "status": {"allocatable": {"cpu": cpu, "memory": memory}},
    }


def make_report(recommendations: list[dict], coverage_days: float = 14.5) -> dict:
    return {
        "generated_at": "2026-03-13T18:30:19Z",
        "metrics_window": "14d",
        "metrics_coverage_days_estimate": coverage_days,
        "policy": {
            "deadband_percent": 10,
            "deadband_cpu_m": 25,
            "deadband_mem_mi": 64,
        },
        "recommendations": recommendations,
    }


def make_recommendation(
    release: str,
    *,
    current_cpu: str,
    recommended_cpu: str,
    current_memory: str,
    recommended_memory: str,
    action: str = "upsize",
    notes: list[str] | None = None,
) -> dict:
    return {
        "namespace": "default",
        "workload": release,
        "release": release,
        "container": "main",
        "kind": "deployment",
        "action": action,
        "notes": notes or [],
        "replicas": 1,
        "current": {
            "requests": {"cpu": current_cpu, "memory": current_memory},
            "limits": {"cpu": current_cpu, "memory": current_memory},
        },
        "recommended": {
            "requests": {"cpu": recommended_cpu, "memory": recommended_memory},
            "limits": {"cpu": recommended_cpu, "memory": recommended_memory},
        },
        "restarts_window": 0,
    }


class BuildApplyPlanTests(unittest.TestCase):
    def test_build_apply_plan_uses_default_allowlist_and_populates_next_up(self):
        release_one, release_two = advisor.DEFAULT_APPLY_ALLOWLIST[:2]
        report = make_report(
            [
                make_recommendation(
                    release_one,
                    current_cpu="100m",
                    recommended_cpu="150m",
                    current_memory="256Mi",
                    recommended_memory="320Mi",
                ),
                make_recommendation(
                    release_two,
                    current_cpu="100m",
                    recommended_cpu="125m",
                    current_memory="256Mi",
                    recommended_memory="320Mi",
                ),
            ]
        )
        fake_kube = FakeKubeClient([make_node("node-a")], [])

        with patch.dict(
            os.environ,
            {
                "MAX_APPLY_CHANGES_PER_RUN": "1",
                "MAX_REQUESTS_PERCENT_CPU": "100",
                "MAX_REQUESTS_PERCENT_MEMORY": "100",
            },
            clear=True,
        ):
            with patch.object(advisor, "KubeClient", return_value=fake_kube):
                plan, markdown = advisor.build_apply_plan(report)

        self.assertEqual(len(plan["selected"]), 1)
        self.assertEqual(len(plan["next_up"]), 1)
        self.assertEqual(plan["selected"][0]["release"], release_one)
        self.assertEqual(plan["next_up"][0]["release"], release_two)
        self.assertEqual(plan["selected_reason_counts"], {"upsize_with_node_fit": 1})
        self.assertEqual(plan["skipped_reason_counts"].get("max_changes_reached"), 1)
        self.assertNotIn("not_allowlisted", plan["skipped_reason_counts"])
        self.assertIn("## Next Up Queue", markdown)

    def test_build_apply_plan_surfaces_hard_node_capacity_blocks(self):
        release = advisor.DEFAULT_APPLY_ALLOWLIST[0]
        report = make_report(
            [
                make_recommendation(
                    release,
                    current_cpu="0m",
                    recommended_cpu="200m",
                    current_memory="64Mi",
                    recommended_memory="128Mi",
                )
            ]
        )
        fake_kube = FakeKubeClient([make_node("node-a", cpu="100m", memory="256Mi")], [])

        with patch.dict(
            os.environ,
            {
                "MAX_APPLY_CHANGES_PER_RUN": "5",
                "MAX_REQUESTS_PERCENT_CPU": "100",
                "MAX_REQUESTS_PERCENT_MEMORY": "100",
            },
            clear=True,
        ):
            with patch.object(advisor, "KubeClient", return_value=fake_kube):
                plan, _markdown = advisor.build_apply_plan(report)

        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"].get("node_capacity_block"), 1)
        self.assertTrue(plan["node_fit"]["hard_fit_ok"])


if __name__ == "__main__":
    unittest.main()
