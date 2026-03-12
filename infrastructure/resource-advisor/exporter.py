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
            }


STATE = State()


def fetch_configmap_once() -> None:
    namespace = os.getenv("CONFIGMAP_NAMESPACE", "monitoring").strip() or "monitoring"
    name = os.getenv("CONFIGMAP_NAME", "resource-advisor-latest").strip() or "resource-advisor-latest"
    kube = advisor.KubeClient()

    status, payload = kube.request_json("GET", f"/api/v1/namespaces/{namespace}/configmaps/{name}")
    with STATE.lock:
        STATE.last_fetch_at = time.time()
        if status != 200:
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
                STATE.last_fetch_ok = False
                STATE.last_error = f"Failed to parse latest.json: {exc}"
                return

        STATE.last_fetch_ok = True
        STATE.last_error = ""
        STATE.report = report
        STATE.latest_json = latest_json
        STATE.latest_md = latest_md
        STATE.mode = mode
        STATE.last_run_at = last_run_at


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


def _clamp_pct(value: object, upper: float = 100.0) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0
    return max(0.0, min(upper, number))


def _escape_attr(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def _build_budget_card(
    title: str,
    unit_label: str,
    allocatable: object,
    current_total: float,
    recommended_total: float,
    current_percent: object,
    recommended_percent: object,
    accent: str,
) -> str:
    delta = recommended_total - current_total
    delta_class = "positive" if delta > 0 else "negative" if delta < 0 else "neutral"
    current_pct = _clamp_pct(current_percent, 100.0)
    recommended_pct = _clamp_pct(recommended_percent, 100.0)

    return f"""
      <article class="surface budget-card">
        <div class="surface-topline">{html.escape(title)}</div>
        <div class="budget-main">
          <div>
            <div class="budget-value">{html.escape(_fmt_decimal(current_total))}{html.escape(unit_label)}</div>
            <div class="budget-caption">current requested from {html.escape(str(allocatable or "n/a"))} allocatable</div>
          </div>
          <div class="delta-pill {delta_class}">{html.escape(_fmt_signed(delta, unit_label))}</div>
        </div>
        <div class="progress-block">
          <div class="progress-meta">
            <span>current</span>
            <strong>{html.escape(_fmt_decimal(current_percent))}%</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill current {html.escape(accent)}" style="width:{current_pct:.1f}%"></div>
          </div>
        </div>
        <div class="progress-block">
          <div class="progress-meta">
            <span>recommended</span>
            <strong>{html.escape(_fmt_decimal(recommended_percent))}%</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill recommended {html.escape(accent)}" style="width:{recommended_pct:.1f}%"></div>
          </div>
        </div>
        <div class="budget-foot">
          <span>{html.escape(_fmt_decimal(current_total))}{html.escape(unit_label)}</span>
          <span>{html.escape(_fmt_decimal(recommended_total))}{html.escape(unit_label)}</span>
        </div>
      </article>
    """


def _build_focus_card(title: str, subtitle: str, items: list[str]) -> str:
    if not items:
        items = ["No items in this slice."]
    rows = "".join(f"<li>{item}</li>" for item in items)
    return f"""
      <article class="surface focus-card">
        <div class="surface-topline">{html.escape(title)}</div>
        <div class="focus-subtitle">{html.escape(subtitle)}</div>
        <ul class="focus-list">{rows}</ul>
      </article>
    """


def build_index_html() -> str:
    snap = STATE.snapshot()
    report = snap["report"] or {}
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
        restart_guard_items.append(f"{focus_line(rec, restarts + ' restarts / window')}")

    restart_volume_items = []
    for rec in largest_restarts:
        restarts = float(rec.get("restarts_window") or 0.0)
        if restarts <= 0:
            continue
        restart_volume_items.append(f"{focus_line(rec, _fmt_decimal(restarts, 2) + ' restarts / window')}")

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
                  <span>{html.escape(current_cpu)}</span>
                  <span class="arrow">→</span>
                  <span>{html.escape(recommended_cpu)}</span>
                </div>
                <div class="metric-delta {'positive' if cpu_delta_m > 0 else 'negative' if cpu_delta_m < 0 else 'neutral'}">{html.escape(_fmt_signed(cpu_delta_m, 'm', 0))}</div>
              </td>
              <td>
                <div class="metric-pair">
                  <span>{html.escape(current_mem)}</span>
                  <span class="arrow">→</span>
                  <span>{html.escape(recommended_mem)}</span>
                </div>
                <div class="metric-delta {'positive' if mem_delta_mi > 0 else 'negative' if mem_delta_mi < 0 else 'neutral'}">{html.escape(_fmt_signed(mem_delta_mi, 'Mi', 0))}</div>
              </td>
              <td>
                <div class="usage-line">p95 {html.escape(cpu_p95)}m · {html.escape(mem_p95)}Mi</div>
                <div class="workload-meta">{html.escape(str(replicas))} replica(s)</div>
              </td>
              <td>
                <div class="usage-line">{html.escape(_fmt_decimal(restarts_window, 2))}</div>
                <div class="workload-meta">restart count over advisor window</div>
              </td>
              <td><div class="notes-cell">{html.escape(notes_text)}</div></td>
            </tr>
            """
        )

    overview_cards = [
        ("Recommendations", str(rec_count), f"{upsize_count} up · {downsize_count} down · {no_change_count} steady"),
        ("Containers analyzed", str(analyzed), f"{with_metrics} with Prometheus data"),
        ("Metrics coverage", f"{_fmt_decimal(coverage_days)}d", f"window {window or 'n/a'}"),
        ("Fetcher", "healthy" if fetch_state == "live" else "degraded", fetch_detail),
    ]

    overview_html = "".join(
        f"""
        <article class="surface stat-card">
          <div class="surface-topline">{html.escape(label)}</div>
          <div class="stat-value">{html.escape(value)}</div>
          <div class="stat-sub">{html.escape(subtitle)}</div>
        </article>
        """
        for label, value, subtitle in overview_cards
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

    note_html = "".join(
        f'<span class="token note-token">{html.escape(note)} <strong>{count}</strong></span>'
        for note, count in top_notes
    ) or '<span class="muted">No note annotations in current report.</span>'

    budget_cards = (
        _build_budget_card(
            "CPU request posture",
            "m",
            alloc.get("cpu") or "n/a",
            current_cpu_m,
            recommended_cpu_m,
            cur_pct.get("cpu"),
            rec_pct.get("cpu"),
            "cpu",
        )
        + _build_budget_card(
            "Memory request posture",
            "Mi",
            alloc.get("memory") or "n/a",
            current_mem_mi,
            recommended_mem_mi,
            cur_pct.get("memory"),
            rec_pct.get("memory"),
            "memory",
        )
        + f"""
          <article class="surface policy-card">
            <div class="surface-topline">Policy guardrails</div>
            <div class="policy-grid">{policy_html}</div>
            <div class="policy-copy">These are the active planner bounds applied to each report or apply-PR pass.</div>
            <div class="surface-divider"></div>
            <div class="surface-topline">Common notes</div>
            <div class="policy-grid">{note_html}</div>
          </article>
        """
    )

    status_copy = (
        "Budget-aware tuning view for the latest runtime-owned advisor report."
        if report
        else "No parsed report is currently available from the runtime ConfigMap."
    )

    html_doc = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(title)}</title>
    <style>
      :root {{
        --bg: #0c0c0d;
        --bg-subtle: #121214;
        --card: rgba(255, 255, 255, 0.035);
        --card-strong: rgba(255, 255, 255, 0.05);
        --border: rgba(255, 255, 255, 0.075);
        --border-strong: rgba(255, 255, 255, 0.14);
        --text-1: #f4f4f5;
        --text-2: #b4b4ba;
        --text-3: #7d7d86;
        --text-dim: #666670;
        --accent: #82aaff;
        --accent-2: #5eead4;
        --green: #4ade80;
        --red: #fb7185;
        --amber: #f59e0b;
        --violet: #a78bfa;
        --shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
        --font-sans: "Geist", "Inter", "SF Pro Display", ui-sans-serif, system-ui, sans-serif;
        --font-mono: "Geist Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
      }}
      * {{ box-sizing: border-box; margin: 0; }}
      html {{
        min-height: 100%;
        background: #09090b;
      }}
      body {{
        min-height: 100dvh;
        color: var(--text-1);
        font-family: var(--font-sans);
        background:
          radial-gradient(1200px 700px at 4% -10%, rgba(130, 170, 255, 0.12), transparent 56%),
          radial-gradient(1100px 640px at 96% -8%, rgba(94, 234, 212, 0.08), transparent 54%),
          linear-gradient(180deg, #09090b 0%, #0c0c0d 48%, #09090b 100%);
        background-attachment: fixed;
        -webkit-font-smoothing: antialiased;
      }}
      a {{
        color: var(--text-2);
        text-decoration: underline;
        text-decoration-color: rgba(255, 255, 255, 0.18);
        text-underline-offset: 3px;
      }}
      a:hover {{ color: var(--text-1); }}
      main {{
        max-width: 1460px;
        margin: 0 auto;
        padding: 36px 24px 56px;
      }}
      .page-shell {{
        display: grid;
        gap: 22px;
      }}
      .hero {{
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 18px;
        align-items: stretch;
      }}
      .surface {{
        border: 1px solid var(--border);
        border-radius: 22px;
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018));
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }}
      .hero-panel {{
        padding: 24px 24px 20px;
        position: relative;
        overflow: hidden;
      }}
      .hero-panel::after {{
        content: "";
        position: absolute;
        inset: auto -12% -46% auto;
        width: 340px;
        height: 340px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(130, 170, 255, 0.15), transparent 64%);
        pointer-events: none;
      }}
      .eyebrow {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.025);
        color: var(--text-2);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }}
      .eyebrow::before {{
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: {'var(--green)' if fetch_state == 'live' else 'var(--red)'};
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.38);
        animation: pulse-dot 1.9s ease-out infinite;
      }}
      h1 {{
        margin-top: 16px;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1.04;
        letter-spacing: -0.04em;
      }}
      .hero-copy {{
        margin-top: 12px;
        max-width: 72ch;
        color: var(--text-2);
        font-size: 14px;
        line-height: 1.7;
      }}
      .hero-meta {{
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
      }}
      .pill {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.025);
        color: var(--text-2);
        font-size: 12px;
      }}
      .pill strong {{
        color: var(--text-1);
        font-weight: 600;
      }}
      .endpoint-list {{
        margin-top: 22px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }}
      .endpoint-link {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.025);
        color: var(--text-1);
        text-decoration: none;
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .endpoint-link:hover {{
        border-color: var(--border-strong);
        background: rgba(255,255,255,0.045);
      }}
      .overview-grid {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }}
      .stat-card {{
        padding: 18px;
        min-height: 138px;
      }}
      .surface-topline {{
        font-size: 11px;
        color: var(--text-3);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }}
      .stat-value {{
        margin-top: 14px;
        font-size: 32px;
        line-height: 1;
        letter-spacing: -0.05em;
      }}
      .stat-sub {{
        margin-top: 10px;
        color: var(--text-2);
        font-size: 12px;
        line-height: 1.55;
      }}
      .section {{
        display: grid;
        gap: 16px;
      }}
      .section-head {{
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }}
      .section-title {{
        font-size: 13px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-3);
      }}
      .section-detail {{
        color: var(--text-3);
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .budget-grid {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }}
      .budget-card,
      .policy-card,
      .focus-card {{
        padding: 18px;
      }}
      .budget-main {{
        margin-top: 14px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }}
      .budget-value {{
        font-size: 28px;
        letter-spacing: -0.05em;
      }}
      .budget-caption,
      .policy-copy,
      .focus-subtitle {{
        margin-top: 6px;
        color: var(--text-3);
        font-size: 12px;
        line-height: 1.6;
      }}
      .delta-pill {{
        flex: 0 0 auto;
        padding: 8px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-family: var(--font-mono);
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.025);
        color: var(--text-2);
      }}
      .delta-pill.positive {{ color: var(--amber); }}
      .delta-pill.negative {{ color: var(--green); }}
      .progress-block {{
        margin-top: 14px;
      }}
      .progress-meta {{
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--text-2);
        font-size: 12px;
        margin-bottom: 7px;
      }}
      .progress-track {{
        position: relative;
        overflow: hidden;
        height: 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
      }}
      .progress-fill {{
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
      }}
      .progress-fill.current.cpu {{ background: linear-gradient(90deg, rgba(130,170,255,0.55), rgba(130,170,255,0.9)); }}
      .progress-fill.recommended.cpu {{ background: linear-gradient(90deg, rgba(167,139,250,0.55), rgba(167,139,250,0.9)); }}
      .progress-fill.current.memory {{ background: linear-gradient(90deg, rgba(94,234,212,0.55), rgba(94,234,212,0.88)); }}
      .progress-fill.recommended.memory {{ background: linear-gradient(90deg, rgba(245,158,11,0.5), rgba(245,158,11,0.88)); }}
      .budget-foot {{
        margin-top: 12px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--text-3);
        font-size: 11px;
        font-family: var(--font-mono);
      }}
      .policy-grid {{
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }}
      .token {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 11px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.025);
        color: var(--text-2);
        font-size: 12px;
      }}
      .token strong {{
        color: var(--text-1);
        font-family: var(--font-mono);
        font-weight: 600;
      }}
      .surface-divider {{
        height: 1px;
        background: var(--border);
        margin: 18px 0 0;
      }}
      .focus-grid {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }}
      .focus-list {{
        list-style: none;
        margin-top: 14px;
        display: grid;
        gap: 12px;
      }}
      .focus-list li {{
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.024);
      }}
      .focus-path {{
        display: block;
        font-size: 13px;
        color: var(--text-1);
        font-weight: 600;
      }}
      .focus-inline {{
        display: block;
        margin-top: 4px;
        color: var(--text-2);
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .toolbar {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }}
      .toolbar-left,
      .toolbar-right {{
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }}
      .filter-group {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.025);
      }}
      .filter-btn,
      select,
      input {{
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.03);
        color: var(--text-2);
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-size: 12px;
        outline: none;
      }}
      .filter-btn {{
        cursor: pointer;
        transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
      }}
      .filter-btn.active {{
        color: var(--text-1);
        border-color: rgba(130, 170, 255, 0.5);
        background: rgba(130, 170, 255, 0.14);
      }}
      select,
      input {{
        min-height: 42px;
      }}
      input {{
        min-width: 260px;
      }}
      .result-count {{
        color: var(--text-3);
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .table-shell {{
        overflow: hidden;
      }}
      table {{
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
      }}
      thead th {{
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 14px 16px;
        text-align: left;
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-3);
        border-bottom: 1px solid var(--border);
        background: rgba(12, 12, 13, 0.92);
        backdrop-filter: blur(8px);
      }}
      tbody td {{
        padding: 16px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }}
      tbody tr {{
        opacity: 0;
        transform: translateY(8px);
        animation: row-in 320ms cubic-bezier(.2,.75,.3,1) forwards;
        animation-delay: calc(var(--row-index, 0) * 14ms);
      }}
      tbody tr:hover td {{
        background: rgba(255,255,255,0.022);
      }}
      tbody tr:last-child td {{
        border-bottom: none;
      }}
      .workload {{
        font-size: 14px;
        font-weight: 600;
      }}
      .workload-meta,
      .usage-line,
      .notes-cell {{
        margin-top: 5px;
        color: var(--text-3);
        font-size: 12px;
        font-family: var(--font-mono);
        line-height: 1.55;
      }}
      .metric-pair {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-family: var(--font-mono);
      }}
      .arrow {{
        color: var(--text-3);
      }}
      .metric-delta {{
        margin-top: 6px;
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .positive {{ color: var(--amber); }}
      .negative {{ color: var(--green); }}
      .neutral {{ color: var(--text-3); }}
      .action {{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: rgba(255,255,255,0.025);
      }}
      .action::before {{
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
      }}
      .action.upsize {{ color: var(--amber); }}
      .action.downsize {{ color: var(--green); }}
      .action.no-change {{ color: var(--text-3); }}
      .action.unknown {{ color: var(--text-3); }}
      .empty-row td,
      .empty-state {{
        text-align: center;
        color: var(--text-3);
        font-size: 13px;
        padding: 28px 16px;
      }}
      details {{
        border: 1px solid var(--border);
        border-radius: 18px;
        background: rgba(255,255,255,0.02);
        overflow: hidden;
      }}
      summary {{
        cursor: pointer;
        list-style: none;
        padding: 16px 18px;
        color: var(--text-2);
        font-size: 13px;
      }}
      summary::-webkit-details-marker {{ display: none; }}
      pre {{
        margin: 0;
        padding: 0 18px 18px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-2);
        font-size: 12px;
        font-family: var(--font-mono);
      }}
      .muted {{
        color: var(--text-3);
      }}
      [hidden] {{ display: none !important; }}
      @keyframes row-in {{
        from {{ opacity: 0; transform: translateY(8px); }}
        to {{ opacity: 1; transform: translateY(0); }}
      }}
      @keyframes pulse-dot {{
        0% {{ box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.36); }}
        75% {{ box-shadow: 0 0 0 10px rgba(74, 222, 128, 0); }}
        100% {{ box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }}
      }}
      @media (prefers-reduced-motion: reduce) {{
        *, *::before, *::after {{
          animation: none !important;
          transition: none !important;
        }}
      }}
      @media (max-width: 1180px) {{
        .hero,
        .budget-grid,
        .focus-grid {{
          grid-template-columns: 1fr;
        }}
      }}
      @media (max-width: 760px) {{
        main {{ padding: 22px 14px 40px; }}
        .overview-grid {{
          grid-template-columns: 1fr;
        }}
        input {{
          min-width: 0;
          width: 100%;
        }}
        .toolbar-left,
        .toolbar-right {{
          width: 100%;
        }}
        .filter-group {{
          width: 100%;
          justify-content: space-between;
          overflow-x: auto;
        }}
      }}
    </style>
  </head>
  <body>
    <main>
      <div class="page-shell">
        <section class="hero">
          <article class="surface hero-panel">
            <div class="eyebrow">Resource Advisor</div>
            <h1>Dense tuning context without waiting on a PR.</h1>
            <p class="hero-copy">{html.escape(status_copy)}</p>
            <div class="hero-meta">
              <div class="pill">last run <strong id="last-run-local" data-utc="{_escape_attr(last_run)}">{html.escape(last_run or "n/a")}</strong></div>
              <div class="pill">browser tz <strong id="browser-tz">browser local</strong></div>
              <div class="pill">mode <strong>{html.escape(mode or 'n/a')}</strong></div>
              <div class="pill">window <strong>{html.escape(window or 'n/a')}</strong></div>
              <div class="pill">coverage <strong>{html.escape(_fmt_decimal(coverage_days))}d</strong></div>
            </div>
            <div class="endpoint-list">
              <a class="endpoint-link" href="/latest.json">raw report json</a>
              <a class="endpoint-link" href="/latest.md">raw report markdown</a>
              <a class="endpoint-link" href="/metrics">exporter metrics</a>
            </div>
          </article>
          <div class="overview-grid">
            {overview_html}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Budget Posture</div>
            <div class="section-detail">allocatable {html.escape(str(alloc.get('cpu') or 'n/a'))} cpu · {html.escape(str(alloc.get('memory') or 'n/a'))} memory</div>
          </div>
          <div class="budget-grid">
            {budget_cards}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Recommendation Focus</div>
            <div class="section-detail">high-signal slices from the latest report</div>
          </div>
          <div class="focus-grid">
            {_build_focus_card("Largest memory shifts", "Absolute request-memory deltas across all recommendations.", biggest_mem_items)}
            {_build_focus_card("Restart-guarded items", "Rows where restart activity is influencing the advice.", restart_guard_items)}
            {_build_focus_card("Highest restart volume", "Most restart-heavy rows in the current advisor window.", restart_volume_items)}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div class="section-title">Recommendation Set</div>
            <div class="section-detail">filterable live view from ConfigMap data</div>
          </div>
          <div class="toolbar">
            <div class="toolbar-left">
              <div class="filter-group" role="tablist" aria-label="Action filters">
                <button class="filter-btn active" type="button" data-filter-action="all">All</button>
                <button class="filter-btn" type="button" data-filter-action="upsize">Upsize</button>
                <button class="filter-btn" type="button" data-filter-action="downsize">Downsize</button>
                <button class="filter-btn" type="button" data-filter-action="no-change">No Change</button>
              </div>
              <select id="noteFilter" aria-label="Note filter">
                <option value="all">All notes</option>
                {note_options}
              </select>
            </div>
            <div class="toolbar-right">
              <input id="searchInput" type="search" placeholder="Search namespace, workload, release, notes…" />
              <div id="resultCount" class="result-count">{rec_count} visible rows</div>
            </div>
          </div>
          <div class="surface table-shell">
            <table>
              <thead>
                <tr>
                  <th>Workload</th>
                  <th>Action</th>
                  <th>CPU Request</th>
                  <th>Memory Request</th>
                  <th>Observed Usage</th>
                  <th>Restarts</th>
                  <th>Notes</th>
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
          <div class="section-head">
            <div class="section-title">Raw Report</div>
            <div class="section-detail">same runtime-owned markdown surfaced below</div>
          </div>
          <details>
            <summary>Show latest markdown report</summary>
            <pre>{html.escape(md) if md else 'No report markdown found in ConfigMap.'}</pre>
          </details>
        </section>
      </div>
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
