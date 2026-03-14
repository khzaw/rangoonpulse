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
from typing import Any

import advisor


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

    status, payload = kube.request_json("GET", f"/api/v1/namespaces/{namespace}/configmaps/{name}")
    fetched_at = time.time()
    if status != 200:
        with STATE.lock:
            STATE.last_fetch_at = fetched_at
            STATE.last_fetch_ok = False
            STATE.last_error = f"GET configmap {namespace}/{name} failed: {status} {payload}"
        return

    data = (payload or {}).get("data", {}) or {}
    latest_json = str(data.get("latest.json") or "")
    latest_md = str(data.get("latest.md") or "")
    mode = str(data.get("mode") or "")
    last_run_at = str(data.get("lastRunAt") or "")

    report: dict[str, Any] | None = None
    if latest_json:
        try:
            report = json.loads(latest_json)
        except Exception as exc:
            with STATE.lock:
                STATE.last_fetch_at = fetched_at
                STATE.last_fetch_ok = False
                STATE.last_error = f"Failed to parse latest.json: {exc}"
            return

    live_restart_stats = _collect_live_restart_stats(kube, report)
    apply_plan: dict[str, Any] | None = None
    if report:
        try:
            apply_plan, _ = advisor.build_apply_plan(report)
        except Exception as exc:
            advisor.log(f"Exporter failed to build apply plan snapshot: {exc}")

    with STATE.lock:
        STATE.last_fetch_at = fetched_at
        STATE.last_fetch_ok = True
        STATE.last_error = ""
        STATE.report = report
        STATE.latest_json = latest_json
        STATE.latest_md = latest_md
        STATE.mode = mode
        STATE.last_run_at = last_run_at
        STATE.live_restart_stats = live_restart_stats
        STATE.apply_plan = apply_plan


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

    advisory_pressure = apply_plan.get("advisory_pressure") if isinstance(apply_plan, dict) else None
    if isinstance(advisory_pressure, dict):
        metrics.append("# HELP resource_advisor_apply_advisory_cpu_pressure Whether advisory CPU pressure is currently active.\n")
        metrics.append("# TYPE resource_advisor_apply_advisory_cpu_pressure gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_advisory_cpu_pressure", None, 1.0 if advisory_pressure.get("cpu") else 0.0))
        metrics.append("# HELP resource_advisor_apply_advisory_memory_pressure Whether advisory memory pressure is currently active.\n")
        metrics.append("# TYPE resource_advisor_apply_advisory_memory_pressure gauge\n")
        metrics.append(_prom_line("resource_advisor_apply_advisory_memory_pressure", None, 1.0 if advisory_pressure.get("memory") else 0.0))

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
    summary = report.get("summary") or {}
    policy = report.get("policy") or {}
    budget = report.get("budget") or {}
    recs = report.get("recommendations") or []

    fetch_state = "live" if snap.get("last_fetch_ok") else "degraded"
    fetch_detail = "ConfigMap fetch healthy" if snap.get("last_fetch_ok") else snap.get("last_error") or "fetch failed"

    plan_selected = [item for item in (apply_plan.get("selected") or []) if isinstance(item, dict)]
    plan_skipped = [item for item in (apply_plan.get("skipped") or []) if isinstance(item, dict)]
    advisory_pressure = apply_plan.get("advisory_pressure") or {}
    node_fit = apply_plan.get("node_fit") or {}

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
            "selectedCount": len(plan_selected),
            "selected": plan_selected,
            "skipped": plan_skipped,
            "skipSummary": skip_summary,
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
        "runtime": {
            "latestMarkdown": snap.get("latest_md") or "",
        },
    }


def build_index_html() -> str:
    snap = STATE.snapshot()
    report = snap["report"] or {}
    live_restart_stats = snap.get("live_restart_stats") or {}
    apply_plan = snap.get("apply_plan") or {}
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
    plan_budgets = apply_plan.get("budgets") or {}
    plan_current = apply_plan.get("current_requests") or {}
    plan_projected = apply_plan.get("projected_requests_after_selected") or {}
    advisory_pressure = apply_plan.get("advisory_pressure") or {}
    node_fit = apply_plan.get("node_fit") or {}
    selected_count = len(plan_selected)
    hard_fit_ok = bool(node_fit.get("hard_fit_ok")) if isinstance(node_fit, dict) else False
    pressure_cpu = bool(advisory_pressure.get("cpu")) if isinstance(advisory_pressure, dict) else False
    pressure_mem = bool(advisory_pressure.get("memory")) if isinstance(advisory_pressure, dict) else False

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

    def planner_line(item: dict[str, Any]) -> str:
        release = str(item.get("release") or "unknown")
        container = str(item.get("container") or "main")
        current_req = (item.get("current") or {}).get("requests") or {}
        recommended_req = (item.get("recommended") or {}).get("requests") or {}
        cpu_line = f"{_with_unit_space(current_req.get('cpu') or '0m')} → {_with_unit_space(recommended_req.get('cpu') or '0m')}"
        mem_line = f"{_with_unit_space(current_req.get('memory') or '0Mi')} → {_with_unit_space(recommended_req.get('memory') or '0Mi')}"
        reason = str(item.get("selection_reason") or "selected")
        return (
            f"<span class=\"focus-path\">{html.escape(release)}/{html.escape(container)}</span>"
            f"<span class=\"focus-inline\">cpu {html.escape(cpu_line)} · mem {html.escape(mem_line)} · {html.escape(reason.replace('_', ' '))}</span>"
        )

    planner_selected_items = [planner_line(item) for item in plan_selected[:5]]

    pressure_pills = "".join(
        [
            _build_stat_pill("selected now", str(selected_count), "neutral"),
            _build_stat_pill("hard fit", "ok" if hard_fit_ok else "blocked", "ok" if hard_fit_ok else "excluded"),
            _build_stat_pill("cpu pressure", "on" if pressure_cpu else "off", "guarded" if pressure_cpu else "ok"),
            _build_stat_pill("mem pressure", "on" if pressure_mem else "off", "guarded" if pressure_mem else "ok"),
        ]
    )

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
                eyebrow=f"{with_metrics}/{analyzed} with metrics" if analyzed else "",
                bar_pct=(with_metrics / analyzed * 100.0) if analyzed else 0.0,
                tone="neutral",
            ),
            _build_overview_segment(
                "cpu request posture",
                _with_unit_space(f"{_fmt_decimal(current_cpu_m)}m"),
                f"{_fmt_decimal(cur_pct.get('cpu'))}% of {_with_unit_space(alloc.get('cpu') or 'n/a')} allocatable",
                eyebrow=_with_unit_space(_fmt_signed(recommended_cpu_m - current_cpu_m, "m", 0)),
                bar_pct=float(cur_pct.get("cpu") or 0.0),
                tone="cpu",
            ),
            _build_overview_segment(
                "memory request posture",
                _with_unit_space(f"{_fmt_decimal(current_mem_mi)}Mi"),
                f"{_fmt_decimal(cur_pct.get('memory'))}% of {_with_unit_space(alloc.get('memory') or 'n/a')} allocatable",
                eyebrow=_with_unit_space(_fmt_signed(recommended_mem_mi - current_mem_mi, "Mi", 0)),
                bar_pct=float(cur_pct.get("memory") or 0.0),
                tone="memory",
            ),
            _build_overview_segment(
                "planner",
                f"{selected_count} selected" if apply_plan else "pending",
                (
                    f"hard fit {'ok' if hard_fit_ok else 'blocked'} · "
                    f"cpu pressure {'on' if pressure_cpu else 'off'}"
                    if apply_plan
                    else "waiting for planner snapshot"
                ),
                eyebrow="apply preflight",
                bar_pct=(selected_count / max(1, rec_count) * 100.0) if apply_plan else (100.0 if fetch_state == "live" else coverage_pct),
                tone="status" if apply_plan and hard_fit_ok else "warning" if apply_plan else ("status" if fetch_state == "live" else "warning"),
            ),
        ]
    )

    planner_cards = f"""
      <article class="support-card">
        <div class="support-card-title">if apply ran now</div>
        <div class="policy-grid">{pressure_pills}</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in planner_selected_items) if planner_selected_items else '<li><span class="muted">no changes would be selected from the current report.</span></li>'}</ul>
        <p class="support-copy">selection uses per-service tuning signals, hard node-fit blocking, and advisory cluster pressure for ordering only.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">planner posture</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in posture_items) if posture_items else '<li><span class="muted">planner snapshot unavailable.</span></li>'}</ul>
        <p class="support-copy">global cpu and memory remain visible as advisory ceilings, but they no longer hard-freeze safe right-sizing changes.</p>
      </article>
      <article class="support-card">
        <div class="support-card-title">skip summary</div>
        <ul class="focus-list planner-list">{''.join(f'<li>{item}</li>' for item in skip_summary_items) if skip_summary_items else '<li><span class="muted">no skipped rows in current planner snapshot.</span></li>'}</ul>
        <p class="support-copy">current reasons rows were deferred from the live apply selection order.</p>
      </article>
    """

    support_cards = f"""
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
    """

    status_copy = (
        "Per-service tuning view from the runtime-owned advisor report, with hard node-fit blocking and advisory cluster posture."
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

    html_doc = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(title)}</title>
    <style>
      :root {{
        --bg-base: #0c0c0c;
        --bg-surface: #141414;
        --bg-surface-soft: #121212;
        --bg-hover: rgba(255, 255, 255, 0.028);
        --text-primary: #e8e8e8;
        --text-secondary: #888888;
        --text-tertiary: #555555;
        --text-dim: #6b6b6b;
        --border-subtle: rgba(255, 255, 255, 0.07);
        --border-active: rgba(255, 255, 255, 0.14);
        --accent-soft: #79b8ff;
        --warn: #d29922;
        --danger: #f85149;
        --success: #3fb950;
        --font-sans: system-ui, -apple-system, sans-serif;
        --font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
        --radius-sm: 2px;
        --radius-md: 10px;
      }}
      * {{
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }}
      html {{
        min-height: 100%;
        background: var(--bg-base);
      }}
      body {{
        min-height: 100vh;
        background:
          radial-gradient(1200px 600px at 8% -20%, rgba(121, 184, 255, 0.08), transparent 56%),
          radial-gradient(1000px 520px at 92% -30%, rgba(63, 185, 80, 0.07), transparent 62%),
          linear-gradient(180deg, #0b0b0b 0%, var(--bg-base) 46%, #0b0b0b 100%);
        background-repeat: no-repeat;
        background-size: 100vw 100vh, 100vw 100vh, 100vw 100vh;
        background-attachment: fixed, fixed, fixed;
        color: var(--text-primary);
        font-family: var(--font-sans);
        font-size: 13px;
        line-height: 1.5;
      }}
      a {{
        color: inherit;
        text-decoration: none;
      }}
      .topbar {{
        position: sticky;
        top: 0;
        z-index: 10;
        border-bottom: 1px solid var(--border-subtle);
        background: rgba(11, 11, 11, 0.9);
        backdrop-filter: blur(8px);
      }}
      .topbar-inner {{
        max-width: 1360px;
        margin: 0 auto;
        padding: 14px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }}
      .crumbs,
      .top-actions {{
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }}
      .brand-mark {{
        width: 22px;
        height: 22px;
        border-radius: 999px;
        border: 1px solid var(--border-active);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: var(--text-primary);
      }}
      .crumb-separator,
      .crumb-subtle {{
        color: var(--text-tertiary);
        font-family: var(--font-mono);
      }}
      .crumb-label {{
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 500;
      }}
      .env-pill,
      .top-button,
      .filter-btn,
      .control-select,
      .search-shell {{
        border: 1px solid var(--border-active);
        border-radius: 3px;
        background: transparent;
        color: var(--text-secondary);
      }}
      .env-pill {{
        padding: 4px 9px;
        font-size: 11px;
        font-family: var(--font-mono);
      }}
      .top-button {{
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
        transition:
          color 0.15s linear,
          border-color 0.15s linear,
          transform 0.18s ease,
          background-color 0.18s ease,
          box-shadow 0.18s ease;
      }}
      .top-button:hover,
      .filter-btn:hover,
      .control-select:hover,
      .search-shell:focus-within {{
        color: var(--text-primary);
        border-color: var(--border-active);
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.03);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
      }}
      .primary-button {{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 500;
        border: 1px solid rgba(121, 184, 255, 0.45);
        border-radius: 3px;
        color: var(--text-primary);
        background: rgba(121, 184, 255, 0.12);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
      }}
      .primary-button:hover {{
        transform: translateY(-1px);
        background: rgba(121, 184, 255, 0.16);
      }}
      main {{
        max-width: 1360px;
        margin: 0 auto;
        padding: 52px 24px 72px;
        display: flex;
        flex-direction: column;
        gap: 42px;
      }}
      .section {{
        display: flex;
        flex-direction: column;
        gap: 18px;
      }}
      .section-bar {{
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border-subtle);
      }}
      .section-heading {{
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 500;
      }}
      .section-copy,
      .section-note,
      .section-detail,
      .overview-meta,
      .support-copy,
      .focus-subtitle,
      .workload-meta,
      .usage-line,
      .notes-cell,
      .metric-delta {{
        color: var(--text-tertiary);
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.7;
      }}
      .section-note,
      .overview-meta {{
        letter-spacing: 0.08em;
      }}
      .overview-strip,
      .table-shell,
      .focus-card,
      .support-card,
      .terminal-shell {{
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0.005));
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
      }}
      .overview-strip {{
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        overflow: hidden;
      }}
      .overview-segment {{
        min-height: 166px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        border-right: 1px solid var(--border-subtle);
      }}
      .overview-segment:last-child {{
        border-right: none;
      }}
      .overview-segment-head {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }}
      .overview-label,
      .overview-eyebrow {{
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .overview-label {{
        color: var(--text-secondary);
      }}
      .overview-eyebrow {{
        color: var(--text-tertiary);
      }}
      .overview-value {{
        color: var(--text-primary);
        font-size: 19px;
        font-weight: 300;
        letter-spacing: -0.03em;
      }}
      .overview-subtitle {{
        color: var(--text-secondary);
        font-size: 12px;
        max-width: 28ch;
      }}
      .overview-meter {{
        margin-top: auto;
        height: 2px;
        background: rgba(255, 255, 255, 0.08);
        position: relative;
        overflow: hidden;
      }}
      .overview-meter-fill {{
        position: absolute;
        inset: 0 auto 0 0;
        background: rgba(255, 255, 255, 0.8);
      }}
      .overview-meter-fill.cpu {{
        background: rgba(255, 255, 255, 0.75);
      }}
      .overview-meter-fill.memory {{
        background: rgba(244, 181, 45, 0.92);
      }}
      .overview-meter-fill.status {{
        background: rgba(56, 211, 159, 0.9);
      }}
      .overview-meter-fill.warning {{
        background: rgba(251, 113, 133, 0.9);
      }}
      .overview-meta-row {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        flex-wrap: wrap;
      }}
      .overview-meta-cluster {{
        display: flex;
        align-items: center;
        gap: 18px;
        flex-wrap: wrap;
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .overview-meta-cluster strong {{
        color: var(--text-primary);
        font-weight: 500;
      }}
      .toolbar {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }}
      .toolbar-left,
      .toolbar-right,
      .filter-group {{
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }}
      .filter-btn,
      .control-select {{
        padding: 5px 12px;
        font-size: 12px;
      }}
      .filter-btn.active {{
        color: var(--text-primary);
        border-color: rgba(121, 184, 255, 0.45);
        background: rgba(121, 184, 255, 0.12);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
      }}
      .control-select {{
        background: var(--bg-surface-soft);
        color: var(--text-primary);
        font-family: var(--font-mono);
      }}
      .search-shell {{
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 10px;
        min-width: 320px;
        background: var(--bg-surface-soft);
      }}
      .input-prefix {{
        color: var(--text-tertiary);
        font-family: var(--font-mono);
      }}
      .search-shell input {{
        width: 100%;
        border: none;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 12px;
      }}
      .search-shell input::placeholder {{
        color: var(--text-tertiary);
      }}
      .result-count {{
        color: var(--text-tertiary);
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .table-shell {{
        overflow: hidden;
        border-radius: 10px;
      }}
      table {{
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        text-align: left;
        table-layout: auto;
      }}
      th,
      td {{
        padding: 14px 22px;
        border-bottom: 1px solid var(--border-subtle);
        vertical-align: top;
        background: transparent;
      }}
      th {{
        color: var(--text-secondary);
        font-size: 11px;
        font-weight: 400;
        letter-spacing: 0.08em;
        font-family: var(--font-mono);
        background: rgba(12, 12, 12, 0.88);
        backdrop-filter: blur(4px);
      }}
      tr:last-child td {{
        border-bottom: none;
      }}
      tbody tr {{
        opacity: 0;
        transform: translateY(8px);
        animation: row-in 360ms cubic-bezier(0.2, 0.75, 0.3, 1) both;
        animation-delay: calc(var(--row-index, 0) * 24ms);
        transition: background-color 0.15s ease;
      }}
      tbody tr:hover td {{
        background: var(--bg-hover);
      }}
      th:nth-child(2),
      td:nth-child(2),
      th:nth-child(3),
      td:nth-child(3),
      th:nth-child(4),
      td:nth-child(4),
      th:nth-child(5),
      td:nth-child(5),
      th:nth-child(6),
      td:nth-child(6) {{
        white-space: nowrap;
      }}
      .workload {{
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 2px;
      }}
      .metric-pair {{
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.7;
      }}
      .notes-cell {{
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }}
      .arrow {{
        color: var(--text-tertiary);
        padding: 0 6px;
      }}
      .action {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
      }}
      .action::before {{
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
      }}
      .action.upsize {{
        color: var(--warn);
      }}
      .action.upsize::before {{
        box-shadow: 0 0 0 rgba(210, 153, 34, 0.45);
        animation: pulse-update 1.6s ease-out infinite;
      }}
      .action.downsize {{
        color: var(--success);
      }}
      .action.downsize::before {{
        box-shadow: 0 0 0 rgba(63, 185, 80, 0.5);
        animation: pulse-dot 1.8s ease-out infinite;
      }}
      .action.no-change {{
        color: var(--accent-soft);
      }}
      .action.unknown {{
        color: var(--text-tertiary);
      }}
      .positive {{
        color: var(--warn);
      }}
      .negative {{
        color: var(--success);
      }}
      .neutral,
      .muted {{
        color: var(--text-tertiary);
      }}
      .empty-state {{
        padding: 24px 22px;
        text-align: center;
        color: var(--text-tertiary);
        font-family: var(--font-mono);
        font-size: 12px;
      }}
      .focus-grid,
      .support-grid {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }}
      .support-grid {{
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }}
      .planner-grid {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }}
      .focus-card-body,
      .support-card,
      .terminal-shell {{
        padding: 18px 20px;
      }}
      .focus-card-title,
      .support-card-title {{
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 500;
      }}
      .focus-list {{
        list-style: none;
        margin-top: 12px;
      }}
      .focus-list li {{
        padding: 12px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }}
      .focus-list li:first-child {{
        border-top: none;
        padding-top: 0;
      }}
      .focus-path {{
        display: block;
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
      }}
      .focus-inline {{
        display: block;
        margin-top: 4px;
        color: var(--text-tertiary);
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .policy-grid {{
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        margin-top: 12px;
      }}
      .stat-pill {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--border-active);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .stat-pill strong {{
        color: var(--text-primary);
        font-weight: 500;
      }}
      .stat-pill.ok {{
        color: var(--success);
        border-color: rgba(63, 185, 80, 0.28);
        background: rgba(63, 185, 80, 0.08);
      }}
      .stat-pill.guarded {{
        color: var(--warn);
        border-color: rgba(210, 153, 34, 0.28);
        background: rgba(210, 153, 34, 0.08);
      }}
      .stat-pill.excluded {{
        color: var(--danger);
        border-color: rgba(248, 81, 73, 0.28);
        background: rgba(248, 81, 73, 0.08);
      }}
      .token {{
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
      }}
      .token strong {{
        color: var(--text-primary);
        font-weight: 500;
      }}
      .note-pill {{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid var(--border-active);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text-secondary);
        font-family: var(--font-mono);
        font-size: 11px;
        line-height: 1.4;
      }}
      .note-pill strong {{
        color: inherit;
        font-weight: 500;
      }}
      .note-pill.excluded {{
        color: var(--danger);
        border-color: rgba(248, 81, 73, 0.28);
        background: rgba(248, 81, 73, 0.08);
      }}
      .note-pill.guarded {{
        color: var(--warn);
        border-color: rgba(210, 153, 34, 0.28);
        background: rgba(210, 153, 34, 0.08);
      }}
      .note-pill.neutral {{
        color: var(--text-secondary);
        border-color: var(--border-subtle);
        background: rgba(255, 255, 255, 0.02);
      }}
      .support-copy {{
        margin-top: 12px;
      }}
      .planner-list {{
        margin-top: 14px;
      }}
      .terminal-content {{
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: var(--font-mono);
        font-size: 12px;
      }}
      .log-line {{
        display: grid;
        grid-template-columns: 44px 52px 1fr;
        gap: 14px;
      }}
      .log-time {{
        color: var(--text-tertiary);
      }}
      .log-level {{
        color: var(--text-primary);
      }}
      .log-info {{
        color: var(--text-primary);
      }}
      .log-muted {{
        color: var(--text-tertiary);
      }}
      [hidden] {{
        display: none !important;
      }}
      @keyframes row-in {{
        from {{ opacity: 0; transform: translateY(8px); }}
        to {{ opacity: 1; transform: translateY(0); }}
      }}
      @keyframes pulse-dot {{
        0% {{ box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }}
        75% {{ box-shadow: 0 0 0 8px rgba(63, 185, 80, 0); }}
        100% {{ box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }}
      }}
      @keyframes pulse-update {{
        0% {{ box-shadow: 0 0 0 0 rgba(210, 153, 34, 0.45); }}
        75% {{ box-shadow: 0 0 0 8px rgba(210, 153, 34, 0); }}
        100% {{ box-shadow: 0 0 0 0 rgba(210, 153, 34, 0); }}
      }}
      @media (max-width: 1024px) {{
        .overview-strip,
        .focus-grid,
        .planner-grid,
        .support-grid {{
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }}
      }}
      @media (max-width: 820px) {{
        .topbar-inner,
        main {{
          padding-left: 16px;
          padding-right: 16px;
        }}
        .section-bar,
        .overview-meta-row,
        .toolbar {{
          align-items: flex-start;
          flex-direction: column;
        }}
        .overview-meta-cluster,
        .toolbar-left,
        .toolbar-right,
        .filter-group,
        .search-shell {{
          width: 100%;
        }}
      }}
      @media (max-width: 700px) {{
        .overview-strip,
        .focus-grid,
        .planner-grid,
        .support-grid {{
          grid-template-columns: 1fr;
        }}
        .overview-segment {{
          min-height: 0;
          border-right: none;
          border-bottom: 1px solid var(--border-subtle);
        }}
        .overview-segment:last-child {{
          border-bottom: none;
        }}
        th,
        td {{
          padding: 12px 14px;
        }}
        .log-line {{
          grid-template-columns: 36px 44px 1fr;
          gap: 10px;
        }}
      }}
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="crumbs">
          <span class="brand-mark">A</span>
          <span class="crumb-separator">/</span>
          <span class="crumb-label">rangoonpulse</span>
          <span class="env-pill">production</span>
        </div>
        <div class="top-actions">
          <a class="top-button" href="/latest.json">json</a>
          <a class="top-button" href="/latest.md">markdown</a>
          <a class="top-button" href="/metrics">metrics</a>
        </div>
      </div>
    </header>

    <main>
      <section id="overview" class="section">
        <div class="section-bar">
          <div>
            <h1 class="section-heading">overview</h1>
            <p class="section-copy">{html.escape(status_copy)}</p>
          </div>
          <div class="overview-meta">last {html.escape(window or 'report')} window</div>
        </div>

        <div class="overview-strip">
          {overview_html}
        </div>

        <div class="overview-meta-row">
          <div class="overview-meta-cluster">
            <span>last run <strong id="last-run-local" data-utc="{_escape_attr(last_run)}">{html.escape(last_run or 'n/a')}</strong></span>
            <span>browser tz <strong id="browser-tz">browser local</strong></span>
            <span>mode <strong>{html.escape(mode or 'n/a')}</strong></span>
            <span>allocatable <strong>{html.escape(_with_unit_space(alloc.get('cpu') or 'n/a'))}</strong> cpu <strong>{html.escape(_with_unit_space(alloc.get('memory') or 'n/a'))}</strong> memory</span>
          </div>
          <div class="result-count">{html.escape(fetch_detail)}</div>
        </div>
      </section>

      <section id="apply-preflight" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">apply preflight</h2>
            <p class="section-copy">live selection preview for the weekly apply job, using hard node-fit blocking and advisory cluster pressure ordering.</p>
          </div>
          <div class="section-detail">{selected_count} selected right now</div>
        </div>
        <div class="planner-grid">
          {planner_cards}
        </div>
      </section>

      <section id="recommendations" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">recommendation set</h2>
            <p class="section-copy">filterable live view from the current configmap report, with live pod restart counts beside historical 14d restart activity.</p>
          </div>
          <a class="primary-button" href="/latest.json">open report</a>
        </div>

        <div class="toolbar">
          <div class="toolbar-left">
            <div class="filter-group" role="tablist" aria-label="Action filters">
              <button class="filter-btn active" type="button" data-filter-action="all">all</button>
              <button class="filter-btn" type="button" data-filter-action="upsize">upsize</button>
              <button class="filter-btn" type="button" data-filter-action="downsize">downsize</button>
              <button class="filter-btn" type="button" data-filter-action="no-change">no change</button>
            </div>
            <select id="noteFilter" class="control-select" aria-label="Note filter">
              <option value="all">all notes</option>
              {note_options}
            </select>
          </div>
          <div class="toolbar-right">
            <label class="search-shell">
              <span class="input-prefix">&gt;</span>
              <input id="searchInput" type="search" placeholder="Filter workloads..." />
            </label>
            <div id="resultCount" class="result-count">{rec_count} visible rows</div>
          </div>
        </div>

        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>workload</th>
                <th>action</th>
                <th>cpu request</th>
                <th>memory request</th>
                <th>observed usage</th>
                <th>basis</th>
                <th>restart signal</th>
                <th>notes</th>
              </tr>
            </thead>
            <tbody id="recommendationRows">
              {''.join(table_rows)}
            </tbody>
          </table>
          <div id="emptyState" class="empty-state" hidden>No rows match the current filters.</div>
        </div>
      </section>

      <section class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">recommendation focus</h2>
            <p class="section-copy">highest-signal slices from the current advisor window.</p>
          </div>
          <div class="section-detail">{html.escape(_with_unit_space(f"{_fmt_decimal(coverage_days)}d"))} of metrics coverage</div>
        </div>
        <div class="focus-grid">
          {_build_focus_card("largest memory shifts", "absolute request-memory deltas across all recommendations.", biggest_mem_items)}
          {_build_focus_card("restart-guarded items", "rows where historical restart activity is directly influencing the advice.", restart_guard_items)}
          {_build_focus_card("highest restart volume", "most restart-heavy rows in the historical 14d advisor window.", restart_volume_items)}
        </div>
      </section>

      <section class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">control notes</h2>
            <p class="section-copy">planner bounds and recurring note patterns behind the current recommendation set.</p>
          </div>
          <div class="section-detail">{rec_count} total recommendations</div>
        </div>
        <div class="support-grid">
          {support_cards}
        </div>
      </section>

      <section id="runtime" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">system output</h2>
            <p class="section-copy">recent report markdown lines served by the exporter.</p>
          </div>
          <div class="section-detail">{html.escape(fetch_detail)}</div>
        </div>
        <div class="terminal-shell">
          <div class="terminal-content">
            {runtime_html}
          </div>
        </div>
      </section>
    </main>
    <script>
      (function () {{
        const tzNode = document.getElementById("browser-tz");
        const tsNode = document.getElementById("last-run-local");
        const rows = Array.from(document.querySelectorAll("[data-rec-row]"));
        const buttons = Array.from(document.querySelectorAll("[data-filter-action]"));
        const searchInput = document.getElementById("searchInput");
        const noteFilter = document.getElementById("noteFilter");
        const resultCount = document.getElementById("resultCount");
        const emptyState = document.getElementById("emptyState");
        let activeAction = "all";

        try {{
          if (tzNode && window.Intl && Intl.DateTimeFormat) {{
            tzNode.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "browser local";
          }}
        }} catch (e) {{}}

        if (tsNode) {{
          const raw = tsNode.getAttribute("data-utc");
          if (raw) {{
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) {{
              tsNode.textContent = d.toLocaleString(undefined, {{
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZoneName: "short"
              }});
              tsNode.title = "UTC: " + raw;
            }}
          }}
        }}

        function applyFilters() {{
          const query = (searchInput && searchInput.value || "").trim().toLowerCase();
          const noteValue = noteFilter ? noteFilter.value : "all";
          let visible = 0;

          for (const row of rows) {{
            const action = row.dataset.action || "";
            const notes = row.dataset.notes || "";
            const search = row.dataset.search || "";
            const actionMatch = activeAction === "all" || action === activeAction;
            const noteMatch = noteValue === "all" || notes.split(",").includes(noteValue);
            const searchMatch = !query || search.includes(query);
            const show = actionMatch && noteMatch && searchMatch;
            row.hidden = !show;
            if (show) visible += 1;
          }}

          if (resultCount) {{
            resultCount.textContent = visible + " visible row" + (visible === 1 ? "" : "s");
          }}
          if (emptyState) {{
            emptyState.hidden = visible !== 0;
          }}
        }}

        for (const button of buttons) {{
          button.addEventListener("click", function () {{
            activeAction = button.dataset.filterAction || "all";
            for (const peer of buttons) {{
              peer.classList.toggle("active", peer === button);
            }}
            applyFilters();
          }});
        }}

        if (searchInput) searchInput.addEventListener("input", applyFilters);
        if (noteFilter) noteFilter.addEventListener("change", applyFilters);
        applyFilters();
      }})();
    </script>
  </body>
</html>
"""
    return html_doc


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
