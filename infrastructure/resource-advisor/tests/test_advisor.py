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


def make_apply_item(
    release: str,
    path: str,
    *,
    container: str = "main",
    current_cpu: str = "100m",
    recommended_cpu: str = "150m",
    current_memory: str = "256Mi",
    recommended_memory: str = "320Mi",
    replicas: int = 1,
    selection_reason: str = "upsize_with_node_fit",
) -> dict:
    delta_cpu = advisor.parse_cpu_to_m(recommended_cpu) - advisor.parse_cpu_to_m(current_cpu)
    delta_mem = advisor.parse_mem_to_mi(recommended_memory) - advisor.parse_mem_to_mi(current_memory)
    return {
        "release": release,
        "container": container,
        "path": path,
        "replicas": replicas,
        "notes": [],
        "placement": {"node-a": replicas},
        "current": {
            "requests": {"cpu": current_cpu, "memory": current_memory},
            "limits": {"cpu": current_cpu, "memory": current_memory},
        },
        "recommended": {
            "requests": {"cpu": recommended_cpu, "memory": recommended_memory},
            "limits": {"cpu": recommended_cpu, "memory": recommended_memory},
        },
        "delta": {
            "requests_cpu_m": delta_cpu,
            "requests_memory_mi": delta_mem,
            "requests_cpu_m_total": delta_cpu * replicas,
            "requests_memory_mi_total": delta_mem * replicas,
        },
        "selection_reason": selection_reason,
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


class ApplyPrTests(unittest.TestCase):
    def test_open_or_update_apply_pr_creates_one_pr_per_release(self):
        report = make_report([])
        plan = {
            "metrics_coverage_days_estimate": 14.5,
            "budgets": {"cpu_m": 4000.0, "memory_mi": 8192.0},
            "current_requests": {"cpu_m": 500.0, "memory_mi": 512.0},
            "projected_requests_after_selected": {"cpu_m": 900.0, "memory_mi": 960.0},
            "advisory_pressure": {"cpu": False, "memory": False},
            "node_fit": {
                "assumptions": "current placement",
                "nodes": [
                    {
                        "name": "node-a",
                        "allocatable": {"cpu_m": 4000.0, "memory_mi": 8192.0},
                        "advisory_budget": {"cpu_m": 4000.0, "memory_mi": 8192.0},
                        "current_requests": {"cpu_m": 500.0, "memory_mi": 512.0},
                        "projected_requests": {"cpu_m": 900.0, "memory_mi": 960.0},
                    }
                ],
            },
            "skipped": [],
            "selected": [
                make_apply_item("tunarr", "apps/tunarr/helmrelease.yaml"),
                make_apply_item(
                    "tunarr",
                    "apps/tunarr/helmrelease.yaml",
                    container="metrics",
                    current_cpu="50m",
                    recommended_cpu="75m",
                    current_memory="128Mi",
                    recommended_memory="160Mi",
                ),
                make_apply_item("sonarr", "apps/sonarr/helmrelease.yaml"),
            ],
        }

        with patch.dict(
            os.environ,
            {
                "GITHUB_TOKEN": "token",
                "GITHUB_REPOSITORY": "khzaw/rangoonpulse",
                "GITHUB_BASE_BRANCH": "master",
                "GITHUB_APPLY_HEAD_BRANCH": "tune/resource-advisor-apply",
            },
            clear=True,
        ):
            with patch.object(advisor, "ensure_branch", return_value=True) as ensure_branch_mock:
                with patch.object(advisor, "read_repo_file", return_value=(200, "sha", "content")) as read_repo_file_mock:
                    with patch.object(
                        advisor,
                        "patch_app_template_resources",
                        side_effect=lambda content, **kwargs: (content + f"\n# {kwargs['container_name']}", True, ""),
                    ) as patch_resources_mock:
                        with patch.object(advisor, "update_repo_file", return_value=True) as update_repo_file_mock:
                            with patch.object(
                                advisor,
                                "ensure_pull_request",
                                side_effect=[
                                    {"status": "created", "number": 11, "url": "https://example.invalid/pr/11"},
                                    {"status": "created", "number": 12, "url": "https://example.invalid/pr/12"},
                                ],
                            ) as ensure_pr_mock:
                                result = advisor.open_or_update_apply_pr(report, plan)

        self.assertEqual(result["status"], "created")
        self.assertEqual(result["service_count"], 2)
        self.assertEqual(result["pr_count"], 2)
        self.assertEqual(result["status_counts"], {"created": 2})
        self.assertEqual([item["release"] for item in result["pull_requests"]], ["tunarr", "sonarr"])
        self.assertEqual(ensure_branch_mock.call_count, 2)
        self.assertEqual(read_repo_file_mock.call_count, 2)
        self.assertEqual(patch_resources_mock.call_count, 3)
        self.assertEqual(update_repo_file_mock.call_count, 2)
        self.assertEqual(ensure_pr_mock.call_count, 2)
        self.assertIn("tune/tunarr:", ensure_pr_mock.call_args_list[0].kwargs["title"])
        self.assertIn("tune/sonarr:", ensure_pr_mock.call_args_list[1].kwargs["title"])
        self.assertIn("Projected requests after this service change", ensure_pr_mock.call_args_list[0].kwargs["body"])


class RepoUpdateTests(unittest.TestCase):
    def test_update_repo_file_sets_explicit_author_and_committer(self):
        with patch.dict(
            os.environ,
            {
                "GITHUB_AUTHOR_NAME": "khzaw",
                "GITHUB_AUTHOR_EMAIL": "khzaw@users.noreply.github.com",
                "GITHUB_COMMITTER_NAME": "khzaw",
                "GITHUB_COMMITTER_EMAIL": "khzaw@users.noreply.github.com",
            },
            clear=True,
        ):
            with patch.object(advisor, "read_repo_file", return_value=(200, "abc123", "old")):
                with patch.object(advisor, "github_request", return_value=(200, {})) as github_request_mock:
                    changed = advisor.update_repo_file(
                        repository="khzaw/rangoonpulse",
                        branch="tune/test",
                        path="apps/tunarr/helmrelease.yaml",
                        content="new",
                        token="token",
                        commit_message="resource-advisor: apply safe resource tuning",
                    )

        self.assertTrue(changed)
        payload = github_request_mock.call_args.args[3]
        self.assertEqual(payload["author"], {"name": "khzaw", "email": "khzaw@users.noreply.github.com"})
        self.assertEqual(payload["committer"], {"name": "khzaw", "email": "khzaw@users.noreply.github.com"})


if __name__ == "__main__":
    unittest.main()
