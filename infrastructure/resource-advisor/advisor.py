#!/usr/bin/env python3

import datetime as dt
import json
import math
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def log(message: str) -> None:
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    print(f"[{now}] {message}", flush=True)


def env_list(name: str, default: str) -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        log(f"Invalid float for {name}: {value!r}; using default {default}")
        return default


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        log(f"Invalid int for {name}: {value!r}; using default {default}")
        return default


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def parse_cpu_to_m(value: str | None) -> float:
    if not value:
        return 0.0
    value = str(value).strip()
    if value.endswith("m"):
        return float(value[:-1])
    return float(value) * 1000.0


def parse_mem_to_mi(value: str | None) -> float:
    if not value:
        return 0.0
    value = str(value).strip()
    unit_map = {
        "Ki": 1 / 1024,
        "Mi": 1,
        "Gi": 1024,
        "Ti": 1024 * 1024,
        "Pi": 1024 * 1024 * 1024,
        "K": 1000 / (1024 * 1024),
        "M": 1000 * 1000 / (1024 * 1024),
        "G": 1000 * 1000 * 1000 / (1024 * 1024),
        "T": 1000 * 1000 * 1000 * 1000 / (1024 * 1024),
        "E": 1000 * 1000 * 1000 * 1000 * 1000 * 1000 / (1024 * 1024),
    }
    for unit, factor in unit_map.items():
        if value.endswith(unit):
            return float(value[: -len(unit)]) * factor
    # bytes
    return float(value) / (1024 * 1024)


def fmt_cpu_m(value: float) -> str:
    return f"{max(0, int(round(value)))}m"


def fmt_mem_mi(value: float) -> str:
    return f"{max(0, int(round(value)))}Mi"


def pct_delta(old: float, new: float) -> float:
    if old <= 0:
        return 100.0 if new > 0 else 0.0
    return ((new - old) / old) * 100.0


class KubeClient:
    def __init__(self) -> None:
        self.host = os.getenv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
        self.port = os.getenv("KUBERNETES_SERVICE_PORT", "443")
        self.base = f"https://{self.host}:{self.port}"
        token_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")
        ca_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
        self.token = token_path.read_text().strip() if token_path.exists() else ""

        self.ssl_context = ssl.create_default_context(cafile=str(ca_path)) if ca_path.exists() else ssl.create_default_context()

    def request_json(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        url = f"{self.base}{path}"
        headers = {
            "Accept": "application/json",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url=url, method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=30) as resp:
                status = resp.getcode()
                payload = json.loads(resp.read().decode("utf-8"))
                return status, payload
        except urllib.error.HTTPError as exc:
            payload = {}
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except Exception:
                payload = {"error": str(exc)}
            return exc.code, payload

    def list_workloads(self, namespace: str, kind: str) -> list[dict]:
        status, payload = self.request_json("GET", f"/apis/apps/v1/namespaces/{namespace}/{kind}")
        if status != 200:
            log(f"Failed to list {kind} in {namespace}: {status} {payload}")
            return []
        return payload.get("items", [])

    def list_nodes(self) -> list[dict]:
        status, payload = self.request_json("GET", "/api/v1/nodes")
        if status != 200:
            log(f"Failed to list nodes: {status} {payload}")
            return []
        return payload.get("items", [])

    def upsert_configmap(self, namespace: str, name: str, data: dict[str, str]) -> None:
        get_status, get_payload = self.request_json("GET", f"/api/v1/namespaces/{namespace}/configmaps/{name}")

        if get_status == 404:
            body = {
                "apiVersion": "v1",
                "kind": "ConfigMap",
                "metadata": {"name": name, "namespace": namespace},
                "data": data,
            }
            create_status, create_payload = self.request_json("POST", f"/api/v1/namespaces/{namespace}/configmaps", body)
            if create_status not in (200, 201):
                log(f"Failed to create configmap {namespace}/{name}: {create_status} {create_payload}")
                return
            log(f"Created configmap {namespace}/{name}")
            return

        if get_status != 200:
            log(f"Failed to get configmap {namespace}/{name}: {get_status} {get_payload}")
            return

        metadata = get_payload.get("metadata", {})
        body = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {
                "name": name,
                "namespace": namespace,
                "resourceVersion": metadata.get("resourceVersion"),
            },
            "data": data,
        }
        put_status, put_payload = self.request_json("PUT", f"/api/v1/namespaces/{namespace}/configmaps/{name}", body)
        if put_status != 200:
            log(f"Failed to update configmap {namespace}/{name}: {put_status} {put_payload}")
            return
        log(f"Updated configmap {namespace}/{name}")


class PromClient:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")

    def query_scalar(self, query: str) -> float | None:
        encoded = urllib.parse.urlencode({"query": query})
        url = f"{self.base}/api/v1/query?{encoded}"
        try:
            with urllib.request.urlopen(url, timeout=45) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            log(f"Prometheus query failed: {exc}")
            return None

        if payload.get("status") != "success":
            log(f"Prometheus returned non-success: {payload}")
            return None

        results = payload.get("data", {}).get("result", [])
        if not results:
            return None

        values = []
        for item in results:
            value = item.get("value", [])
            if len(value) >= 2:
                try:
                    values.append(float(value[1]))
                except ValueError:
                    continue

        if not values:
            return None
        return max(values)


def pod_regex_for_workload(workload: str, kind: str) -> str:
    escaped = re.escape(workload)
    if kind == "statefulsets":
        return f"{escaped}-[0-9]+"
    return f"{escaped}-.+"


def recommend(current: float, target: float, max_step_percent: float) -> float:
    if current <= 0:
        return target
    step = max_step_percent / 100.0
    low = current * (1.0 - step)
    high = current * (1.0 + step)
    return clamp(target, low, high)


def safe_run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True, text=True, capture_output=True)


def write_outputs(report: dict, markdown: str) -> None:
    output_dir = Path(os.getenv("OUTPUT_DIR", "/tmp/resource-advisor"))
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "latest.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    (output_dir / "latest.md").write_text(markdown)
    log(f"Wrote local outputs to {output_dir}")


def open_or_update_pr(report: dict, markdown: str) -> None:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        log("GITHUB_TOKEN is not set; skipping PR mode work")
        return

    repository = os.getenv("GITHUB_REPOSITORY", "khzaw/rangoonpulse").strip()
    if "/" not in repository:
        log(f"Invalid GITHUB_REPOSITORY: {repository}")
        return

    owner, _repo = repository.split("/", 1)
    base_branch = os.getenv("GITHUB_BASE_BRANCH", "master").strip()
    branch = os.getenv("GITHUB_HEAD_BRANCH", "codex/resource-advisor-recommendations").strip()

    author_name = os.getenv("GIT_AUTHOR_NAME", "resource-advisor")
    author_email = os.getenv("GIT_AUTHOR_EMAIL", "resource-advisor@khzaw.dev")

    title = f"resource-advisor: tuning recommendations ({dt.datetime.utcnow().strftime('%Y-%m-%d')})"
    summary = report.get("summary", {})
    body = (
        "Automated Resource Advisor report.\n\n"
        f"- Containers analyzed: {summary.get('containers_analyzed', 0)}\n"
        f"- Recommendations: {summary.get('recommendation_count', 0)}\n"
        f"- Up adjustments: {summary.get('upsize_count', 0)}\n"
        f"- Down adjustments: {summary.get('downsize_count', 0)}\n\n"
        "This PR updates generated recommendation artifacts only."
    )

    with tempfile.TemporaryDirectory(prefix="resource-advisor-") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        repo_dir = temp_dir / "repo"

        token_quoted = urllib.parse.quote(token, safe="")
        clone_url = f"https://x-access-token:{token_quoted}@github.com/{repository}.git"

        log(f"Cloning {repository}")
        safe_run(["git", "clone", "--depth", "1", "--branch", base_branch, clone_url, str(repo_dir)])
        safe_run(["git", "checkout", "-B", branch], cwd=repo_dir)
        safe_run(["git", "config", "user.name", author_name], cwd=repo_dir)
        safe_run(["git", "config", "user.email", author_email], cwd=repo_dir)

        docs_dir = repo_dir / "docs" / "resource-advisor"
        docs_dir.mkdir(parents=True, exist_ok=True)
        json_path = docs_dir / "latest.json"
        md_path = docs_dir / "latest.md"

        json_content = json.dumps(report, indent=2, sort_keys=True) + "\n"
        md_content = markdown

        old_json = json_path.read_text() if json_path.exists() else ""
        old_md = md_path.read_text() if md_path.exists() else ""

        if old_json == json_content and old_md == md_content:
            log("No change in generated report artifacts; skipping PR")
            return

        json_path.write_text(json_content)
        md_path.write_text(md_content)

        safe_run(["git", "add", "docs/resource-advisor/latest.json", "docs/resource-advisor/latest.md"], cwd=repo_dir)
        status = safe_run(["git", "status", "--porcelain"], cwd=repo_dir)
        if not status.stdout.strip():
            log("Git status is clean after add; nothing to commit")
            return

        safe_run(["git", "commit", "-m", "resource-advisor: refresh tuning recommendations"], cwd=repo_dir)
        safe_run(["git", "push", "-u", "origin", branch], cwd=repo_dir)

    pulls_url = f"https://api.github.com/repos/{repository}/pulls"
    existing_url = f"{pulls_url}?state=open&head={owner}:{branch}"
    req_existing = urllib.request.Request(
        existing_url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req_existing, timeout=30) as resp:
            existing = json.loads(resp.read().decode("utf-8"))
        if isinstance(existing, list) and existing:
            log(f"PR already exists for branch {branch}: {existing[0].get('html_url')}")
            return
    except Exception as exc:
        log(f"Failed checking existing PRs, continuing create step: {exc}")

    payload = {
        "title": title,
        "head": branch,
        "base": base_branch,
        "body": body,
    }
    req_create = urllib.request.Request(
        pulls_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req_create, timeout=30) as resp:
            created = json.loads(resp.read().decode("utf-8"))
            log(f"Created PR: {created.get('html_url')}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        log(f"Failed to create PR: {exc.code} {detail}")


def build_report() -> tuple[dict, str]:
    mode = os.getenv("MODE", "report").strip().lower() or "report"
    namespaces = env_list("TARGET_NAMESPACES", "default,monitoring")
    downscale_exclude = set(env_list(
        "DOWNSCALE_EXCLUDE",
        "jellyfin,immich,immich-postgres,machine-learning,prometheus,kube-prometheus-stack",
    ))

    max_step_percent = env_float("MAX_STEP_PERCENT", 25.0)
    request_buffer_percent = env_float("REQUEST_BUFFER_PERCENT", 30.0)
    limit_buffer_percent = env_float("LIMIT_BUFFER_PERCENT", 60.0)
    min_cpu_m = env_float("MIN_CPU_M", 25.0)
    min_mem_mi = env_float("MIN_MEM_MI", 64.0)

    prom = PromClient(os.getenv("PROMETHEUS_URL", "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090"))
    kube = KubeClient()

    alloc_cpu_m = 0.0
    alloc_mem_mi = 0.0
    for node in kube.list_nodes():
        alloc = node.get("status", {}).get("allocatable", {})
        alloc_cpu_m += parse_cpu_to_m(alloc.get("cpu"))
        alloc_mem_mi += parse_mem_to_mi(alloc.get("memory"))

    recommendations = []
    containers_analyzed = 0
    containers_with_data = 0
    skipped_no_metrics = 0

    for namespace in namespaces:
        for kind in ("deployments", "statefulsets"):
            for workload in kube.list_workloads(namespace, kind):
                meta = workload.get("metadata", {})
                spec = workload.get("spec", {}).get("template", {}).get("spec", {})
                labels = meta.get("labels", {})
                workload_name = meta.get("name", "unknown")
                release = labels.get("app.kubernetes.io/instance", workload_name)
                pod_regex = pod_regex_for_workload(workload_name, kind)

                for container in spec.get("containers", []):
                    containers_analyzed += 1
                    container_name = container.get("name", "main")
                    resources = container.get("resources", {})
                    req = resources.get("requests", {})
                    lim = resources.get("limits", {})

                    cur_req_cpu = parse_cpu_to_m(req.get("cpu"))
                    cur_req_mem = parse_mem_to_mi(req.get("memory"))
                    cur_lim_cpu = parse_cpu_to_m(lim.get("cpu"))
                    cur_lim_mem = parse_mem_to_mi(lim.get("memory"))

                    cpu_query = (
                        f'quantile_over_time(0.95, sum(rate(container_cpu_usage_seconds_total{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}",image!=""}}[5m]))[7d:1h])'
                    )
                    mem_query = (
                        f'quantile_over_time(0.95, max(container_memory_working_set_bytes{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}",image!=""}})[7d:1h])'
                    )
                    restart_query = (
                        f'sum(increase(kube_pod_container_status_restarts_total{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}"}}[7d]))'
                    )

                    cpu_p95_cores = prom.query_scalar(cpu_query)
                    mem_p95_bytes = prom.query_scalar(mem_query)
                    restart_7d = prom.query_scalar(restart_query) or 0.0

                    if cpu_p95_cores is None and mem_p95_bytes is None:
                        skipped_no_metrics += 1
                        continue

                    containers_with_data += 1

                    cpu_p95_m = (cpu_p95_cores or 0.0) * 1000.0
                    mem_p95_mi = (mem_p95_bytes or 0.0) / (1024.0 * 1024.0)

                    target_req_cpu = max(min_cpu_m, cpu_p95_m * (1.0 + request_buffer_percent / 100.0))
                    target_req_mem = max(min_mem_mi, mem_p95_mi * (1.0 + request_buffer_percent / 100.0))
                    target_lim_cpu = max(target_req_cpu * 2.0, cpu_p95_m * (1.0 + limit_buffer_percent / 100.0))
                    target_lim_mem = max(target_req_mem * 1.5, mem_p95_mi * (1.0 + limit_buffer_percent / 100.0))

                    rec_req_cpu = recommend(cur_req_cpu, target_req_cpu, max_step_percent)
                    rec_req_mem = recommend(cur_req_mem, target_req_mem, max_step_percent)
                    rec_lim_cpu = recommend(cur_lim_cpu, target_lim_cpu, max_step_percent)
                    rec_lim_mem = recommend(cur_lim_mem, target_lim_mem, max_step_percent)

                    notes: list[str] = []

                    # Guardrail: avoid reducing memory on restart-heavy containers.
                    if restart_7d > 0:
                        if rec_req_mem < cur_req_mem:
                            rec_req_mem = cur_req_mem
                        if rec_lim_mem < cur_lim_mem:
                            rec_lim_mem = cur_lim_mem
                        notes.append("restart_guard")

                    # Guardrail: keep high-variance media/ML apps from auto-downscale.
                    if release in downscale_exclude:
                        if rec_req_cpu < cur_req_cpu:
                            rec_req_cpu = cur_req_cpu
                        if rec_req_mem < cur_req_mem:
                            rec_req_mem = cur_req_mem
                        if rec_lim_cpu < cur_lim_cpu:
                            rec_lim_cpu = cur_lim_cpu
                        if rec_lim_mem < cur_lim_mem:
                            rec_lim_mem = cur_lim_mem
                        notes.append("downscale_excluded")

                    req_cpu_delta = pct_delta(cur_req_cpu, rec_req_cpu)
                    req_mem_delta = pct_delta(cur_req_mem, rec_req_mem)
                    lim_cpu_delta = pct_delta(cur_lim_cpu, rec_lim_cpu)
                    lim_mem_delta = pct_delta(cur_lim_mem, rec_lim_mem)

                    significant_change = any(
                        abs(delta) >= 5.0
                        for delta in (req_cpu_delta, req_mem_delta, lim_cpu_delta, lim_mem_delta)
                    )
                    if not significant_change and restart_7d <= 0:
                        continue

                    action = "no-change"
                    if any(delta > 5.0 for delta in (req_cpu_delta, req_mem_delta, lim_cpu_delta, lim_mem_delta)):
                        action = "upsize"
                    if (
                        action == "no-change"
                        and any(delta < -5.0 for delta in (req_cpu_delta, req_mem_delta, lim_cpu_delta, lim_mem_delta))
                    ):
                        action = "downsize"

                    recommendations.append(
                        {
                            "namespace": namespace,
                            "kind": kind[:-1],
                            "workload": workload_name,
                            "release": release,
                            "container": container_name,
                            "restarts_7d": round(restart_7d, 2),
                            "cpu_p95_m": round(cpu_p95_m, 1),
                            "mem_p95_mi": round(mem_p95_mi, 1),
                            "current": {
                                "requests": {"cpu": fmt_cpu_m(cur_req_cpu), "memory": fmt_mem_mi(cur_req_mem)},
                                "limits": {"cpu": fmt_cpu_m(cur_lim_cpu), "memory": fmt_mem_mi(cur_lim_mem)},
                            },
                            "recommended": {
                                "requests": {"cpu": fmt_cpu_m(rec_req_cpu), "memory": fmt_mem_mi(rec_req_mem)},
                                "limits": {"cpu": fmt_cpu_m(rec_lim_cpu), "memory": fmt_mem_mi(rec_lim_mem)},
                            },
                            "delta_percent": {
                                "requests_cpu": round(req_cpu_delta, 1),
                                "requests_memory": round(req_mem_delta, 1),
                                "limits_cpu": round(lim_cpu_delta, 1),
                                "limits_memory": round(lim_mem_delta, 1),
                            },
                            "action": action,
                            "notes": notes,
                        }
                    )

    recommendations.sort(
        key=lambda item: (
            item.get("action") != "upsize",
            -(item.get("restarts_7d", 0.0)),
            -max(
                abs(item.get("delta_percent", {}).get("requests_memory", 0.0)),
                abs(item.get("delta_percent", {}).get("limits_memory", 0.0)),
                abs(item.get("delta_percent", {}).get("requests_cpu", 0.0)),
                abs(item.get("delta_percent", {}).get("limits_cpu", 0.0)),
            ),
        )
    )

    total_cur_req_cpu = sum(parse_cpu_to_m(x["current"]["requests"]["cpu"]) for x in recommendations)
    total_cur_req_mem = sum(parse_mem_to_mi(x["current"]["requests"]["memory"]) for x in recommendations)
    total_rec_req_cpu = sum(parse_cpu_to_m(x["recommended"]["requests"]["cpu"]) for x in recommendations)
    total_rec_req_mem = sum(parse_mem_to_mi(x["recommended"]["requests"]["memory"]) for x in recommendations)

    budget = {
        "allocatable": {
            "cpu": fmt_cpu_m(alloc_cpu_m),
            "memory": fmt_mem_mi(alloc_mem_mi),
        },
        "recommended_requests_percent_of_allocatable": {
            "cpu": round((total_rec_req_cpu / alloc_cpu_m) * 100.0, 1) if alloc_cpu_m > 0 else None,
            "memory": round((total_rec_req_mem / alloc_mem_mi) * 100.0, 1) if alloc_mem_mi > 0 else None,
        },
    }

    report = {
        "generated_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "mode": mode,
        "summary": {
            "containers_analyzed": containers_analyzed,
            "containers_with_metrics": containers_with_data,
            "containers_skipped_no_metrics": skipped_no_metrics,
            "recommendation_count": len(recommendations),
            "upsize_count": sum(1 for item in recommendations if item["action"] == "upsize"),
            "downsize_count": sum(1 for item in recommendations if item["action"] == "downsize"),
            "no_change_count": sum(1 for item in recommendations if item["action"] == "no-change"),
        },
        "budget": budget,
        "recommendations": recommendations,
    }

    lines = []
    lines.append("# Resource Advisor Report")
    lines.append("")
    lines.append(f"- Generated at: `{report['generated_at']}`")
    lines.append(f"- Mode: `{mode}`")
    lines.append(f"- Containers analyzed: **{containers_analyzed}**")
    lines.append(f"- Containers with metrics: **{containers_with_data}**")
    lines.append(f"- Recommendations: **{len(recommendations)}**")
    lines.append("")
    lines.append("## Cluster Budget Snapshot")
    lines.append("")
    lines.append(f"- Allocatable CPU: `{budget['allocatable']['cpu']}`")
    lines.append(f"- Allocatable Memory: `{budget['allocatable']['memory']}`")
    lines.append(
        f"- Recommended requests as % allocatable CPU: `{budget['recommended_requests_percent_of_allocatable']['cpu']}`"
    )
    lines.append(
        f"- Recommended requests as % allocatable Memory: `{budget['recommended_requests_percent_of_allocatable']['memory']}`"
    )
    lines.append("")

    if recommendations:
        lines.append("## Recommendations")
        lines.append("")
        lines.append("| Namespace | Workload | Container | CPU req | CPU rec | Mem req | Mem rec | Action | Notes |")
        lines.append("|---|---|---|---:|---:|---:|---:|---|---|")
        for rec in recommendations:
            lines.append(
                "| {ns} | {wl} | {c} | {cur_cpu} | {rec_cpu} | {cur_mem} | {rec_mem} | {action} | {notes} |".format(
                    ns=rec["namespace"],
                    wl=rec["workload"],
                    c=rec["container"],
                    cur_cpu=rec["current"]["requests"]["cpu"],
                    rec_cpu=rec["recommended"]["requests"]["cpu"],
                    cur_mem=rec["current"]["requests"]["memory"],
                    rec_mem=rec["recommended"]["requests"]["memory"],
                    action=rec["action"],
                    notes=",".join(rec.get("notes", [])) or "-",
                )
            )
    else:
        lines.append("## Recommendations")
        lines.append("")
        lines.append("No significant tuning deltas were identified in this run.")

    markdown = "\n".join(lines) + "\n"
    return report, markdown


def main() -> int:
    mode = os.getenv("MODE", "report").strip().lower() or "report"
    configmap_namespace = os.getenv("CONFIGMAP_NAMESPACE", "monitoring")
    configmap_name = os.getenv("CONFIGMAP_NAME", "resource-advisor-latest")

    log(f"Starting resource advisor in mode={mode}")
    report, markdown = build_report()

    write_outputs(report, markdown)

    kube = KubeClient()
    kube.upsert_configmap(
        namespace=configmap_namespace,
        name=configmap_name,
        data={
            "latest.json": json.dumps(report, indent=2, sort_keys=True),
            "latest.md": markdown,
            "lastRunAt": report.get("generated_at", ""),
            "mode": mode,
        },
    )

    if mode == "pr":
        open_or_update_pr(report, markdown)

    log("Resource advisor run completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"Fatal error: {exc}")
        raise
