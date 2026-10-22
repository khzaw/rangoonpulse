import os
import unittest
from unittest.mock import patch

from test_advisor import FakeKubeClient, make_node, make_recommendation, make_report
import advisor


def pod(release, cpu, *, node="primary", namespace="default", phase="Running", container="main"):
    return {
        "metadata": {"namespace": namespace, "labels": {"app.kubernetes.io/instance": release}},
        "spec": {
            "nodeName": node,
            "containers": [{"name": container, "resources": {"requests": {"cpu": cpu, "memory": "64Mi"}}}],
        },
        "status": {"phase": phase},
    }


def recommendation(release="tunarr", current="100m", proposed="150m", *, action="upsize"):
    return make_recommendation(
        release, current_cpu=current, recommended_cpu=proposed,
        current_memory="64Mi", recommended_memory="64Mi", action=action,
    )


class CpuHeadroomTests(unittest.TestCase):
    def plan(self, recommendations, pods, *, nodes=None, **env):
        nodes = nodes or [make_node("primary", cpu="5950m"), make_node("utility", cpu="3950m")]
        with (
            patch.dict(os.environ, {"MAX_APPLY_CHANGES_PER_RUN": "10", **env}, clear=True),
            patch.object(advisor, "KubeClient", return_value=FakeKubeClient(nodes, pods)),
        ):
            return advisor.build_apply_plan(make_report(recommendations))[0]

    def test_primary_growth_cannot_spend_utility_capacity(self):
        plan = self.plan([recommendation()], [pod("tunarr", "100m"), pod("other", "4839m")])
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_block"], 1)

    def test_exact_reserve_boundary_passes_but_one_millicore_more_does_not(self):
        # Small sidecars make up the node footprint without inflating its largest pod.
        pods = [pod("tunarr", "100m")] + [pod(f"other-{i}", "400m") for i in range(12)]
        plan = self.plan([recommendation(proposed="150m")], pods)
        self.assertEqual(len(plan["selected"]), 1)
        row = plan["node_fit"]["cpu_headroom"]["nodes"]["primary"]
        self.assertEqual(row["free_cpu_after_upsizes_m"], 1000)
        self.assertEqual(row["required_cpu_headroom_m"], 1000)
        blocked = self.plan([recommendation(proposed="151m")], pods)
        self.assertEqual(blocked["selected"], [])

    def test_recovery_downsize_is_allowed_while_reserve_is_still_short(self):
        plan = self.plan(
            [recommendation(current="200m", proposed="100m", action="downsize")],
            [pod("tunarr", "200m")] + [pod(f"other-{i}", "400m") for i in range(13)],
        )
        self.assertEqual(len(plan["selected"]), 1)
        self.assertFalse(plan["node_fit"]["cpu_headroom"]["fit_ok"])

    def test_downsize_pr_does_not_fund_an_unmerged_upsize_pr(self):
        plan = self.plan(
            [recommendation("bookorbit", "400m", "100m", action="downsize"), recommendation()],
            [pod("bookorbit", "400m"), pod("tunarr", "100m")]
            + [pod(f"other-{i}", "400m") for i in range(11)] + [pod("tail", "39m")],
            MAX_REQUESTS_PERCENT_CPU="1",
        )
        self.assertEqual([item["release"] for item in plan["selected"]], ["bookorbit"])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_block"], 1)

    def test_separate_upsize_prs_share_one_growth_budget(self):
        plan = self.plan(
            [recommendation(), recommendation("bookorbit")],
            [pod("tunarr", "100m"), pod("bookorbit", "100m")]
            + [pod(f"other-{i}", "400m") for i in range(11)] + [pod("tail", "300m")],
        )
        self.assertEqual(len(plan["selected"]), 1)
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_block"], 1)

    def test_replacement_pod_and_job_raise_reserve_above_the_floor(self):
        plan = self.plan(
            [recommendation(current="900m", proposed="1200m")],
            [pod("tunarr", "900m")] + [pod(f"other-{i}", "400m") for i in range(8)] + [pod("tail", "250m")],
        )
        self.assertEqual(plan["selected"], [])
        row = plan["skipped"][0]["cpu_headroom"]["nodes"]["primary"]
        self.assertEqual(row["required_cpu_headroom_m"], 1350)

    def test_short_reserve_on_primary_does_not_block_safe_utility_growth(self):
        plan = self.plan([recommendation()], [pod("other", "5400m"), pod("tunarr", "100m", node="utility")])
        self.assertEqual(len(plan["selected"]), 1)

    def test_stale_report_cannot_understate_actual_growth(self):
        plan = self.plan([recommendation(current="200m", proposed="250m")], [pod("tunarr", "100m")])
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["live_cpu_request_changed"], 1)

    def test_missing_candidate_placement_fails_closed(self):
        plan = self.plan([recommendation()], [])
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_unknown_placement"], 1)

    def test_completed_jobs_do_not_consume_headroom(self):
        plan = self.plan([recommendation()], [pod("tunarr", "100m"), pod("job", "5800m", phase="Succeeded")])
        self.assertEqual(len(plan["selected"]), 1)
        self.assertEqual(plan["node_fit"]["cpu_headroom"]["nodes"]["primary"]["current_cpu_m"], 100)

    def test_unplaced_pending_work_blocks_growth_until_placement_is_known(self):
        waiting = pod("waiting", "100m", node="", phase="Pending")
        plan = self.plan([recommendation()], [pod("tunarr", "100m"), waiting])
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_unknown_placement"], 1)

    def test_init_and_sidecar_requests_count_toward_replacement_size(self):
        work = pod("tunarr", "100m")
        work["spec"]["containers"].append({"name": "sidecar", "resources": {"requests": {"cpu": "200m"}}})
        work["spec"]["initContainers"] = [{"name": "init", "resources": {"requests": {"cpu": "1100m"}}}]
        plan = self.plan([recommendation()], [work])
        self.assertEqual(len(plan["selected"]), 1)
        row = plan["node_fit"]["cpu_headroom"]["nodes"]["primary"]
        self.assertGreaterEqual(row["required_cpu_headroom_m"], 1250)

    def test_pod_overhead_consumes_the_reserve(self):
        work = pod("tunarr", "100m")
        work["spec"]["overhead"] = {"cpu": "51m"}
        plan = self.plan(
            [recommendation()], [work] + [pod(f"other-{i}", "400m") for i in range(12)]
        )
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_block"], 1)

    def test_pinned_pending_pod_is_counted_on_its_target_node(self):
        waiting = pod("waiting", "600m", node="", phase="Pending")
        waiting["spec"]["nodeSelector"] = {"kubernetes.io/hostname": "primary"}
        plan = self.plan(
            [recommendation()], [pod("tunarr", "100m"), waiting]
            + [pod(f"other-{i}", "400m") for i in range(11)]
        )
        self.assertEqual(plan["selected"], [])
        self.assertEqual(plan["skipped_reason_counts"]["cpu_headroom_block"], 1)

    def test_invalid_headroom_configuration_fails_closed(self):
        for setting in ["-1", "nan", "inf"]:
            with self.subTest(setting=setting), self.assertRaises(ValueError):
                self.plan([], [], MIN_FREE_CPU_M_PER_NODE=setting)

    def test_per_service_projection_retains_worst_case_reserve_evidence(self):
        plan = self.plan([recommendation()], [pod("tunarr", "100m")])
        projection = advisor.build_selection_projection_summary(plan, plan["selected"])
        self.assertEqual(projection["node_fit"]["cpu_headroom"], plan["node_fit"]["cpu_headroom"])


if __name__ == "__main__":
    unittest.main()
