import copy
import datetime as dt
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import advisor
import exporter
import restart_policy as policy
from test_advisor import FakeKubeClient, make_node


BOOT = 1793579120


def iso(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sample(metric, value):
    return {"metric": metric, "value": [BOOT + 3600, str(value)]}


def pod(name="bookorbit-abc-123", owner="bookorbit-abc", node="node-a", reason="Unknown", code=255):
    return {
        "metadata": {"name": name, "namespace": "default", "uid": name + "-uid",
                     "creationTimestamp": iso(BOOT - 3600),
                     "labels": {"app.kubernetes.io/instance": "bookorbit"},
                     "ownerReferences": [{"kind": "ReplicaSet", "name": owner, "uid": owner, "controller": True}]},
        "spec": {"nodeName": node, "containers": [{"name": "main", "resources": {
            "requests": {"cpu": "400m", "memory": "1024Mi"},
            "limits": {"cpu": "800m", "memory": "2048Mi"},
        }}]},
        "status": {"phase": "Running", "containerStatuses": [{
            "name": "main", "restartCount": 1, "ready": True,
            "state": {"running": {"startedAt": iso(BOOT + 400)}},
            "lastState": {"terminated": {"reason": reason, "exitCode": code,
                                         "startedAt": iso(BOOT - 1800), "finishedAt": iso(BOOT + 200)}},
        }]},
    }


class Prom:
    def __init__(self, target):
        self.metric = {"namespace": "default", "pod": target["metadata"]["name"],
                       "uid": target["metadata"]["uid"], "container": "main"}
        self.history = [sample(self.metric, 1.0001)]
        self.boot_metric = {"namespace": "monitoring", "pod": "node-exporter-a", "instance": "node-a:9100"}
        self.boots = [sample(self.boot_metric, BOOT)]
        self.before, self.resets, self.changes = 0, 0, 1

    def query_vector(self, query):
        if query == "node_boot_time_seconds":
            return self.boots
        if query.startswith("changes("):
            return [sample(self.boot_metric, self.changes)]
        if query.startswith("min_over_time("):
            return [sample(self.boot_metric, BOOT - 86400)]
        if query.startswith("increase("):
            return self.history
        value = self.resets if query.startswith("resets(") else self.before
        return [] if value is None else [sample(self.metric, value)]

    def query_scalar(self, query):
        if query.startswith("sum(increase(kube_pod_container_status_restarts_total"):
            return sum(float(s["value"][1]) for s in self.history) if self.history else None
        if query.startswith("quantile_over_time"):
            return 0.01 if "container_cpu" in query else 64 * 1024 * 1024
        return 0.0


class RestartPolicyTests(unittest.TestCase):
    def setUp(self):
        self.target = pod()
        self.pods = [self.target, pod("two-abc-123", "two-abc"), pod("three-abc-123", "three-abc"),
                     {"metadata": {"namespace": "monitoring", "name": "node-exporter-a"},
                      "spec": {"nodeName": "node-a"}}]
        self.nodes = [make_node("node-a")]
        self.nodes[0]["status"].update({"nodeInfo": {"bootID": "boot-a"},
                                         "conditions": [{"type": "Ready", "status": "True"}]})
        self.prom = Prom(self.target)

    def assess(self, total=1.0001):
        return policy.RestartClassifier(self.prom, self.nodes, self.pods, "14d").assess(
            "default", "bookorbit", "deployments", "main", "bookorbit-.+", total,
        )

    def state(self):
        return self.target["status"]["containerStatuses"][0]

    def test_corroborated_runtime_status_loss_is_exempt_but_raw_count_is_retained(self):
        assessment = self.assess()
        self.assertEqual(assessment["status"], "node_reboot")
        self.assertEqual(assessment["excluded_restarts"], 1)
        self.assertEqual(assessment["evidence"][0]["corroborating_owners"], 3)
        self.assertEqual(assessment["evidence"][0]["boot_time"], BOOT)

    def test_completed_exit_qualifies_without_lost_status_cohort(self):
        self.state()["lastState"]["terminated"].update(reason="Completed", exitCode=0, finishedAt=iso(BOOT - 30))
        self.pods = [self.target, self.pods[-1]]
        self.assertEqual(self.assess()["status"], "node_reboot")

    def test_oom_errors_and_other_unknown_exits_during_recovery_stay_guarded(self):
        for reason, code in [("OOMKilled", 137), ("Error", 1), ("Error", 0), ("Unknown", 0), ("Completed", 1)]:
            with self.subTest(reason=reason, code=code):
                self.state()["lastState"]["terminated"].update(reason=reason, exitCode=code)
                self.assertEqual(self.assess()["status"], "guarded")

    def test_repeated_restarts_remain_guarded_even_if_only_one_is_in_history(self):
        self.state()["restartCount"] = 2
        self.assertEqual(self.assess()["status"], "guarded")

    def test_recovery_crash_and_late_restart_cannot_qualify(self):
        self.state()["lastState"]["terminated"]["startedAt"] = iso(BOOT + 10)
        self.assertEqual(self.assess()["status"], "guarded")
        self.state()["lastState"]["terminated"]["startedAt"] = iso(BOOT - 1800)
        self.state()["state"]["running"]["startedAt"] = iso(BOOT + 601)
        self.assertEqual(self.assess()["status"], "guarded")

    def test_independent_owners_and_exact_timestamps_are_required(self):
        self.pods[2]["metadata"]["ownerReferences"] = [
            {"kind": "ReplicaSet", "name": "two-def", "uid": "other-rollout", "controller": True},
        ]
        self.assertEqual(self.assess()["reason"], "runtime_status_loss_uncorroborated")
        self.pods[2] = pod("three-abc-123", "three-abc")
        self.pods[2]["status"]["containerStatuses"][0]["lastState"]["terminated"]["finishedAt"] = iso(BOOT + 201)
        self.assertEqual(self.assess()["status"], "guarded")

    def test_no_reboot_on_this_node_and_missing_or_ambiguous_boot_history_stay_guarded(self):
        for boots, changes in [([], 1), (self.prom.boots * 2, 1), (self.prom.boots, 0)]:
            with self.subTest(boots=boots, changes=changes):
                self.prom.boots, self.prom.changes = boots, changes
                self.assertEqual(self.assess()["status"], "guarded")

    def test_missing_reset_or_nonzero_preboot_counter_stays_guarded(self):
        for before, resets in [(None, 0), (1, 0), (0, None), (0, 1), (float("nan"), 0)]:
            with self.subTest(before=before, resets=resets):
                self.prom.before, self.prom.resets = before, resets
                self.assertEqual(self.assess()["status"], "guarded")

    def test_retired_uid_duplicate_conflicting_and_nonfinite_history_stay_guarded(self):
        old_metric = {**self.prom.metric, "uid": "retired"}
        for history in [None, [], [sample(old_metric, 1)], self.prom.history * 2,
                        [sample(self.prom.metric, 0.5)], [sample(self.prom.metric, "NaN")],
                        [sample(self.prom.metric, 1), sample(old_metric, 1)]]:
            with self.subTest(history=history):
                self.prom.history = history
                self.assertEqual(self.assess()["status"], "guarded")

    def test_duplicate_series_and_crashed_replica_cannot_hide_behind_a_proven_reboot(self):
        self.prom.history *= 2
        self.assertEqual(self.assess(2.0002)["status"], "guarded")
        other = pod("bookorbit-abc-456", reason="OOMKilled", code=137)
        self.pods.append(other)
        self.prom.history[1] = sample({**self.prom.metric, "pod": other["metadata"]["name"],
                                      "uid": other["metadata"]["uid"]}, 1.0001)
        self.assertEqual(self.assess(2.0002)["status"], "guarded")

    def test_snapshot_omits_freeform_termination_messages(self):
        self.state()["lastState"]["terminated"]["message"] = "application output"
        assessment = self.assess()
        self.assertEqual(assessment["status"], "node_reboot")
        self.assertNotIn("message", assessment["live_snapshot"][0]["last_termination"])

    def test_zero_and_missing_restart_metrics_have_distinct_statuses(self):
        self.assertEqual(self.assess(0)["status"], "clear")
        for value in [None, float("nan"), -1]:
            self.assertEqual(self.assess(value)["status"], "unavailable")

    def test_unready_missing_boot_id_or_terminating_pods_stay_guarded(self):
        self.state()["ready"] = False
        self.assertEqual(self.assess()["status"], "guarded")
        self.state()["ready"] = True
        self.nodes[0]["status"]["nodeInfo"] = {}
        self.assertEqual(self.assess()["status"], "guarded")
        self.nodes[0]["status"]["nodeInfo"]["bootID"] = "boot-a"
        self.target["metadata"]["deletionTimestamp"] = iso(BOOT + 600)
        self.assertEqual(self.assess()["status"], "guarded")

    def test_prefix_collision_is_not_a_matching_workload(self):
        self.target["metadata"]["ownerReferences"][0]["name"] = "bookorbit-secondary-abc"
        self.assertEqual(self.assess()["status"], "guarded")

    def report(self):
        kube = FakeKubeClient(self.nodes, self.pods)
        workload = {"metadata": {"name": "bookorbit", "labels": {"app.kubernetes.io/instance": "bookorbit"}},
                    "spec": {"replicas": 1, "template": {"spec": self.target["spec"]}}}
        kube.list_workloads = lambda ns, kind: [workload] if ns == "default" and kind == "deployments" else []
        with (patch.dict(os.environ, {}, clear=True), patch.object(advisor, "KubeClient", return_value=kube),
              patch.object(advisor, "PromClient", return_value=self.prom),
              patch.object(advisor, "estimate_coverage_days", return_value=14.5)):
            return advisor.build_report()[0]

    def plan(self, report, pods=None, nodes=None):
        with (patch.dict(os.environ, {}, clear=True), patch.object(advisor, "KubeClient", return_value=
              FakeKubeClient(nodes or self.nodes, self.pods if pods is None else pods))):
            return advisor.build_apply_plan(report)[0]

    def test_report_and_preflight_exempt_proven_reboot_without_bypassing_maturity_or_limit_policy(self):
        report = self.report()
        row = report["recommendations"][0]
        self.assertEqual(row["restarts_window"], 1.0)
        self.assertNotIn("restart_guard", row["notes"])
        self.assertIn("node_reboot_restarts_excluded", row["notes"])
        self.assertEqual(row["recommended"]["requests"], {"cpu": "300m", "memory": "768Mi"})
        selected = self.plan(report)["selected"]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["recommended"]["limits"], row["current"]["limits"])
        report["metrics_coverage_days_estimate"] = 13.9
        self.assertEqual(self.plan(report)["skipped_reason_counts"], {"insufficient_data_for_downsize": 1})
        row["recommended"]["requests"]["memory"] = "1280Mi"
        row["action"] = "upsize"
        self.assertEqual(self.plan(report)["skipped_reason_counts"], {"insufficient_data_for_upsize": 1})

    def test_oom_report_retains_memory_and_apply_guard(self):
        self.state()["lastState"]["terminated"].update(reason="OOMKilled", exitCode=137)
        report = self.report()
        row = report["recommendations"][0]
        self.assertIn("restart_guard", row["notes"])
        self.assertEqual(row["recommended"]["requests"]["memory"], "1024Mi")
        self.assertEqual(self.plan(report)["skipped_reason_counts"], {"restart_guard_blocks_downsize": 1})

    def test_missing_metrics_blocks_downsize_without_enabling_immature_upsize(self):
        self.prom.history = []
        report = self.report()
        row = report["recommendations"][0]
        self.assertIsNone(row["restarts_window"])
        self.assertNotIn("restart_guard", row["notes"])
        self.assertEqual(self.plan(report)["skipped_reason_counts"], {"restart_metrics_unavailable": 1})
        row["recommended"]["requests"]["memory"] = "1280Mi"
        row["action"] = "upsize"
        report["metrics_coverage_days_estimate"] = 1
        self.assertEqual(self.plan(report)["skipped_reason_counts"], {"insufficient_data_for_upsize": 1})

    def test_changed_live_evidence_blocks_a_stale_exemption(self):
        report = self.report()
        for mutation in ["restart", "uid", "start", "unready", "new_replica", "missing_pod", "boot"]:
            with self.subTest(mutation=mutation):
                pods, nodes = copy.deepcopy(self.pods), copy.deepcopy(self.nodes)
                state = pods[0]["status"]["containerStatuses"][0]
                if mutation == "restart":
                    state["restartCount"] = 2
                elif mutation == "uid":
                    pods[0]["metadata"]["uid"] = "replacement"
                elif mutation == "start":
                    state["state"]["running"]["startedAt"] = iso(BOOT + 500)
                elif mutation == "unready":
                    state["ready"] = False
                elif mutation == "new_replica":
                    pods.append(pod("bookorbit-abc-456"))
                elif mutation == "missing_pod":
                    pods = pods[1:]
                else:
                    nodes[0]["status"]["nodeInfo"]["bootID"] = "another-boot"
                self.assertEqual(self.plan(report, pods, nodes)["skipped_reason_counts"], {"restart_evidence_changed": 1})

    def test_ui_payload_preserves_raw_counts_exemption_evidence_and_missing_metrics(self):
        report = self.report()
        with patch.object(exporter, "STATE", exporter.State()):
            exporter.STATE.report = report
            row = exporter.build_ui_payload()["report"]["recommendations"][0]
            self.assertEqual(row["restarts_window"], 1.0)
            self.assertEqual(row["restart_assessment"], report["recommendations"][0]["restart_assessment"])
            report["recommendations"][0]["restarts_window"] = None
            self.assertIsNone(exporter.build_ui_payload()["report"]["recommendations"][0]["restarts_window"])


class PrometheusTelemetryTests(unittest.TestCase):
    def test_missing_invalid_and_nonfinite_samples_do_not_become_zero(self):
        client = advisor.PromClient("http://example.invalid")
        for vector in [None, [], [sample({}, "NaN")], [sample({}, "Inf")], [sample({}, "oops")]]:
            with self.subTest(vector=vector), patch.object(client, "query_vector", return_value=vector):
                self.assertIsNone(client.query_scalar("query"))
        with patch.object(client, "query_vector", return_value=[sample({}, 0)]):
            self.assertEqual(client.query_scalar("query"), 0)


if __name__ == "__main__":
    unittest.main()
