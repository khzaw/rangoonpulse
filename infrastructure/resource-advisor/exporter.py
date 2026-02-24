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


def build_index_html() -> str:
    snap = STATE.snapshot()
    report = snap["report"] or {}

    title = "Resource Advisor"
    last_run = str(report.get("generated_at") or snap.get("last_run_at") or "")
    mode = str(report.get("mode") or snap.get("mode") or "")
    cov = report.get("metrics_coverage_days_estimate")
    window = str(report.get("metrics_window") or "")
    recs = report.get("recommendations") or []
    rec_count = len(recs) if isinstance(recs, list) else 0
    last_run_escaped = html.escape(last_run) if last_run else ""
    if last_run_escaped:
        last_run_pill = (
            '<div class="pill">last run: <b id="last-run-local" '
            f'data-utc="{last_run_escaped}">{last_run_escaped}</b></div>'
        )
    else:
        last_run_pill = '<div class="pill">last run: <b id="last-run-local">n/a</b></div>'

    md = snap.get("latest_md") or ""
    if len(md) > 200_000:
        md = md[:200_000] + "\n\n... (truncated)\n"

    parts = [
        "<!doctype html>",
        "<html><head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{html.escape(title)}</title>",
        "<style>",
        "body{margin:0;background:#0b0b0b;color:#e6e6e6;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;}",
        ".wrap{max-width:1100px;margin:0 auto;padding:24px;}",
        "a{color:#9fd4ff;text-decoration:none} a:hover{text-decoration:underline}",
        ".meta{display:flex;gap:16px;flex-wrap:wrap;color:#bdbdbd;font-size:14px;margin-bottom:16px}",
        ".pill{padding:6px 10px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.04)}",
        "pre{white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:16px;}",
        "</style></head><body><div class=\"wrap\">",
        "<h1 style=\"margin:0 0 8px 0; font-size:22px;\">Resource Advisor</h1>",
        "<div class=\"meta\">",
        last_run_pill,
        "<div class=\"pill\">time zone: <b id=\"browser-tz\">browser local</b></div>",
        f"<div class=\"pill\">mode: <b>{html.escape(mode) if mode else 'n/a'}</b></div>",
        f"<div class=\"pill\">window: <b>{html.escape(window) if window else 'n/a'}</b></div>",
        f"<div class=\"pill\">coverage: <b>{html.escape(str(cov)) if cov is not None else 'n/a'}</b> days</div>",
        f"<div class=\"pill\">recommendations: <b>{rec_count}</b></div>",
        "</div>",
        "<div style=\"margin: 0 0 12px 0; color:#bdbdbd; font-size:14px;\">",
        "Endpoints: ",
        "<a href=\"/latest.md\">/latest.md</a>",
        " | ",
        "<a href=\"/latest.json\">/latest.json</a>",
        " | ",
        "<a href=\"/metrics\">/metrics</a>",
        "</div>",
        "<pre>",
        html.escape(md) if md else "No report markdown found in ConfigMap.",
        "</pre>",
        "<script>",
        "(function () {",
        "  var tsNode = document.getElementById('last-run-local');",
        "  var tzNode = document.getElementById('browser-tz');",
        "  try {",
        "    if (tzNode && window.Intl && Intl.DateTimeFormat) {",
        "      tzNode.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser local';",
        "    }",
        "  } catch (e) {}",
        "  if (!tsNode) return;",
        "  var raw = tsNode.getAttribute('data-utc');",
        "  if (!raw) return;",
        "  var d = new Date(raw);",
        "  if (isNaN(d.getTime())) return;",
        "  tsNode.textContent = d.toLocaleString(undefined, {",
        "    year: 'numeric',",
        "    month: 'short',",
        "    day: '2-digit',",
        "    hour: '2-digit',",
        "    minute: '2-digit',",
        "    second: '2-digit',",
        "    timeZoneName: 'short'",
        "  });",
        "  tsNode.title = 'UTC: ' + raw;",
        "})();",
        "</script>",
        "</div></body></html>",
    ]
    return "\n".join(parts)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, content_type: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = (self.path or "").split("?", 1)[0]
        if path == "/healthz":
            self._send(200, "text/plain; charset=utf-8", b"ok\n")
            return
        if path == "/metrics":
            out = build_metrics().encode("utf-8")
            self._send(200, "text/plain; version=0.0.4; charset=utf-8", out)
            return
        if path == "/latest.json":
            snap = STATE.snapshot()
            body = (snap.get("latest_json") or "{}").encode("utf-8")
            self._send(200, "application/json; charset=utf-8", body)
            return
        if path == "/latest.md":
            snap = STATE.snapshot()
            body = (snap.get("latest_md") or "").encode("utf-8")
            self._send(200, "text/markdown; charset=utf-8", body)
            return
        if path == "/" or path == "":
            body = build_index_html().encode("utf-8")
            self._send(200, "text/html; charset=utf-8", body)
            return
        self._send(404, "text/plain; charset=utf-8", b"not found\n")

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
