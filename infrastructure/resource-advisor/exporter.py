#!/usr/bin/env python3
"""
resource-advisor-exporter

Expose the latest resource-advisor report (stored in a ConfigMap) as:
- Prometheus metrics at /metrics
- Raw report at /latest.json and /latest.md

This keeps the system observable in Grafana without needing to wait for PRs.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import advisor


BASE_DIR = Path(__file__).resolve().parent
INDEX_TEMPLATE_PATH = BASE_DIR / "index.html"
STATIC_ASSET_PATHS: dict[str, tuple[Path, str]] = {
    "/assets/index.css": (BASE_DIR / "index.css", "text/css; charset=utf-8"),
    "/assets/index.js": (BASE_DIR / "index.js", "application/javascript; charset=utf-8"),
}


def _utc_ts(s: str | None) -> float | None:
    if not s:
        return None
    try:
        # Advisor uses RFC3339 with "Z" suffix.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return dt.datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def _utc_iso(value: object) -> str:
    try:
        ts = float(value)
    except Exception:
        return ""
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _load_json_object(text: str, *, label: str) -> tuple[dict[str, Any] | None, str]:
    if not text:
        return None, ""
    try:
        data = json.loads(text)
    except Exception as exc:
        return None, f"Failed to parse {label}: {exc}"
    if not isinstance(data, dict):
        return None, f"{label} did not decode to a JSON object"
    return data, ""


def _parse_cron_field(field: str, minimum: int, maximum: int, *, sunday_wrap: bool = False) -> tuple[set[int], bool] | None:
    field = field.strip()
    if not field:
        return None
    wildcard = field == "*"
    values: set[int] = set()
    for segment in field.split(","):
        segment = segment.strip()
        if not segment:
            return None
        if "/" in segment:
            base, step_text = segment.split("/", 1)
            step = int(step_text)
        else:
            base = segment
            step = 1
        if step <= 0:
            return None
        if base == "*":
            start = minimum
            end = maximum
        elif "-" in base:
            start_text, end_text = base.split("-", 1)
            start = int(start_text)
            end = int(end_text)
        else:
            start = int(base)
            end = int(base)
        if sunday_wrap:
            if start == 7:
                start = 0
            if end == 7:
                end = 0
        if start < minimum or start > maximum or end < minimum or end > maximum:
            return None
        if sunday_wrap and start > end:
            values.update(range(start, maximum + 1, step))
            values.update(range(minimum, end + 1, step))
            continue
        for number in range(start, end + 1, step):
            values.add(number)
    return values, wildcard


def _parse_cron_schedule(schedule: str) -> dict[str, tuple[set[int], bool]] | None:
    parts = schedule.split()
    if len(parts) != 5:
        return None
    minute = _parse_cron_field(parts[0], 0, 59)
    hour = _parse_cron_field(parts[1], 0, 23)
    day = _parse_cron_field(parts[2], 1, 31)
    month = _parse_cron_field(parts[3], 1, 12)
    weekday = _parse_cron_field(parts[4], 0, 6, sunday_wrap=True)
    if not minute or not hour or not day or not month or not weekday:
        return None
    return {
        "minute": minute,
        "hour": hour,
        "day": day,
        "month": month,
        "weekday": weekday,
    }


def _cron_matches(parsed: dict[str, tuple[set[int], bool]] | None, when: dt.datetime) -> bool:
    if not parsed:
        return False
    minute_values, _ = parsed["minute"]
    hour_values, _ = parsed["hour"]
    day_values, day_wild = parsed["day"]
    month_values, _ = parsed["month"]
    weekday_values, weekday_wild = parsed["weekday"]

    if when.minute not in minute_values or when.hour not in hour_values or when.month not in month_values:
        return False

    cron_weekday = (when.weekday() + 1) % 7
    day_match = when.day in day_values
    weekday_match = cron_weekday in weekday_values

    if not day_wild and not weekday_wild:
        return day_match or weekday_match
    if not day_wild:
        return day_match
    if not weekday_wild:
        return weekday_match
    return True


def _next_cron_occurrence(schedule: str, timezone_name: str, *, now: dt.datetime | None = None) -> str:
    parsed = _parse_cron_schedule(schedule)
    if not parsed:
        return ""
    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = dt.timezone.utc
    cursor = (now or dt.datetime.now(zone)).astimezone(zone).replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
    for _ in range(32 * 24 * 60):
        if _cron_matches(parsed, cursor):
            return cursor.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        cursor += dt.timedelta(minutes=1)
    return ""


def _fetch_apply_schedule(kube: advisor.KubeClient, namespace: str) -> dict[str, Any]:
    cron_namespace = os.getenv("APPLY_CRONJOB_NAMESPACE", namespace).strip() or namespace
    cron_name = os.getenv("APPLY_CRONJOB_NAME", "resource-advisor-apply-pr").strip() or "resource-advisor-apply-pr"
    try:
        status, payload = kube.request_json("GET", f"/apis/batch/v1/namespaces/{cron_namespace}/cronjobs/{cron_name}")
    except Exception as exc:
        return {
            "namespace": cron_namespace,
            "name": cron_name,
            "error": f"cronjob lookup failed: {exc}",
        }
    if status != 200:
        return {
            "namespace": cron_namespace,
            "name": cron_name,
            "error": f"GET cronjob {cron_namespace}/{cron_name} failed: {status}",
        }

    spec = (payload or {}).get("spec", {}) or {}
    cron_status = (payload or {}).get("status", {}) or {}
    schedule = str(spec.get("schedule") or "")
    timezone_name = str(spec.get("timeZone") or "UTC")
    return {
        "namespace": cron_namespace,
        "name": cron_name,
        "schedule": schedule,
        "time_zone": timezone_name,
        "last_scheduled_at": str(cron_status.get("lastScheduleTime") or ""),
        "next_run_at": _next_cron_occurrence(schedule, timezone_name) if schedule else "",
    }


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.last_fetch_at: float = 0.0
        self.last_fetch_ok: bool = False
        self.last_error: str = ""
        self.report: dict[str, Any] | None = None
        self.latest_json: str = ""
        self.latest_md: str = ""
        self.mode: str = ""
        self.last_run_at: str = ""
        self.live_restart_stats: dict[str, dict[str, Any]] = {}
        self.apply_plan: dict[str, Any] | None = None
        self.apply_plan_built_at: float = 0.0
        self.last_apply_plan: dict[str, Any] | None = None
        self.last_apply_md: str = ""
        self.last_apply_run_at: str = ""
        self.apply_schedule: dict[str, Any] = {}

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "last_fetch_at": self.last_fetch_at,
                "last_fetch_ok": self.last_fetch_ok,
                "last_error": self.last_error,
                "report": self.report,
                "latest_json": self.latest_json,
                "latest_md": self.latest_md,
                "mode": self.mode,
                "last_run_at": self.last_run_at,
                "live_restart_stats": self.live_restart_stats,
                "apply_plan": self.apply_plan,
                "apply_plan_built_at": self.apply_plan_built_at,
                "last_apply_plan": self.last_apply_plan,
                "last_apply_md": self.last_apply_md,
                "last_apply_run_at": self.last_apply_run_at,
                "apply_schedule": self.apply_schedule,
            }


STATE = State()


def _rec_key(namespace: str, workload: str, container: str) -> str:
    return f"{namespace}/{workload}/{container}"


def _collect_live_restart_stats(kube: advisor.KubeClient, report: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not report:
        return {}

    recommendations = [rec for rec in (report.get("recommendations") or []) if isinstance(rec, dict)]
    namespaces = sorted({str(rec.get("namespace") or "") for rec in recommendations if rec.get("namespace")})
    if not namespaces:
        return {}

    pods_by_namespace: dict[str, list[dict[str, Any]]] = {}
    for namespace in namespaces:
        status, payload = kube.request_json("GET", f"/api/v1/namespaces/{namespace}/pods")
        if status != 200:
            pods_by_namespace[namespace] = []
            continue
        pods_by_namespace[namespace] = list((payload or {}).get("items") or [])

    stats: dict[str, dict[str, Any]] = {}
    for rec in recommendations:
        namespace = str(rec.get("namespace") or "")
        workload = str(rec.get("workload") or "")
        container = str(rec.get("container") or "")
        kind = str(rec.get("kind") or "deployment").strip().lower()
        if not namespace or not workload or not container:
            continue

        key = _rec_key(namespace, workload, container)
        if key in stats:
            continue

        kind_plural = "statefulsets" if kind == "statefulset" else "deployments"
        pod_name_re = re.compile(f"^{advisor.pod_regex_for_workload(workload, kind_plural)}$")

        current_restarts = 0
        matched_pods = 0
        newest_start_ts = 0.0

        for pod in pods_by_namespace.get(namespace, []):
            metadata = (pod.get("metadata") or {}) if isinstance(pod, dict) else {}
            status = (pod.get("status") or {}) if isinstance(pod, dict) else {}
            pod_name = str(metadata.get("name") or "")
            phase = str(status.get("phase") or "")
            if phase in ("Succeeded", "Failed"):
                continue
            if not pod_name_re.match(pod_name):
                continue

            matched_pods += 1
            start_ts = _utc_ts(str(status.get("startTime") or metadata.get("creationTimestamp") or ""))
            if start_ts:
                newest_start_ts = max(newest_start_ts, start_ts)

            for container_status in status.get("containerStatuses") or []:
                if not isinstance(container_status, dict):
                    continue
                if str(container_status.get("name") or "") != container:
                    continue
                current_restarts += int(container_status.get("restartCount") or 0)

        stats[key] = {
            "current_restarts": current_restarts,
            "matched_pods": matched_pods,
            "latest_start_ts": newest_start_ts,
        }

    return stats


def fetch_configmap_once() -> None:
    namespace = os.getenv("CONFIGMAP_NAMESPACE", "monitoring").strip() or "monitoring"
    name = os.getenv("CONFIGMAP_NAME", "resource-advisor-latest").strip() or "resource-advisor-latest"
    kube = advisor.KubeClient()
    apply_schedule = _fetch_apply_schedule(kube, namespace)

    status, payload = kube.request_json("GET", f"/api/v1/namespaces/{namespace}/configmaps/{name}")
    fetched_at = time.time()
    if status != 200:
        with STATE.lock:
            STATE.last_fetch_at = fetched_at
            STATE.last_fetch_ok = False
            STATE.last_error = f"GET configmap {namespace}/{name} failed: {status} {payload}"
            STATE.apply_schedule = apply_schedule
        return

    data = (payload or {}).get("data", {}) or {}
    latest_json = str(data.get("latest.json") or "")
    latest_md = str(data.get("latest.md") or "")
    apply_plan_json = str(data.get("apply-plan.json") or "")
    apply_plan_md = str(data.get("apply-plan.md") or "")
    apply_last_run_at = str(data.get("applyLastRunAt") or "")
    mode = str(data.get("mode") or "")
    last_run_at = str(data.get("lastRunAt") or "")

    report, report_error = _load_json_object(latest_json, label="latest.json")
    last_apply_plan, apply_error = _load_json_object(apply_plan_json, label="apply-plan.json")

    live_restart_stats = _collect_live_restart_stats(kube, report)
    apply_plan: dict[str, Any] | None = None
    if report:
        try:
            apply_plan, _ = advisor.build_apply_plan(report)
        except Exception as exc:
            advisor.log(f"Exporter failed to build apply plan snapshot: {exc}")

    apply_plan_built_at = _utc_ts(str((apply_plan or {}).get("preflight_generated_at") or "")) or fetched_at
    last_apply_execution = (last_apply_plan or {}).get("execution") if isinstance(last_apply_plan, dict) else {}
    if not apply_last_run_at and isinstance(last_apply_execution, dict):
        apply_last_run_at = str(last_apply_execution.get("executed_at") or "")
    parse_errors = [msg for msg in (report_error, apply_error) if msg]

    with STATE.lock:
        STATE.last_fetch_at = fetched_at
        STATE.last_fetch_ok = len(parse_errors) == 0
        STATE.last_error = "; ".join(parse_errors)
        STATE.report = report
        STATE.latest_json = latest_json
        STATE.latest_md = latest_md
        STATE.mode = mode
        STATE.last_run_at = last_run_at
        STATE.live_restart_stats = live_restart_stats
        STATE.apply_plan = apply_plan
        STATE.apply_plan_built_at = apply_plan_built_at
        STATE.last_apply_plan = last_apply_plan
        STATE.last_apply_md = apply_plan_md
        STATE.last_apply_run_at = apply_last_run_at
        STATE.apply_schedule = apply_schedule


def refresher_loop() -> None:
    refresh_s = float(os.getenv("REFRESH_SECONDS", "30") or "30")
    if refresh_s < 5:
        refresh_s = 5
    advisor.log(f"Exporter refresher loop starting (refresh={refresh_s}s)")
    while True:
        try:
            fetch_configmap_once()
        except Exception as exc:
            with STATE.lock:
                STATE.last_fetch_at = time.time()
                STATE.last_fetch_ok = False
                STATE.last_error = f"refresh failed: {exc}"
        time.sleep(refresh_s)


def _prom_line(name: str, labels: dict[str, str] | None, value: float) -> str:
    if labels:
        parts = []
        for k, v in sorted(labels.items()):
            v = v.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
            parts.append(f'{k}="{v}"')
        return f"{name}{{{','.join(parts)}}} {value}\n"
    return f"{name} {value}\n"


def build_metrics() -> str:
    snap = STATE.snapshot()
    report = snap["report"] or {}
    apply_plan = snap.get("apply_plan") or {}
    last_apply_plan = snap.get("last_apply_plan") or {}
    apply_schedule = snap.get("apply_schedule") or {}

    metrics: list[str] = []
    metrics.append("# HELP resource_advisor_exporter_up Exporter process is running.\n")
    metrics.append("# TYPE resource_advisor_exporter_up gauge\n")
    metrics.append(_prom_line("resource_advisor_exporter_up", None, 1.0))

    metrics.append("# HELP resource_advisor_report_fetch_success Whether the last ConfigMap fetch succeeded.\n")
    metrics.append("# TYPE resource_advisor_report_fetch_success gauge\n")
    metrics.append(_prom_line("resource_advisor_report_fetch_success", None, 1.0 if snap["last_fetch_ok"] else 0.0))

    metrics.append("# HELP resource_advisor_report_last_fetch_timestamp_seconds Unix timestamp of last ConfigMap fetch.\n")
    metrics.append("# TYPE resource_advisor_report_last_fetch_timestamp_seconds gauge\n")
    metrics.append(_prom_line("resource_advisor_report_last_fetch_timestamp_seconds", None, float(snap["last_fetch_at"] or 0.0)))

    last_run_ts = _utc_ts(str(report.get("generated_at") or snap["last_run_at"] or ""))
    if last_run_ts is not None:
        metrics.append("# HELP resource_advisor_last_run_timestamp_seconds Unix timestamp when the report was generated.\n")
        metrics.append("# TYPE resource_advisor_last_run_timestamp_seconds gauge\n")
        metrics.append(_prom_line("resource_advisor_last_run_timestamp_seconds", {"mode": str(report.get("mode") or snap["mode"] or "")}, float(last_run_ts)))

    cov = report.get("metrics_coverage_days_estimate")
    if cov is not None:
        metrics.append("# HELP resource_advisor_metrics_coverage_days Estimated Prometheus data coverage in days.\n")
        metrics.append("# TYPE resource_advisor_metrics_coverage_days gauge\n")
        metrics.append(_prom_line("resource_advisor_metrics_coverage_days", None, float(cov)))

    recs = report.get("recommendations") or []
    try:
        recs_len = float(len(recs))
    except Exception:
        recs_len = 0.0
    metrics.append("# HELP resource_advisor_recommendations_total Total recommendations in the latest report.\n")
    metrics.append("# TYPE resource_advisor_recommendations_total gauge\n")
    metrics.append(_prom_line("resource_advisor_recommendations_total", None, recs_len))

    selected = apply_plan.get("selected") if isinstance(apply_plan, dict) else None
    if isinstance(selected, list):
        metrics.append("# HELP resource_advisor_apply_plan_selected_total Changes the planner would select right now.\n")
        metrics.append("# TYPE resource_advisor_apply_plan_selected_total gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_plan_selected_total", None, float(len(selected))))
        metrics.append("# HELP resource_advisor_apply_preflight_selected_total Changes the live preflight would select right now.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_selected_total gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_preflight_selected_total", None, float(len(selected))))

    preflight_built_at = float(snap.get("apply_plan_built_at") or 0.0)
    if preflight_built_at > 0.0:
        metrics.append("# HELP resource_advisor_apply_preflight_generated_timestamp_seconds Unix timestamp when the live preflight snapshot was built.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_generated_timestamp_seconds gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_preflight_generated_timestamp_seconds", None, preflight_built_at))

    advisory_pressure = apply_plan.get("advisory_pressure") if isinstance(apply_plan, dict) else None
    if isinstance(advisory_pressure, dict):
        metrics.append("# HELP resource_advisor_apply_advisory_cpu_pressure Whether advisory CPU pressure is currently active.\n")
        metrics.append("# TYPE resource_advisor_apply_advisory_cpu_pressure gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_advisory_cpu_pressure", None, 1.0 if advisory_pressure.get("cpu") else 0.0))
        metrics.append("# HELP resource_advisor_apply_advisory_memory_pressure Whether advisory memory pressure is currently active.\n")
        metrics.append("# TYPE resource_advisor_apply_advisory_memory_pressure gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_advisory_memory_pressure", None, 1.0 if advisory_pressure.get("memory") else 0.0))

    next_up = apply_plan.get("next_up") if isinstance(apply_plan, dict) else None
    if isinstance(next_up, list):
        metrics.append("# HELP resource_advisor_apply_preflight_next_up_total Deferred candidates queued immediately after the current live selection.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_next_up_total gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_preflight_next_up_total", None, float(len(next_up))))

    if isinstance(apply_plan, dict):
        metrics.append("# HELP resource_advisor_apply_preflight_selected_by_reason Selected live-preflight candidates grouped by selection reason.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_selected_by_reason gauge\n")
        for reason, count in sorted((apply_plan.get("selected_reason_counts") or {}).items()):
            metrics.append(_prom_line("resource_advisor_apply_preflight_selected_by_reason", {"reason": str(reason)}, float(count)))

        metrics.append("# HELP resource_advisor_apply_preflight_skipped_by_reason Skipped live-preflight candidates grouped by skip reason.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_skipped_by_reason gauge\n")
        for reason, count in sorted((apply_plan.get("skipped_reason_counts") or {}).items()):
            metrics.append(_prom_line("resource_advisor_apply_preflight_skipped_by_reason", {"reason": str(reason)}, float(count)))

        metrics.append("# HELP resource_advisor_apply_preflight_node_capacity_block_total Candidates blocked by hard node allocatable capacity.\n")
        metrics.append("# TYPE resource_advisor_apply_preflight_node_capacity_block_total gauge\n")
        metrics.append(
            _prom_line(
                "resource_advisor_apply_preflight_node_capacity_block_total",
                None,
                float((apply_plan.get("skipped_reason_counts") or {}).get("node_capacity_block") or 0.0),
            )
        )

    last_apply_run_at = _utc_ts(str(snap.get("last_apply_run_at") or ((last_apply_plan.get("execution") or {}).get("executed_at") if isinstance(last_apply_plan, dict) else "") or ""))
    if last_apply_run_at is not None:
        metrics.append("# HELP resource_advisor_apply_last_run_timestamp_seconds Unix timestamp of the most recent persisted apply execution.\n")
        metrics.append("# TYPE resource_advisor_apply_last_run_timestamp_seconds gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_last_run_timestamp_seconds", None, float(last_apply_run_at)))

    next_apply_run_at = _utc_ts(str(apply_schedule.get("next_run_at") or ""))
    if next_apply_run_at is not None:
        metrics.append("# HELP resource_advisor_apply_next_run_timestamp_seconds Unix timestamp of the next scheduled apply cronjob run.\n")
        metrics.append("# TYPE resource_advisor_apply_next_run_timestamp_seconds gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_next_run_timestamp_seconds", None, float(next_apply_run_at)))

    if isinstance(last_apply_plan, dict):
        metrics.append("# HELP resource_advisor_apply_last_run_selected_total Changes selected in the most recent persisted apply execution.\n")
        metrics.append("# TYPE resource_advisor_apply_last_run_selected_total gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_last_run_selected_total", None, float(len(last_apply_plan.get("selected") or []))))

        execution = (last_apply_plan.get("execution") or {}) if isinstance(last_apply_plan.get("execution"), dict) else {}
        status = str(execution.get("status") or "")
        if status:
            metrics.append("# HELP resource_advisor_apply_last_run_status Last persisted apply execution status as a one-hot label.\n")
            metrics.append("# TYPE resource_advisor_apply_last_run_status gauge\n")
            metrics.append(_prom_line("resource_advisor_apply_last_run_status", {"status": status}, 1.0))

    by_action: dict[str, int] = {}
    for r in recs:
        if not isinstance(r, dict):
            continue
        action = str(r.get("action") or "unknown")
        by_action[action] = by_action.get(action, 0) + 1
    metrics.append("# HELP resource_advisor_recommendations_by_action Recommendations grouped by action.\n")
    metrics.append("# TYPE resource_advisor_recommendations_by_action gauge\n")
    for action, count in sorted(by_action.items()):
        metrics.append(_prom_line("resource_advisor_recommendations_by_action", {"action": action}, float(count)))

    budget = report.get("budget") or {}
    alloc = (budget.get("allocatable") or {}) if isinstance(budget, dict) else {}
    cpu_m = advisor.parse_cpu_to_m(alloc.get("cpu")) if isinstance(alloc, dict) else 0.0
    mem_mi = advisor.parse_mem_to_mi(alloc.get("memory")) if isinstance(alloc, dict) else 0.0
    metrics.append("# HELP resource_advisor_allocatable_cpu_m Cluster allocatable CPU in millicores (sum).\n")
    metrics.append("# TYPE resource_advisor_allocatable_cpu_m gauge\n")
    metrics.append(_prom_line("resource_advisor_allocatable_cpu_m", None, float(cpu_m)))
    metrics.append("# HELP resource_advisor_allocatable_memory_mi Cluster allocatable memory in MiB (sum).\n")
    metrics.append("# TYPE resource_advisor_allocatable_memory_mi gauge\n")
    metrics.append(_prom_line("resource_advisor_allocatable_memory_mi", None, float(mem_mi)))

    cur_pct = budget.get("current_requests_percent_of_allocatable") if isinstance(budget, dict) else None
    rec_pct = budget.get("recommended_requests_percent_of_allocatable") if isinstance(budget, dict) else None
    if isinstance(cur_pct, dict):
        metrics.append("# HELP resource_advisor_current_requests_percent_cpu Current CPU requests as % of allocatable.\n")
        metrics.append("# TYPE resource_advisor_current_requests_percent_cpu gauge\n")
        metrics.append(_prom_line("resource_advisor_current_requests_percent_cpu", None, float(cur_pct.get("cpu") or 0.0)))
        metrics.append("# HELP resource_advisor_current_requests_percent_memory Current memory requests as % of allocatable.\n")
        metrics.append("# TYPE resource_advisor_current_requests_percent_memory gauge\n")
        metrics.append(_prom_line("resource_advisor_current_requests_percent_memory", None, float(cur_pct.get("memory") or 0.0)))
    if isinstance(rec_pct, dict):
        metrics.append("# HELP resource_advisor_recommended_requests_percent_cpu Recommended CPU requests as % of allocatable.\n")
        metrics.append("# TYPE resource_advisor_recommended_requests_percent_cpu gauge\n")
        metrics.append(_prom_line("resource_advisor_recommended_requests_percent_cpu", None, float(rec_pct.get("cpu") or 0.0)))
        metrics.append("# HELP resource_advisor_recommended_requests_percent_memory Recommended memory requests as % of allocatable.\n")
        metrics.append("# TYPE resource_advisor_recommended_requests_percent_memory gauge\n")
        metrics.append(_prom_line("resource_advisor_recommended_requests_percent_memory", None, float(rec_pct.get("memory") or 0.0)))

    return "".join(metrics)


def _fmt_decimal(value: object, digits: int = 1) -> str:
    try:
        number = float(value)
    except Exception:
        return "n/a"
    if digits <= 0:
        return str(int(round(number)))
    text = f"{number:.{digits}f}"
    return text.rstrip("0").rstrip(".")


def _fmt_signed(value: float, suffix: str, digits: int = 1) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{_fmt_decimal(value, digits)}{suffix}"


def _with_unit_space(value: object) -> str:
    text = str(value or "")
    match = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)([A-Za-z]+)", text)
    if not match:
        return text
    return f"{match.group(1)} {match.group(2)}"


def _clamp_pct(value: object, upper: float = 100.0) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0
    return max(0.0, min(upper, number))


def _escape_attr(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def _build_overview_segment(
    label: str,
    value: str,
    subtitle: str,
    *,
    eyebrow: str = "",
    bar_pct: float = 0.0,
    tone: str = "neutral",
) -> str:
    eyebrow_html = f'<span class="overview-eyebrow">{html.escape(eyebrow)}</span>' if eyebrow else ""
    return f"""
      <section class="overview-segment">
        <div class="overview-segment-head">
          <span class="overview-label">{html.escape(label)}</span>
          {eyebrow_html}
        </div>
        <div class="overview-value">{html.escape(value)}</div>
        <div class="overview-subtitle">{html.escape(subtitle)}</div>
        <div class="overview-meter">
          <span class="overview-meter-fill {html.escape(tone)}" style="width:{_clamp_pct(bar_pct, 100.0):.1f}%"></span>
        </div>
      </section>
    """


def _build_focus_card(title: str, subtitle: str, items: list[str]) -> str:
    if not items:
        items = ["No items in this slice."]
    rows = "".join(f"<li>{item}</li>" for item in items)
    return f"""
      <article class="focus-card">
        <div class="focus-card-body">
          <div class="focus-card-title">{html.escape(title)}</div>
          <div class="focus-subtitle">{html.escape(subtitle)}</div>
          <ul class="focus-list">{rows}</ul>
        </div>
      </article>
    """


def _build_stat_pill(label: str, value: str, tone: str = "neutral") -> str:
    return (
        f'<span class="stat-pill {html.escape(tone)}"><span>{html.escape(label)}</span>'
        f"<strong>{html.escape(value)}</strong></span>"
    )


def _note_kind(note: str) -> str:
    normalized = note.strip().lower()
    if "excluded" in normalized:
        return "excluded"
    if "guard" in normalized:
        return "guarded"
    return "neutral"


def _render_note_pill(note: str, count: int | None = None) -> str:
    label = note.replace("_", " ")
    count_html = f" <strong>{count}</strong>" if count is not None else ""
    return f'<span class="note-pill {_note_kind(note)}">{html.escape(label)}{count_html}</span>'


def build_ui_payload() -> dict[str, Any]:
    snap = STATE.snapshot()
    report = snap["report"] or {}
    live_restart_stats = snap.get("live_restart_stats") or {}
    apply_plan = snap.get("apply_plan") or {}
    last_apply_plan = snap.get("last_apply_plan") or {}
    apply_schedule = snap.get("apply_schedule") or {}
    summary = report.get("summary") or {}
    policy = report.get("policy") or {}
    budget = report.get("budget") or {}
    recs = report.get("recommendations") or []

    fetch_state = "live" if snap.get("last_fetch_ok") else "degraded"
    fetch_detail = "ConfigMap fetch healthy" if snap.get("last_fetch_ok") else snap.get("last_error") or "fetch failed"

    plan_selected = [item for item in (apply_plan.get("selected") or []) if isinstance(item, dict)]
    plan_skipped = [item for item in (apply_plan.get("skipped") or []) if isinstance(item, dict)]
    plan_next_up = [item for item in (apply_plan.get("next_up") or []) if isinstance(item, dict)]
    advisory_pressure = apply_plan.get("advisory_pressure") or {}
    node_fit = apply_plan.get("node_fit") or {}
    last_apply_execution = (last_apply_plan.get("execution") or {}) if isinstance(last_apply_plan, dict) else {}
    last_apply_pull_requests = [
        item for item in (last_apply_execution.get("pull_requests") or []) if isinstance(item, dict)
    ]
    last_apply_pr_count = int(last_apply_execution.get("pr_count") or len(last_apply_pull_requests) or 0)
    if last_apply_pr_count <= 0 and last_apply_execution.get("pr_url"):
        last_apply_pr_count = 1
    last_apply_selected = [item for item in (last_apply_plan.get("selected") or []) if isinstance(item, dict)]
    last_apply_skipped = [item for item in (last_apply_plan.get("skipped") or []) if isinstance(item, dict)]

    skip_reason_counts: dict[str, int] = {}
    note_counts: dict[str, int] = {}
    rows: list[dict[str, Any]] = []
    valid_recs = [rec for rec in recs if isinstance(rec, dict)]

    for rec in valid_recs:
        namespace = str(rec.get("namespace") or "")
        workload = str(rec.get("workload") or "")
        container = str(rec.get("container") or "")
        notes = [str(note) for note in rec.get("notes") or []]
        for note in notes:
            note_counts[note] = note_counts.get(note, 0) + 1

        live_restart = live_restart_stats.get(_rec_key(namespace, workload, container)) or {}
        rows.append(
            {
                "namespace": namespace,
                "workload": workload,
                "container": container,
                "release": str(rec.get("release") or ""),
                "kind": str(rec.get("kind") or ""),
                "action": str(rec.get("action") or "unknown"),
                "notes": notes,
                "replicas": int(rec.get("replicas") or 0),
                "current": rec.get("current") or {},
                "recommended": rec.get("recommended") or {},
                "cpu_p95_m": float(rec.get("cpu_p95_m") or 0.0),
                "mem_p95_mi": float(rec.get("mem_p95_mi") or 0.0),
                "restarts_window": float(rec.get("restarts_window") or 0.0),
                "current_restarts": int(live_restart.get("current_restarts") or 0),
                "matched_pods": int(live_restart.get("matched_pods") or 0),
                "latest_start_ts": float(live_restart.get("latest_start_ts") or 0.0),
            }
        )

    for item in plan_skipped:
        reason = str(item.get("reason") or "unknown")
        skip_reason_counts[reason] = skip_reason_counts.get(reason, 0) + 1

    rows.sort(key=lambda row: (row["namespace"], row["workload"], row["container"]))
    top_notes = [
        {"note": note, "count": count}
        for note, count in sorted(note_counts.items(), key=lambda item: (-item[1], item[0]))[:8]
    ]
    skip_summary = [
        {"reason": reason, "count": count}
        for reason, count in sorted(skip_reason_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    return {
        "title": "rangoonpulse tuning",
        "fetch": {
            "state": fetch_state,
            "detail": fetch_detail,
            "lastFetchAt": snap.get("last_fetch_at") or 0.0,
            "lastFetchOk": bool(snap.get("last_fetch_ok")),
            "lastRunAt": str(report.get("generated_at") or snap.get("last_run_at") or ""),
            "mode": str(report.get("mode") or snap.get("mode") or ""),
        },
        "scope": {
            "report": "recommendation-scoped posture from the current advisor report",
            "apply": "live whole-cluster pod request footprint and current placement for apply preflight",
        },
        "report": {
            "metricsWindow": str(report.get("metrics_window") or ""),
            "metricsCoverageDaysEstimate": float(report.get("metrics_coverage_days_estimate") or 0.0),
            "summary": summary,
            "policy": policy,
            "budget": budget,
            "recommendationCount": len(valid_recs),
            "topNotes": top_notes,
            "recommendations": rows,
        },
        "applyPreflight": {
            "builtAt": _utc_iso(snap.get("apply_plan_built_at") or 0.0),
            "selectedCount": len(plan_selected),
            "selected": plan_selected,
            "nextUp": plan_next_up,
            "skipped": plan_skipped,
            "skipSummary": skip_summary,
            "selectedReasonCounts": apply_plan.get("selected_reason_counts") or {},
            "skippedReasonCounts": apply_plan.get("skipped_reason_counts") or {},
            "advisoryPressure": {
                "cpu": bool(advisory_pressure.get("cpu")),
                "memory": bool(advisory_pressure.get("memory")),
            },
            "nodeFit": node_fit,
            "hardFitOk": bool(node_fit.get("hard_fit_ok")) if isinstance(node_fit, dict) else False,
            "budgets": apply_plan.get("budgets") or {},
            "currentRequests": apply_plan.get("current_requests") or {},
            "projectedRequestsAfterSelected": apply_plan.get("projected_requests_after_selected") or {},
        },
        "lastApply": {
            "runAt": str(snap.get("last_apply_run_at") or ""),
            "status": str(last_apply_execution.get("status") or ""),
            "prCount": last_apply_pr_count,
            "selectedCount": len(last_apply_selected),
            "selected": last_apply_selected,
            "skippedCount": len(last_apply_skipped),
            "execution": last_apply_execution,
            "markdown": snap.get("last_apply_md") or "",
        },
        "schedule": {
            "schedule": str(apply_schedule.get("schedule") or ""),
            "timeZone": str(apply_schedule.get("time_zone") or ""),
            "lastScheduledAt": str(apply_schedule.get("last_scheduled_at") or ""),
            "nextRunAt": str(apply_schedule.get("next_run_at") or ""),
        },
        "runtime": {
            "latestMarkdown": snap.get("latest_md") or "",
        },
    }


def _read_ui_asset(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _render_ui_template(replacements: dict[str, object]) -> str:
    rendered = _read_ui_asset(INDEX_TEMPLATE_PATH)
    for token, value in replacements.items():
        rendered = rendered.replace(token, str(value))
    return rendered


def build_index_html() -> str:
    snap = STATE.snapshot()
    report = snap["report"] or {}
    live_restart_stats = snap.get("live_restart_stats") or {}
    apply_plan = snap.get("apply_plan") or {}
    last_apply_plan = snap.get("last_apply_plan") or {}
    apply_schedule = snap.get("apply_schedule") or {}
    title = "rangoonpulse tuning"
    last_run = str(report.get("generated_at") or snap.get("last_run_at") or "")
    mode = str(report.get("mode") or snap.get("mode") or "")
    window = str(report.get("metrics_window") or "")
    coverage_days = report.get("metrics_coverage_days_estimate")
    recs = report.get("recommendations") or []
    summary = report.get("summary") or {}
    policy = report.get("policy") or {}
    budget = report.get("budget") or {}

    md = snap.get("latest_md") or ""
    if len(md) > 120_000:
        md = md[:120_000] + "\n\n... (truncated)\n"

    fetch_state = "live" if snap.get("last_fetch_ok") else "degraded"
    fetch_detail = "ConfigMap fetch healthy" if snap.get("last_fetch_ok") else snap.get("last_error") or "fetch failed"
    report_scope_copy = "report-scoped posture from recommendation totals in the latest advisor snapshot."
    apply_scope_copy = "live apply footprint from current pod placement and whole-cluster request totals."

    rec_count = len(recs) if isinstance(recs, list) else 0
    upsize_count = int(summary.get("upsize_count") or 0)
    downsize_count = int(summary.get("downsize_count") or 0)
    no_change_count = int(summary.get("no_change_count") or 0)
    analyzed = int(summary.get("containers_analyzed") or 0)
    with_metrics = int(summary.get("containers_with_metrics") or 0)

    current_cpu_m = float(summary.get("total_current_requests_cpu_m") or 0.0)
    recommended_cpu_m = float(summary.get("total_recommended_requests_cpu_m") or 0.0)
    current_mem_mi = float(summary.get("total_current_requests_memory_mi") or 0.0)
    recommended_mem_mi = float(summary.get("total_recommended_requests_memory_mi") or 0.0)

    alloc = budget.get("allocatable") or {}
    cur_pct = budget.get("current_requests_percent_of_allocatable") or {}
    rec_pct = budget.get("recommended_requests_percent_of_allocatable") or {}
    plan_selected = [item for item in (apply_plan.get("selected") or []) if isinstance(item, dict)]
    plan_skipped = [item for item in (apply_plan.get("skipped") or []) if isinstance(item, dict)]
    plan_next_up = [item for item in (apply_plan.get("next_up") or []) if isinstance(item, dict)]
    plan_budgets = apply_plan.get("budgets") or {}
    plan_current = apply_plan.get("current_requests") or {}
    plan_projected = apply_plan.get("projected_requests_after_selected") or {}
    advisory_pressure = apply_plan.get("advisory_pressure") or {}
    node_fit = apply_plan.get("node_fit") or {}
    selected_count = len(plan_selected)
    hard_fit_ok = bool(node_fit.get("hard_fit_ok")) if isinstance(node_fit, dict) else False
    pressure_cpu = bool(advisory_pressure.get("cpu")) if isinstance(advisory_pressure, dict) else False
    pressure_mem = bool(advisory_pressure.get("memory")) if isinstance(advisory_pressure, dict) else False
    preflight_generated_at = str(apply_plan.get("preflight_generated_at") or _utc_iso(snap.get("apply_plan_built_at") or 0.0) or "")
    selected_reason_counts = apply_plan.get("selected_reason_counts") or {}

    last_apply_execution = (last_apply_plan.get("execution") or {}) if isinstance(last_apply_plan, dict) else {}
    last_apply_pull_requests = [
        item for item in (last_apply_execution.get("pull_requests") or []) if isinstance(item, dict)
    ]
    last_apply_selected = [item for item in (last_apply_plan.get("selected") or []) if isinstance(item, dict)]
    last_apply_status = str(last_apply_execution.get("status") or "")
    last_apply_run = str(snap.get("last_apply_run_at") or last_apply_execution.get("executed_at") or "")
    last_apply_selected_count = len(last_apply_selected)
    last_apply_pr_count = int(last_apply_execution.get("pr_count") or len(last_apply_pull_requests) or 0)
    if last_apply_pr_count <= 0 and last_apply_execution.get("pr_url"):
        last_apply_pr_count = 1
    next_apply_run = str(apply_schedule.get("next_run_at") or "")
    apply_schedule_label = str(apply_schedule.get("schedule") or "")
    apply_schedule_tz = str(apply_schedule.get("time_zone") or "")

    skip_reason_counts: dict[str, int] = {}
    for item in plan_skipped:
        reason = str(item.get("reason") or "unknown")
        skip_reason_counts[reason] = skip_reason_counts.get(reason, 0) + 1

    note_counts: dict[str, int] = {}
    for rec in recs:
        if not isinstance(rec, dict):
            continue
        for note in rec.get("notes") or []:
            note_counts[str(note)] = note_counts.get(str(note), 0) + 1

    top_notes = sorted(note_counts.items(), key=lambda item: (-item[1], item[0]))[:8]
    note_options = "".join(
        f'<option value="{_escape_attr(note)}">{html.escape(note)} ({count})</option>'
        for note, count in top_notes
    )

    def top_slice(items: list[dict[str, Any]], key_fn: Any, limit: int = 4) -> list[dict[str, Any]]:
        return sorted(items, key=key_fn, reverse=True)[:limit]

    valid_recs = [rec for rec in recs if isinstance(rec, dict)]

    biggest_mem = top_slice(
        valid_recs,
        lambda rec: abs(
            advisor.parse_mem_to_mi(((rec.get("recommended") or {}).get("requests") or {}).get("memory"))
            - advisor.parse_mem_to_mi(((rec.get("current") or {}).get("requests") or {}).get("memory"))
        ),
    )
    restart_guarded = [
        rec for rec in valid_recs if "restart_guard" in [str(note) for note in rec.get("notes") or []]
    ][:4]
    largest_restarts = top_slice(valid_recs, lambda rec: float(rec.get("restarts_window") or 0.0))

    def focus_line(rec: dict[str, Any], metric: str) -> str:
        ns = str(rec.get("namespace") or "default")
        workload = str(rec.get("workload") or rec.get("release") or "unknown")
        container = str(rec.get("container") or "main")
        action = str(rec.get("action") or "unknown")
        return (
            f"<span class=\"focus-path\">{html.escape(ns)}/{html.escape(workload)}</span>"
            f"<span class=\"focus-inline\">{html.escape(container)} · {html.escape(metric)} · "
            f"<span class=\"action {html.escape(action)}\">{html.escape(action)}</span></span>"
        )

    biggest_mem_items = []
    for rec in biggest_mem:
        current_mem = advisor.parse_mem_to_mi(((rec.get("current") or {}).get("requests") or {}).get("memory"))
        recommended_mem = advisor.parse_mem_to_mi(((rec.get("recommended") or {}).get("requests") or {}).get("memory"))
        delta_mem = recommended_mem - current_mem
        biggest_mem_items.append(f"{focus_line(rec, _fmt_signed(delta_mem, 'Mi'))}")

    restart_guard_items = []
    for rec in restart_guarded:
        restarts = _fmt_decimal(rec.get("restarts_window") or 0.0, 2)
        restart_guard_items.append(f"{focus_line(rec, restarts + ' historical restarts / 14d')}")

    restart_volume_items = []
    for rec in largest_restarts:
        restarts = float(rec.get("restarts_window") or 0.0)
        if restarts <= 0:
            continue
        restart_volume_items.append(f"{focus_line(rec, _fmt_decimal(restarts, 2) + ' historical restarts / 14d')}")

    table_rows: list[str] = []
    for index, rec in enumerate(valid_recs):
        action = str(rec.get("action") or "unknown")
        namespace = str(rec.get("namespace") or "")
        workload = str(rec.get("workload") or "")
        container = str(rec.get("container") or "")
        release = str(rec.get("release") or "")
        notes = [str(note) for note in rec.get("notes") or []]
        notes_text = ", ".join(notes) if notes else "—"
        notes_attr = ",".join(notes)
        notes_markup = "".join(_render_note_pill(note) for note in notes) if notes else '<span class="muted">—</span>'

        current_requests = (rec.get("current") or {}).get("requests") or {}
        recommended_requests = (rec.get("recommended") or {}).get("requests") or {}

        current_cpu = str(current_requests.get("cpu") or "0m")
        current_mem = str(current_requests.get("memory") or "0Mi")
        recommended_cpu = str(recommended_requests.get("cpu") or "0m")
        recommended_mem = str(recommended_requests.get("memory") or "0Mi")
        cpu_delta_m = advisor.parse_cpu_to_m(recommended_cpu) - advisor.parse_cpu_to_m(current_cpu)
        mem_delta_mi = advisor.parse_mem_to_mi(recommended_mem) - advisor.parse_mem_to_mi(current_mem)

        cpu_p95 = _fmt_decimal(rec.get("cpu_p95_m") or 0.0)
        mem_p95 = _fmt_decimal(rec.get("mem_p95_mi") or 0.0)
        restarts_window = float(rec.get("restarts_window") or 0.0)
        replicas = int(rec.get("replicas") or 0)
        live_restart = live_restart_stats.get(_rec_key(namespace, workload, container)) or {}
        current_restarts = int(live_restart.get("current_restarts") or 0)
        matched_pods = int(live_restart.get("matched_pods") or 0)

        search_blob = " ".join(
            [
                namespace,
                workload,
                container,
                release,
                action,
                notes_text,
                current_cpu,
                recommended_cpu,
                current_mem,
                recommended_mem,
                str(window or ""),
                str(coverage_days or ""),
            ]
        ).lower()

        table_rows.append(
            f"""
            <tr data-rec-row data-action="{_escape_attr(action)}" data-notes="{_escape_attr(notes_attr)}"
                data-search="{_escape_attr(search_blob)}" style="--row-index:{index}">
              <td>
                <div class="workload">{html.escape(workload)}</div>
                <div class="workload-meta">{html.escape(namespace)} · {html.escape(release)} · {html.escape(container)}</div>
              </td>
              <td><span class="action {html.escape(action)}">{html.escape(action)}</span></td>
              <td>
                <div class="metric-pair">
                  <span>{html.escape(_with_unit_space(current_cpu))}</span>
                  <span class="arrow">→</span>
                  <span>{html.escape(_with_unit_space(recommended_cpu))}</span>
                </div>
                <div class="metric-delta {'positive' if cpu_delta_m > 0 else 'negative' if cpu_delta_m < 0 else 'neutral'}">{html.escape(_with_unit_space(_fmt_signed(cpu_delta_m, 'm', 0)))}</div>
              </td>
              <td>
                <div class="metric-pair">
                  <span>{html.escape(_with_unit_space(current_mem))}</span>
                  <span class="arrow">→</span>
                  <span>{html.escape(_with_unit_space(recommended_mem))}</span>
                </div>
                <div class="metric-delta {'positive' if mem_delta_mi > 0 else 'negative' if mem_delta_mi < 0 else 'neutral'}">{html.escape(_with_unit_space(_fmt_signed(mem_delta_mi, 'Mi', 0)))}</div>
              </td>
              <td>
                <div class="usage-line">p95 {html.escape(_with_unit_space(f"{cpu_p95}m"))} · {html.escape(_with_unit_space(f"{mem_p95}Mi"))}</div>
                <div class="workload-meta">{html.escape(str(replicas))} replica(s)</div>
              </td>
              <td>
                <div class="usage-line">{html.escape(_with_unit_space(f"{_fmt_decimal(coverage_days)}d"))}</div>
                <div class="workload-meta">{html.escape(window or 'advisor window')}</div>
              </td>
              <td>
                <div class="usage-line">{html.escape(_fmt_decimal(restarts_window, 2))}</div>
                <div class="workload-meta">historical increase over {html.escape(window or 'advisor window')}</div>
                <div class="workload-meta">current live restarts: {html.escape(str(current_restarts))} on {html.escape(str(matched_pods))} pod(s)</div>
              </td>
              <td><div class="notes-cell">{notes_markup}</div></td>
            </tr>
            """
        )

    policy_html = "".join(
        f'<span class="token">{html.escape(label)} <strong>{html.escape(value)}</strong></span>'
        for label, value in [
            ("step", f"{_fmt_decimal(policy.get('max_step_percent'))}%"),
            ("req buffer", f"{_fmt_decimal(policy.get('request_buffer_percent'))}%"),
            ("limit buffer", f"{_fmt_decimal(policy.get('limit_buffer_percent'))}%"),
            ("deadband", f"{_fmt_decimal(policy.get('deadband_percent'))}%"),
            ("cpu floor", f"{_fmt_decimal(policy.get('deadband_cpu_m'))}m"),
            ("mem floor", f"{_fmt_decimal(policy.get('deadband_mem_mi'))}Mi"),
        ]
    )

    note_html = "".join(_render_note_pill(note, count) for note, count in top_notes) or '<span class="muted">no note annotations in current report.</span>'

    def planner_line(item: dict[str, Any], *, reason_key: str = "selection_reason") -> str:
        release = str(item.get("release") or "unknown")
        container = str(item.get("container") or "main")
        current_req = (item.get("current") or {}).get("requests") or {}
        recommended_req = (item.get("recommended") or {}).get("requests") or {}
        cpu_line = f"{_with_unit_space(current_req.get('cpu') or '0m')} → {_with_unit_space(recommended_req.get('cpu') or '0m')}"
        mem_line = f"{_with_unit_space(current_req.get('memory') or '0Mi')} → {_with_unit_space(recommended_req.get('memory') or '0Mi')}"
        reason = str(item.get(reason_key) or "selected")
        return (
            f"<span class=\"focus-path\">{html.escape(release)}/{html.escape(container)}</span>"
            f"<span class=\"focus-inline\">cpu {html.escape(cpu_line)} · mem {html.escape(mem_line)} · {html.escape(reason.replace('_', ' '))}</span>"
        )

    planner_selected_items = [planner_line(item) for item in plan_selected[:5]]
    next_up_items = [planner_line(item, reason_key="queue_reason") for item in plan_next_up[:5]]
    last_apply_items = [planner_line(item) for item in last_apply_selected[:5]]

    pressure_pills = "".join(
        [
            _build_stat_pill("selected now", str(selected_count), "neutral"),
            _build_stat_pill("hard fit", "ok" if hard_fit_ok else "blocked", "ok" if hard_fit_ok else "excluded"),
            _build_stat_pill("cpu pressure", "on" if pressure_cpu else "off", "guarded" if pressure_cpu else "ok"),
            _build_stat_pill("mem pressure", "on" if pressure_mem else "off", "guarded" if pressure_mem else "ok"),
        ]
    )
    last_apply_pills = "".join(
        [
            _build_stat_pill("status", last_apply_status.replace("_", " ") or "no run", "ok" if last_apply_status in {"created", "updated", "no_selected_changes", "no_repo_changes"} else "guarded" if last_apply_status else "neutral"),
            _build_stat_pill("selected", str(last_apply_selected_count), "neutral"),
            _build_stat_pill("prs", str(last_apply_pr_count), "neutral"),
            _build_stat_pill("next run", "scheduled" if next_apply_run else "unknown", "ok" if next_apply_run else "guarded"),
        ]
    )

    last_apply_pr_links = []
    for item in last_apply_pull_requests[:5]:
        url = str(item.get("pr_url") or "").strip()
        release = str(item.get("release") or "service")
        status = str(item.get("status") or "unknown").replace("_", " ")
        if not url:
            continue
        last_apply_pr_links.append(
            f'<a href="{_escape_attr(url)}">{html.escape(release)}</a> ({html.escape(status)})'
        )
    if not last_apply_pr_links and last_apply_execution.get("pr_url"):
        url = str(last_apply_execution.get("pr_url") or "").strip()
        last_apply_pr_links.append(f'<a href="{_escape_attr(url)}">{html.escape(url)}</a>')
    pr_copy = ""
    if last_apply_pr_links:
        suffix = ""
        if len(last_apply_pull_requests) > len(last_apply_pr_links):
            suffix = f" +{len(last_apply_pull_requests) - len(last_apply_pr_links)} more"
        pr_copy = " · prs " + ", ".join(last_apply_pr_links) + suffix

    current_plan_cpu = _with_unit_space(f"{_fmt_decimal(plan_current.get('cpu_m'))}m")
    current_plan_mem = _with_unit_space(f"{_fmt_decimal(plan_current.get('memory_mi'))}Mi")
    projected_plan_cpu = _with_unit_space(f"{_fmt_decimal(plan_projected.get('cpu_m'))}m")
    projected_plan_mem = _with_unit_space(f"{_fmt_decimal(plan_projected.get('memory_mi'))}Mi")
    advisory_plan_cpu = _with_unit_space(f"{_fmt_decimal(plan_budgets.get('cpu_m'))}m")
    advisory_plan_mem = _with_unit_space(f"{_fmt_decimal(plan_budgets.get('memory_mi'))}Mi")

    posture_items = [
        f"<span class=\"focus-path\">current requests</span><span class=\"focus-inline\">cpu {html.escape(current_plan_cpu)} · mem {html.escape(current_plan_mem)}</span>",
        f"<span class=\"focus-path\">projected after selection</span><span class=\"focus-inline\">cpu {html.escape(projected_plan_cpu)} · mem {html.escape(projected_plan_mem)}</span>",
        f"<span class=\"focus-path\">advisory ceilings</span><span class=\"focus-inline\">cpu {html.escape(advisory_plan_cpu)} · mem {html.escape(advisory_plan_mem)}</span>",
    ] if apply_plan else []
    report_posture_items = [
        f"<span class=\"focus-path\">current report posture</span><span class=\"focus-inline\">cpu {html.escape(_fmt_decimal(cur_pct.get('cpu')))}% · mem {html.escape(_fmt_decimal(cur_pct.get('memory')))}% of allocatable</span>",
        f"<span class=\"focus-path\">recommended report posture</span><span class=\"focus-inline\">cpu {html.escape(_fmt_decimal(rec_pct.get('cpu')))}% · mem {html.escape(_fmt_decimal(rec_pct.get('memory')))}% of allocatable</span>",
        f"<span class=\"focus-path\">coverage maturity</span><span class=\"focus-inline\">{html.escape(_with_unit_space(f'{_fmt_decimal(coverage_days)}d'))} over {html.escape(window or 'advisor window')}</span>",
    ]
    selected_reason_items = [
        f"<span class=\"focus-path\">{html.escape(reason.replace('_', ' '))}</span><span class=\"focus-inline\">{count} row(s)</span>"
        for reason, count in sorted(selected_reason_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    skip_summary_items = [
        f"<span class=\"focus-path\">{html.escape(reason.replace('_', ' '))}</span><span class=\"focus-inline\">{count} row(s)</span>"
        for reason, count in sorted(skip_reason_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
    ]

    try:
        window_days = float(str(window).rstrip("d")) if str(window).endswith("d") else 0.0
    except Exception:
        window_days = 0.0
    coverage_pct = (float(coverage_days or 0.0) / window_days * 100.0) if window_days > 0 else 0.0

    overview_html = "".join(
        [
            _build_overview_segment(
                "recommendations",
                str(rec_count),
                f"{upsize_count} upsize, {downsize_count} downsize, {no_change_count} steady",
                eyebrow="report scope",
                bar_pct=(with_metrics / analyzed * 100.0) if analyzed else 0.0,
                tone="neutral",
            ),
            _build_overview_segment(
                "report cpu posture",
                _with_unit_space(f"{_fmt_decimal(current_cpu_m)}m"),
                f"{_fmt_decimal(cur_pct.get('cpu'))}% of {_with_unit_space(alloc.get('cpu') or 'n/a')} allocatable",
                eyebrow=_with_unit_space(_fmt_signed(recommended_cpu_m - current_cpu_m, "m", 0)),
                bar_pct=float(cur_pct.get("cpu") or 0.0),
                tone="cpu",
            ),
            _build_overview_segment(
                "report memory posture",
                _with_unit_space(f"{_fmt_decimal(current_mem_mi)}Mi"),
                f"{_fmt_decimal(cur_pct.get('memory'))}% of {_with_unit_space(alloc.get('memory') or 'n/a')} allocatable",
                eyebrow=_with_unit_space(_fmt_signed(recommended_mem_mi - current_mem_mi, "Mi", 0)),
                bar_pct=float(cur_pct.get("memory") or 0.0),
                tone="memory",
            ),
            _build_overview_segment(
                "live apply preflight",
                f"{selected_count} selected" if apply_plan else "pending",
                (
                    f"hard fit {'ok' if hard_fit_ok else 'blocked'} · "
                    f"cpu pressure {'on' if pressure_cpu else 'off'}"
                    if apply_plan
                    else "waiting for planner snapshot"
                ),
                eyebrow="apply scope",
                bar_pct=(selected_count / max(1, rec_count) * 100.0) if apply_plan else (100.0 if fetch_state == "live" else coverage_pct),
                tone="status" if apply_plan and hard_fit_ok else "warning" if apply_plan else ("status" if fetch_state == "live" else "warning"),
            ),
        ]
    )

    planner_cards = f"""
      <article class="support-card">
        <div class="support-card-title">live preflight</div>
        <div class="policy-grid">{pressure_pills}</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in planner_selected_items) if planner_selected_items else '<li><span class="muted">no changes would be selected from the current report.</span></li>'}</ul>
        <p class="support-copy">built <span class="time-local" data-utc="{_escape_attr(preflight_generated_at)}">{html.escape(preflight_generated_at or 'n/a')}</span>. selection uses per-service tuning signals, hard node-fit blocking, and advisory cluster pressure for ordering only.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">live apply footprint</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in posture_items) if posture_items else '<li><span class="muted">planner snapshot unavailable.</span></li>'}</ul>
        <p class="support-copy">{html.escape(apply_scope_copy)}</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">next up queue</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in next_up_items) if next_up_items else '<li><span class="muted">no deferred candidates are waiting behind the current change limit.</span></li>'}</ul>
        <p class="support-copy">the next candidates that would be considered if more apply slots were allowed in the current live preflight.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">last real apply run</div>
        <div class="policy-grid">{last_apply_pills}</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in last_apply_items) if last_apply_items else '<li><span class="muted">no persisted apply execution has been recorded yet.</span></li>'}</ul>
        <p class="support-copy">last run <span class="time-local" data-utc="{_escape_attr(last_apply_run)}">{html.escape(last_apply_run or 'n/a')}</span>{pr_copy}. next scheduled apply <span class="time-local" data-utc="{_escape_attr(next_apply_run)}">{html.escape(next_apply_run or 'n/a')}</span>.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">skip summary</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in skip_summary_items) if skip_summary_items else '<li><span class="muted">no skipped rows in current planner snapshot.</span></li>'}</ul>
        <p class="support-copy">current reasons rows were deferred from the live apply selection order.</p>
      </article>
    """

    support_cards = f"""
      <article class="support-card">
        <div class="support-card-title">report-scoped posture</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in report_posture_items)}</ul>
        <p class="support-copy">{html.escape(report_scope_copy)}</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">policy guardrails</div>
        <div class="policy-grid">{policy_html}</div>
        <p class="support-copy">active tuning bounds applied to each report and apply pass.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">common notes</div>
        <div class="policy-grid">{note_html}</div>
        <p class="support-copy">most common skip reasons and advisory annotations in the current window.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">selection reasons</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in selected_reason_items) if selected_reason_items else '<li><span class="muted">no live preflight selections in the current snapshot.</span></li>'}</ul>
        <p class="support-copy">why the current live preflight chose the rows it did.</p>
      </article>
    """

    status_copy = (
        "Per-service tuning view with report-scoped advisor posture, live apply preflight footprint, and persisted apply execution artifacts."
        if report
        else "No parsed report is currently available from the runtime ConfigMap."
    )

    runtime_lines = [line.strip() for line in md.splitlines() if line.strip()][:18]
    runtime_html = "".join(
        f"""
        <div class="log-line">
          <span class="log-time">[{index + 1:02d}]</span>
          <span class="log-level {'log-info' if index < 4 else 'log-muted'}">{'info' if index < 4 else 'data'}</span>
          <span>{html.escape(line)}</span>
        </div>
        """
        for index, line in enumerate(runtime_lines)
    )
    if not runtime_html:
        runtime_html = """
        <div class="log-line">
          <span class="log-time">[00]</span>
          <span class="log-level log-muted">data</span>
          <span>no report markdown found in configmap.</span>
        </div>
        """

    return _render_ui_template({
        "__PLACEHOLDER_01__": html.escape(title),
        "__PLACEHOLDER_02__": html.escape(status_copy),
        "__PLACEHOLDER_03__": html.escape(window or "report"),
        "__PLACEHOLDER_04__": overview_html,
        "__PLACEHOLDER_05__": _escape_attr(last_run),
        "__PLACEHOLDER_06__": html.escape(last_run or "n/a"),
        "__PLACEHOLDER_07__": _escape_attr(last_apply_run),
        "__PLACEHOLDER_08__": html.escape(last_apply_run or "n/a"),
        "__PLACEHOLDER_09__": _escape_attr(next_apply_run),
        "__PLACEHOLDER_10__": html.escape(next_apply_run or "n/a"),
        "__PLACEHOLDER_11__": html.escape(mode or "n/a"),
        "__PLACEHOLDER_12__": html.escape(_with_unit_space(alloc.get("cpu") or "n/a")),
        "__PLACEHOLDER_13__": html.escape(_with_unit_space(alloc.get("memory") or "n/a")),
        "__PLACEHOLDER_14__": html.escape(fetch_detail),
        "__PLACEHOLDER_15__": html.escape(apply_schedule_label or "n/a"),
        "__PLACEHOLDER_16__": html.escape(apply_schedule_tz or ""),
        "__PLACEHOLDER_17__": planner_cards,
        "__PLACEHOLDER_18__": note_options,
        "__PLACEHOLDER_19__": rec_count,
        "__PLACEHOLDER_20__": "".join(table_rows),
        "__PLACEHOLDER_21__": html.escape(_with_unit_space(f"{_fmt_decimal(coverage_days)}d")),
        "__PLACEHOLDER_22__": _build_focus_card(
            "largest memory shifts",
            "absolute request-memory deltas across all recommendations.",
            biggest_mem_items,
        ),
        "__PLACEHOLDER_23__": _build_focus_card(
            "restart-guarded items",
            "rows where historical restart activity is directly influencing the advice.",
            restart_guard_items,
        ),
        "__PLACEHOLDER_24__": _build_focus_card(
            "highest restart volume",
            "most restart-heavy rows in the historical 14d advisor window.",
            restart_volume_items,
        ),
        "__PLACEHOLDER_25__": rec_count,
        "__PLACEHOLDER_26__": support_cards,
        "__PLACEHOLDER_27__": html.escape(fetch_detail),
        "__PLACEHOLDER_28__": runtime_html,
    })


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, content_type: str, body: bytes, *, include_body: bool = True) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _resolve_response(self) -> tuple[int, str, bytes]:
        path = (self.path or "").split("?", 1)[0]
        if path == "/healthz":
            return 200, "text/plain; charset=utf-8", b"ok\n"
        asset = STATIC_ASSET_PATHS.get(path)
        if asset:
            asset_path, content_type = asset
            return 200, content_type, _read_ui_asset(asset_path).encode("utf-8")
        if path == "/metrics":
            out = build_metrics().encode("utf-8")
            return 200, "text/plain; version=0.0.4; charset=utf-8", out
        if path == "/api/ui.json":
            body = json.dumps(build_ui_payload(), separators=(",", ":")).encode("utf-8")
            return 200, "application/json; charset=utf-8", body
        if path == "/latest.json":
            snap = STATE.snapshot()
            body = (snap.get("latest_json") or "{}").encode("utf-8")
            return 200, "application/json; charset=utf-8", body
        if path == "/latest.md":
            snap = STATE.snapshot()
            body = (snap.get("latest_md") or "").encode("utf-8")
            return 200, "text/markdown; charset=utf-8", body
        if path == "/apply-plan.json":
            snap = STATE.snapshot()
            body = json.dumps(snap.get("last_apply_plan") or {}, separators=(",", ":")).encode("utf-8")
            return 200, "application/json; charset=utf-8", body
        if path == "/apply-plan.md":
            snap = STATE.snapshot()
            body = (snap.get("last_apply_md") or "").encode("utf-8")
            return 200, "text/markdown; charset=utf-8", body
        if path == "/" or path == "":
            body = build_index_html().encode("utf-8")
            return 200, "text/html; charset=utf-8", body
        return 404, "text/plain; charset=utf-8", b"not found\n"

    def do_GET(self) -> None:  # noqa: N802
        code, content_type, body = self._resolve_response()
        self._send(code, content_type, body)

    def do_HEAD(self) -> None:  # noqa: N802
        code, content_type, body = self._resolve_response()
        self._send(code, content_type, body, include_body=False)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: ANN401
        # Keep logs quiet; Kubernetes will still have readiness/liveness probes.
        advisor.log(f"exporter: {self.address_string()} {fmt % args}")


def main() -> int:
    listen = os.getenv("LISTEN_ADDR", "0.0.0.0").strip() or "0.0.0.0"
    port = int(os.getenv("PORT", "8081") or "8081")

    # Prime cache once before serving.
    try:
        fetch_configmap_once()
    except Exception as exc:
        advisor.log(f"Initial fetch failed: {exc}")

    t = threading.Thread(target=refresher_loop, daemon=True)
    t.start()

    server = HTTPServer((listen, port), Handler)
    advisor.log(f"resource-advisor-exporter listening on {listen}:{port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
