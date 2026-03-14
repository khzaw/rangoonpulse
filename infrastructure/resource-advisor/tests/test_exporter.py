import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import exporter


class ExporterTests(unittest.TestCase):
    def test_next_cron_occurrence_uses_cronjob_timezone(self):
        now = exporter.dt.datetime(2026, 3, 14, 12, 0, tzinfo=exporter.ZoneInfo("Asia/Singapore"))
        self.assertEqual(
            exporter._next_cron_occurrence("30 3 * * 1", "Asia/Singapore", now=now),
            "2026-03-15T19:30:00Z",
        )

    def test_metrics_and_ui_include_last_apply_and_schedule(self):
        with patch.object(exporter, "STATE", exporter.State()):
            with exporter.STATE.lock:
                exporter.STATE.report = {
                    "generated_at": "2026-03-13T18:30:19Z",
                    "mode": "report",
                    "metrics_window": "14d",
                    "metrics_coverage_days_estimate": 14.77,
                    "summary": {
                        "upsize_count": 2,
                        "downsize_count": 1,
                        "no_change_count": 0,
                        "containers_analyzed": 3,
                        "containers_with_metrics": 3,
                        "total_current_requests_cpu_m": 300.0,
                        "total_recommended_requests_cpu_m": 280.0,
                        "total_current_requests_memory_mi": 512.0,
                        "total_recommended_requests_memory_mi": 640.0,
                    },
                    "policy": {
                        "max_step_percent": 25,
                        "request_buffer_percent": 30,
                        "limit_buffer_percent": 60,
                        "deadband_percent": 10,
                        "deadband_cpu_m": 25,
                        "deadband_mem_mi": 64,
                    },
                    "budget": {
                        "allocatable": {"cpu": "9900m", "memory": "38646Mi"},
                        "current_requests_percent_of_allocatable": {"cpu": 47.0, "memory": 37.4},
                        "recommended_requests_percent_of_allocatable": {"cpu": 40.5, "memory": 38.7},
                    },
                    "recommendations": [
                        {
                            "namespace": "default",
                            "workload": "tunarr",
                            "container": "main",
                            "release": "tunarr",
                            "kind": "deployment",
                            "action": "upsize",
                            "notes": ["restart_guard"],
                            "replicas": 1,
                            "current": {
                                "requests": {"cpu": "200m", "memory": "512Mi"},
                                "limits": {"cpu": "1000m", "memory": "1024Mi"},
                            },
                            "recommended": {
                                "requests": {"cpu": "150m", "memory": "640Mi"},
                                "limits": {"cpu": "1000m", "memory": "1024Mi"},
                            },
                            "cpu_p95_m": 62.6,
                            "mem_p95_mi": 658.1,
                            "restarts_window": 1,
                        }
                    ],
                }
                exporter.STATE.latest_md = "line one\nline two\n"
                exporter.STATE.last_fetch_ok = True
                exporter.STATE.last_fetch_at = 1
                exporter.STATE.apply_plan = {
                    "preflight_generated_at": "2026-03-14T06:30:00Z",
                    "selected": [
                        {
                            "release": "tunarr",
                            "container": "main",
                            "current": {"requests": {"cpu": "200m", "memory": "512Mi"}},
                            "recommended": {"requests": {"cpu": "150m", "memory": "640Mi"}},
                            "selection_reason": "upsize_with_node_fit",
                        }
                    ],
                    "next_up": [
                        {
                            "release": "bazarr",
                            "container": "main",
                            "current": {"requests": {"cpu": "100m", "memory": "256Mi"}},
                            "recommended": {"requests": {"cpu": "75m", "memory": "320Mi"}},
                            "queue_reason": "downsize_with_mature_data",
                        }
                    ],
                    "skipped": [{"reason": "max_changes_reached", "release": "bazarr", "container": "main"}],
                    "selected_reason_counts": {"upsize_with_node_fit": 1},
                    "skipped_reason_counts": {"max_changes_reached": 1},
                    "advisory_pressure": {"cpu": True, "memory": False},
                    "node_fit": {"hard_fit_ok": True},
                    "budgets": {"cpu_m": 5940.0, "memory_mi": 25119.9},
                    "current_requests": {"cpu_m": 6675.0, "memory_mi": 14448.0},
                    "projected_requests_after_selected": {"cpu_m": 6625.0, "memory_mi": 14576.0},
                }
                exporter.STATE.apply_plan_built_at = 1710397800.0
                exporter.STATE.last_apply_plan = {
                    "selected": [
                        {
                            "release": "tunarr",
                            "container": "main",
                            "current": {"requests": {"cpu": "200m", "memory": "512Mi"}},
                            "recommended": {"requests": {"cpu": "150m", "memory": "640Mi"}},
                            "selection_reason": "upsize_with_node_fit",
                        }
                    ],
                    "skipped": [],
                    "execution": {
                        "status": "created",
                        "executed_at": "2026-03-11T19:30:00Z",
                        "pr_url": "https://example.invalid/pr/1",
                    },
                }
                exporter.STATE.last_apply_md = "# apply plan\n"
                exporter.STATE.last_apply_run_at = "2026-03-11T19:30:00Z"
                exporter.STATE.apply_schedule = {
                    "schedule": "30 3 * * 1",
                    "time_zone": "Asia/Singapore",
                    "next_run_at": "2026-03-15T19:30:00Z",
                }

            metrics = exporter.build_metrics()
            payload = exporter.build_ui_payload()
            html = exporter.build_index_html()

        self.assertIn("resource_advisor_apply_preflight_generated_timestamp_seconds", metrics)
        self.assertIn("resource_advisor_apply_last_run_timestamp_seconds", metrics)
        self.assertIn("resource_advisor_apply_next_run_timestamp_seconds", metrics)
        self.assertIn("resource_advisor_apply_last_run_status", metrics)
        self.assertEqual(payload["lastApply"]["status"], "created")
        self.assertEqual(payload["schedule"]["schedule"], "30 3 * * 1")
        self.assertEqual(len(payload["applyPreflight"]["nextUp"]), 1)
        self.assertIn("last real apply run", html)
        self.assertIn("/apply-plan.json", html)


if __name__ == "__main__":
    unittest.main()
