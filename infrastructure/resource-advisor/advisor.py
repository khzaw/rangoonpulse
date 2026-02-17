#!/usr/bin/env python3

import base64
import datetime as dt
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


APP_TEMPLATE_RELEASE_FILE_MAP = {
    "actualbudget": "apps/actualbudget/helmrelease.yaml",
    "audiobookshelf": "apps/audiobookshelf/helmrelease.yaml",
    "autobrr": "apps/autobrr/helmrelease.yaml",
    "bazarr": "apps/bazarr/helmrelease.yaml",
    "calibre": "apps/calibre/helmrelease.yaml",
    "calibre-web-automated": "apps/calibre-web-automated/helmrelease.yaml",
    "chartsdb": "apps/chartsdb/helmrelease.yaml",
    "flaresolverr": "apps/flaresolverr/helmrelease.yaml",
    "glance": "apps/glance/helmrelease.yaml",
    "isponsorblock-tv": "apps/isponsorblock-tv/helmrelease.yaml",
    "profilarr": "apps/profilarr/helmrelease.yaml",
    "tracerr": "apps/tracerr/helmrelease.yaml",
    "jellyfin": "apps/jellyfin/helmrelease.yaml",
    "jellyseerr": "apps/seerr/helmrelease.yaml",
    "jellystat": "apps/jellystat/helmrelease.yaml",
    "nodecast-tv": "apps/nodecast-tv/helmrelease.yaml",
    "notifiarr": "apps/notifiarr/helmrelease.yaml",
    "prowlarr": "apps/prowlarr/helmrelease.yaml",
    "radarr": "apps/radarr/helmrelease.yaml",
    "sabnzbd": "apps/sabnzbd/helmrelease.yaml",
    "sonarr": "apps/sonarr/helmrelease.yaml",
    "transmission": "apps/transmission/helmrelease.yaml",
    "tunarr": "apps/tunarr/helmrelease.yaml",
    "uptime-kuma": "apps/uptime-kuma/helmrelease.yaml",
    "vaultwarden": "apps/vaultwarden/helmrelease.yaml",
}


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
    value = str(value).strip().strip('"').strip("'")
    if value.endswith("m"):
        return float(value[:-1])
    return float(value) * 1000.0


def parse_mem_to_mi(value: str | None) -> float:
    if not value:
        return 0.0
    value = str(value).strip().strip('"').strip("'")

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
    }

    for unit, factor in unit_map.items():
        if value.endswith(unit):
            return float(value[: -len(unit)]) * factor

    return float(value) / (1024 * 1024)


def fmt_cpu_m(value: float) -> str:
    return f"{max(0, int(round(value)))}m"


def fmt_mem_mi(value: float) -> str:
    return f"{max(0, int(round(value)))}Mi"


def pct_delta(old: float, new: float) -> float:
    if old <= 0:
        return 100.0 if new > 0 else 0.0
    return ((new - old) / old) * 100.0


def is_material_delta(
    delta_percent: float,
    delta_absolute: float,
    deadband_percent: float,
    deadband_absolute: float,
) -> bool:
    pct_threshold = max(0.0, deadband_percent)
    abs_threshold = max(0.0, deadband_absolute)
    return abs(delta_percent) >= pct_threshold or abs(delta_absolute) >= abs_threshold


def leading_spaces(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def block_end(lines: list[str], start_idx: int, indent: int) -> int:
    for i in range(start_idx + 1, len(lines)):
        stripped = lines[i].strip()
        if not stripped:
            continue
        if leading_spaces(lines[i]) <= indent:
            return i
    return len(lines)


def find_key_line(lines: list[str], start: int, end: int, indent: int, key: str) -> int | None:
    pattern = re.compile(rf"^ {{{indent}}}{re.escape(key)}:\s*$")
    for i in range(start, min(end, len(lines))):
        if pattern.match(lines[i]):
            return i
    return None


def resources_block(indent: int, req_cpu: str, req_mem: str, lim_cpu: str, lim_mem: str) -> list[str]:
    return [
        " " * indent + "resources:\n",
        " " * (indent + 2) + "requests:\n",
        " " * (indent + 4) + f'cpu: "{req_cpu}"\n',
        " " * (indent + 4) + f'memory: "{req_mem}"\n',
        " " * (indent + 2) + "limits:\n",
        " " * (indent + 4) + f'cpu: "{lim_cpu}"\n',
        " " * (indent + 4) + f'memory: "{lim_mem}"\n',
    ]


def patch_app_template_resources(
    content: str,
    container_name: str,
    req_cpu: str,
    req_mem: str,
    lim_cpu: str,
    lim_mem: str,
) -> tuple[str, bool, str]:
    lines = content.splitlines(keepends=True)

    idx_values = None
    values_indent = 0
    for i, line in enumerate(lines):
        if line.strip() == "values:":
            idx_values = i
            values_indent = leading_spaces(line)
            break

    if idx_values is None:
        return content, False, "values_not_found"

    values_end = block_end(lines, idx_values, values_indent)

    idx_controllers = find_key_line(lines, idx_values + 1, values_end, values_indent + 2, "controllers")
    if idx_controllers is None:
        return content, False, "controllers_not_found"

    controllers_end = block_end(lines, idx_controllers, values_indent + 2)

    idx_main = find_key_line(lines, idx_controllers + 1, controllers_end, values_indent + 4, "main")
    if idx_main is None:
        return content, False, "controllers_main_not_found"

    main_end = block_end(lines, idx_main, values_indent + 4)

    idx_containers = find_key_line(lines, idx_main + 1, main_end, values_indent + 6, "containers")
    if idx_containers is None:
        return content, False, "containers_not_found"

    containers_end = block_end(lines, idx_containers, values_indent + 6)

    idx_container = find_key_line(
        lines,
        idx_containers + 1,
        containers_end,
        values_indent + 8,
        container_name,
    )
    if idx_container is None:
        return content, False, f"container_{container_name}_not_found"

    container_indent = values_indent + 8
    container_end = block_end(lines, idx_container, container_indent)

    idx_resources = find_key_line(
        lines,
        idx_container + 1,
        container_end,
        container_indent + 2,
        "resources",
    )

    new_block = resources_block(container_indent + 2, req_cpu, req_mem, lim_cpu, lim_mem)

    if idx_resources is None:
        lines[container_end:container_end] = new_block
        return "".join(lines), True, "resources_inserted"

    resources_end = block_end(lines, idx_resources, container_indent + 2)
    old_block = lines[idx_resources:resources_end]

    if old_block == new_block:
        return content, False, "resources_unchanged"

    lines[idx_resources:resources_end] = new_block
    return "".join(lines), True, "resources_replaced"


class KubeClient:
    def __init__(self) -> None:
        self.host = os.getenv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
        self.port = os.getenv("KUBERNETES_SERVICE_PORT", "443")
        self.base = f"https://{self.host}:{self.port}"

        token_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")
        ca_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
        self.token = token_path.read_text().strip() if token_path.exists() else ""

        self.ssl_context = (
            ssl.create_default_context(cafile=str(ca_path))
            if ca_path.exists()
            else ssl.create_default_context()
        )

    def request_json(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        url = f"{self.base}{path}"
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url=url, method=method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, context=self.ssl_context, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return resp.getcode(), json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                return exc.code, json.loads(detail)
            except Exception:
                return exc.code, {"message": detail}

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
            create_status, create_payload = self.request_json(
                "POST", f"/api/v1/namespaces/{namespace}/configmaps", body
            )
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
        put_status, put_payload = self.request_json(
            "PUT", f"/api/v1/namespaces/{namespace}/configmaps/{name}", body
        )
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
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            log(f"Prometheus query failed ({exc.code}): {detail}")
            return None
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
    escaped = re.escape(workload).replace("\\-", "-")
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


def write_outputs(report: dict, markdown: str) -> None:
    output_dir = Path(os.getenv("OUTPUT_DIR", "/tmp/resource-advisor"))
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "latest.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    (output_dir / "latest.md").write_text(markdown)
    log(f"Wrote local outputs to {output_dir}")


def github_request(method: str, url: str, token: str, payload: dict | None = None) -> tuple[int, dict]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url=url,
        method=method,
        data=data,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return resp.getcode(), json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(detail)
        except Exception:
            return exc.code, {"message": detail}


def ensure_branch(repository: str, base_branch: str, branch: str, token: str) -> bool:
    base_ref_url = (
        f"https://api.github.com/repos/{repository}/git/ref/heads/{urllib.parse.quote(base_branch, safe='')}"
    )
    status, payload = github_request("GET", base_ref_url, token)
    if status != 200:
        log(f"Failed to fetch base branch ref {base_branch}: {status} {payload}")
        return False

    base_sha = payload.get("object", {}).get("sha")
    if not base_sha:
        log(f"Missing SHA for base branch {base_branch}")
        return False

    branch_ref_url = (
        f"https://api.github.com/repos/{repository}/git/ref/heads/{urllib.parse.quote(branch, safe='')}"
    )
    status, payload = github_request("GET", branch_ref_url, token)
    if status == 200:
        current_sha = payload.get("object", {}).get("sha")
        if current_sha == base_sha:
            return True

        # Force-reset the working branch to the latest base so every run starts from current master.
        update_url = (
            f"https://api.github.com/repos/{repository}/git/refs/heads/{urllib.parse.quote(branch, safe='')}"
        )
        update_payload = {"sha": base_sha, "force": True}
        update_status, update_resp = github_request("PATCH", update_url, token, update_payload)
        if update_status not in (200, 201):
            log(
                f"Failed to reset branch {branch} to {base_branch}: "
                f"{update_status} {update_resp}"
            )
            return False
        log(f"Reset branch {branch} to latest {base_branch} ({base_sha[:12]})")
        return True
    if status != 404:
        log(f"Failed to check head branch {branch}: {status} {payload}")
        return False

    create_url = f"https://api.github.com/repos/{repository}/git/refs"
    create_payload = {
        "ref": f"refs/heads/{branch}",
        "sha": base_sha,
    }
    create_status, create_resp = github_request("POST", create_url, token, create_payload)
    if create_status not in (200, 201):
        log(f"Failed to create branch {branch}: {create_status} {create_resp}")
        return False

    log(f"Created branch {branch} from {base_branch}")
    return True


def read_repo_file(repository: str, branch: str, path: str, token: str) -> tuple[int, str | None, str | None]:
    file_ref = urllib.parse.quote(branch, safe="")
    url = f"https://api.github.com/repos/{repository}/contents/{path}?ref={file_ref}"
    status, payload = github_request("GET", url, token)

    if status == 404:
        return 404, None, None
    if status != 200:
        log(f"Failed to read {path} on branch {branch}: {status} {payload}")
        return status, None, None

    encoded = (payload.get("content") or "").replace("\n", "")
    content = ""
    if encoded:
        try:
            content = base64.b64decode(encoded).decode("utf-8")
        except Exception:
            content = ""
    return 200, payload.get("sha"), content


def update_repo_file(
    repository: str,
    branch: str,
    path: str,
    content: str,
    token: str,
    commit_message: str,
) -> bool:
    status, sha, existing = read_repo_file(repository, branch, path, token)
    if status not in (200, 404):
        return False

    if existing == content:
        return False

    put_url = f"https://api.github.com/repos/{repository}/contents/{path}"
    put_payload = {
        "message": commit_message,
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "branch": branch,
    }
    if sha:
        put_payload["sha"] = sha

    put_status, put_resp = github_request("PUT", put_url, token, put_payload)
    if put_status not in (200, 201):
        log(f"Failed to update {path}: {put_status} {put_resp}")
        return False

    log(f"Updated {path} on {branch}")
    return True


def ensure_pull_request(
    repository: str,
    token: str,
    head_branch: str,
    base_branch: str,
    title: str,
    body: str,
) -> None:
    owner, _ = repository.split("/", 1)
    pulls_url = f"https://api.github.com/repos/{repository}/pulls"
    head_query = urllib.parse.quote(f"{owner}:{head_branch}", safe="")
    base_query = urllib.parse.quote(base_branch, safe="")
    existing_url = f"{pulls_url}?state=open&head={head_query}&base={base_query}"

    existing_status, existing = github_request("GET", existing_url, token)
    if existing_status == 200 and isinstance(existing, list) and existing:
        pr = existing[0]
        number = pr.get("number")
        update_url = f"https://api.github.com/repos/{repository}/pulls/{number}"
        update_payload = {"title": title, "body": body}
        update_status, update_resp = github_request("PATCH", update_url, token, update_payload)
        if update_status in (200, 201):
            log(f"Updated existing PR for branch {head_branch}: {pr.get('html_url')}")
        else:
            log(
                "Failed to update existing PR metadata for branch "
                f"{head_branch}: {update_status} {update_resp}"
            )
        return
    if existing_status != 200:
        log(f"Failed checking existing PRs: {existing_status} {existing}")
        return

    payload = {
        "title": title,
        "head": head_branch,
        "base": base_branch,
        "body": body,
    }
    create_status, created = github_request("POST", pulls_url, token, payload)
    if create_status not in (200, 201):
        log(f"Failed to create PR: {create_status} {created}")
        return

    log(f"Created PR: {created.get('html_url')}")


def estimate_coverage_days(prom: PromClient) -> float:
    seconds = prom.query_scalar("time() - (max(prometheus_tsdb_lowest_timestamp) / 1000)")
    if seconds is None:
        seconds = prom.query_scalar('time() - max(process_start_time_seconds{job=~".*prometheus.*"})')
    if seconds is None:
        return 0.0
    return round(max(0.0, seconds) / 86400.0, 2)


def build_report() -> tuple[dict, str]:
    mode = os.getenv("MODE", "report").strip().lower() or "report"
    namespaces = env_list("TARGET_NAMESPACES", "default,monitoring")
    downscale_exclude = set(
        env_list(
            "DOWNSCALE_EXCLUDE",
            "jellyfin,immich,immich-postgres,machine-learning,prometheus,kube-prometheus-stack",
        )
    )

    max_step_percent = env_float("MAX_STEP_PERCENT", 25.0)
    request_buffer_percent = env_float("REQUEST_BUFFER_PERCENT", 30.0)
    limit_buffer_percent = env_float("LIMIT_BUFFER_PERCENT", 60.0)
    min_cpu_m = env_float("MIN_CPU_M", 25.0)
    min_mem_mi = env_float("MIN_MEM_MI", 64.0)
    deadband_percent = max(0.0, env_float("DEADBAND_PERCENT", 10.0))
    deadband_cpu_m = max(0.0, env_float("DEADBAND_CPU_M", 25.0))
    deadband_mem_mi = max(0.0, env_float("DEADBAND_MEM_MI", 64.0))

    metrics_window = os.getenv("METRICS_WINDOW", "14d").strip()
    metrics_resolution = os.getenv("METRICS_RESOLUTION", "1h").strip()

    prom = PromClient(
        os.getenv("PROMETHEUS_URL", "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090")
    )
    kube = KubeClient()

    coverage_days = estimate_coverage_days(prom)

    alloc_cpu_m = 0.0
    alloc_mem_mi = 0.0
    for node in kube.list_nodes():
        alloc = node.get("status", {}).get("allocatable", {})
        alloc_cpu_m += parse_cpu_to_m(alloc.get("cpu"))
        alloc_mem_mi += parse_mem_to_mi(alloc.get("memory"))

    recommendations: list[dict] = []
    containers_analyzed = 0
    containers_with_data = 0
    skipped_no_metrics = 0

    total_current_req_cpu_m = 0.0
    total_current_req_mem_mi = 0.0
    total_recommended_req_cpu_m = 0.0
    total_recommended_req_mem_mi = 0.0

    for namespace in namespaces:
        for kind in ("deployments", "statefulsets"):
            workloads = kube.list_workloads(namespace, kind)
            for workload in workloads:
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

                    total_current_req_cpu_m += cur_req_cpu
                    total_current_req_mem_mi += cur_req_mem

                    cpu_query = (
                        f'quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}",image!=""}}[5m])[{metrics_window}:{metrics_resolution}])'
                    )
                    mem_query = (
                        f'quantile_over_time(0.95, container_memory_working_set_bytes{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}",image!=""}}[{metrics_window}:{metrics_resolution}])'
                    )
                    restart_query = (
                        f'sum(increase(kube_pod_container_status_restarts_total{{namespace="{namespace}",'
                        f'pod=~"{pod_regex}",container="{container_name}"}}[{metrics_window}]))'
                    )

                    cpu_p95_cores = prom.query_scalar(cpu_query)
                    mem_p95_bytes = prom.query_scalar(mem_query)
                    restart_lookback = prom.query_scalar(restart_query) or 0.0

                    if cpu_p95_cores is None and mem_p95_bytes is None:
                        skipped_no_metrics += 1
                        total_recommended_req_cpu_m += cur_req_cpu
                        total_recommended_req_mem_mi += cur_req_mem
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

                    if restart_lookback > 0:
                        if rec_req_mem < cur_req_mem:
                            rec_req_mem = cur_req_mem
                        if rec_lim_mem < cur_lim_mem:
                            rec_lim_mem = cur_lim_mem
                        notes.append("restart_guard")

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

                    total_recommended_req_cpu_m += rec_req_cpu
                    total_recommended_req_mem_mi += rec_req_mem

                    req_cpu_delta = pct_delta(cur_req_cpu, rec_req_cpu)
                    req_mem_delta = pct_delta(cur_req_mem, rec_req_mem)
                    lim_cpu_delta = pct_delta(cur_lim_cpu, rec_lim_cpu)
                    lim_mem_delta = pct_delta(cur_lim_mem, rec_lim_mem)

                    req_cpu_abs_delta = abs(rec_req_cpu - cur_req_cpu)
                    req_mem_abs_delta = abs(rec_req_mem - cur_req_mem)
                    lim_cpu_abs_delta = abs(rec_lim_cpu - cur_lim_cpu)
                    lim_mem_abs_delta = abs(rec_lim_mem - cur_lim_mem)

                    significant_change = any(
                        (
                            is_material_delta(
                                req_cpu_delta,
                                req_cpu_abs_delta,
                                deadband_percent,
                                deadband_cpu_m,
                            ),
                            is_material_delta(
                                req_mem_delta,
                                req_mem_abs_delta,
                                deadband_percent,
                                deadband_mem_mi,
                            ),
                            is_material_delta(
                                lim_cpu_delta,
                                lim_cpu_abs_delta,
                                deadband_percent,
                                deadband_cpu_m,
                            ),
                            is_material_delta(
                                lim_mem_delta,
                                lim_mem_abs_delta,
                                deadband_percent,
                                deadband_mem_mi,
                            ),
                        )
                    )
                    if not significant_change:
                        continue

                    up_signal = (
                        (rec_req_cpu > cur_req_cpu)
                        and is_material_delta(
                            req_cpu_delta,
                            req_cpu_abs_delta,
                            deadband_percent,
                            deadband_cpu_m,
                        )
                    ) or (
                        (rec_req_mem > cur_req_mem)
                        and is_material_delta(
                            req_mem_delta,
                            req_mem_abs_delta,
                            deadband_percent,
                            deadband_mem_mi,
                        )
                    )
                    down_signal = (
                        (rec_req_cpu < cur_req_cpu)
                        and is_material_delta(
                            req_cpu_delta,
                            req_cpu_abs_delta,
                            deadband_percent,
                            deadband_cpu_m,
                        )
                    ) or (
                        (rec_req_mem < cur_req_mem)
                        and is_material_delta(
                            req_mem_delta,
                            req_mem_abs_delta,
                            deadband_percent,
                            deadband_mem_mi,
                        )
                    )

                    if up_signal:
                        action = "upsize"
                    elif down_signal:
                        action = "downsize"
                    else:
                        action = "no-change"

                    recommendations.append(
                        {
                            "namespace": namespace,
                            "kind": kind[:-1],
                            "workload": workload_name,
                            "release": release,
                            "container": container_name,
                            "restarts_window": round(restart_lookback, 2),
                            "cpu_p95_m": round(cpu_p95_m, 1),
                            "mem_p95_mi": round(mem_p95_mi, 1),
                            "current": {
                                "requests": {
                                    "cpu": fmt_cpu_m(cur_req_cpu),
                                    "memory": fmt_mem_mi(cur_req_mem),
                                },
                                "limits": {
                                    "cpu": fmt_cpu_m(cur_lim_cpu),
                                    "memory": fmt_mem_mi(cur_lim_mem),
                                },
                            },
                            "recommended": {
                                "requests": {
                                    "cpu": fmt_cpu_m(rec_req_cpu),
                                    "memory": fmt_mem_mi(rec_req_mem),
                                },
                                "limits": {
                                    "cpu": fmt_cpu_m(rec_lim_cpu),
                                    "memory": fmt_mem_mi(rec_lim_mem),
                                },
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
            -(item.get("restarts_window", 0.0)),
            -max(
                abs(item.get("delta_percent", {}).get("requests_memory", 0.0)),
                abs(item.get("delta_percent", {}).get("limits_memory", 0.0)),
                abs(item.get("delta_percent", {}).get("requests_cpu", 0.0)),
                abs(item.get("delta_percent", {}).get("limits_cpu", 0.0)),
            ),
        )
    )

    budget = {
        "allocatable": {
            "cpu": fmt_cpu_m(alloc_cpu_m),
            "memory": fmt_mem_mi(alloc_mem_mi),
        },
        "current_requests_percent_of_allocatable": {
            "cpu": round((total_current_req_cpu_m / alloc_cpu_m) * 100.0, 1) if alloc_cpu_m > 0 else None,
            "memory": round((total_current_req_mem_mi / alloc_mem_mi) * 100.0, 1) if alloc_mem_mi > 0 else None,
        },
        "recommended_requests_percent_of_allocatable": {
            "cpu": round((total_recommended_req_cpu_m / alloc_cpu_m) * 100.0, 1) if alloc_cpu_m > 0 else None,
            "memory": round((total_recommended_req_mem_mi / alloc_mem_mi) * 100.0, 1) if alloc_mem_mi > 0 else None,
        },
    }

    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    report = {
        "generated_at": generated_at,
        "mode": mode,
        "metrics_window": metrics_window,
        "metrics_coverage_days_estimate": coverage_days,
        "policy": {
            "max_step_percent": round(max_step_percent, 2),
            "request_buffer_percent": round(request_buffer_percent, 2),
            "limit_buffer_percent": round(limit_buffer_percent, 2),
            "deadband_percent": round(deadband_percent, 2),
            "deadband_cpu_m": round(deadband_cpu_m, 2),
            "deadband_mem_mi": round(deadband_mem_mi, 2),
        },
        "summary": {
            "containers_analyzed": containers_analyzed,
            "containers_with_metrics": containers_with_data,
            "containers_skipped_no_metrics": skipped_no_metrics,
            "recommendation_count": len(recommendations),
            "upsize_count": sum(1 for item in recommendations if item["action"] == "upsize"),
            "downsize_count": sum(1 for item in recommendations if item["action"] == "downsize"),
            "no_change_count": sum(1 for item in recommendations if item["action"] == "no-change"),
            "total_current_requests_cpu_m": round(total_current_req_cpu_m, 1),
            "total_current_requests_memory_mi": round(total_current_req_mem_mi, 1),
            "total_recommended_requests_cpu_m": round(total_recommended_req_cpu_m, 1),
            "total_recommended_requests_memory_mi": round(total_recommended_req_mem_mi, 1),
        },
        "budget": budget,
        "recommendations": recommendations,
    }

    lines = [
        "# Resource Advisor Report",
        "",
        f"- Generated at: `{generated_at}`",
        f"- Mode: `{mode}`",
        f"- Metrics window: `{metrics_window}`",
        f"- Metrics coverage estimate: `{coverage_days}` days",
        f"- Containers analyzed: **{containers_analyzed}**",
        f"- Containers with metrics: **{containers_with_data}**",
        f"- Recommendations: **{len(recommendations)}**",
        "",
        "## Cluster Budget Snapshot",
        "",
        (
            "- Deadband policy: "
            f"`{deadband_percent}%` or CPU delta `>= {deadband_cpu_m}m` or "
            f"Memory delta `>= {deadband_mem_mi}Mi`"
        ),
        f"- Allocatable CPU: `{budget['allocatable']['cpu']}`",
        f"- Allocatable Memory: `{budget['allocatable']['memory']}`",
        (
            "- Current requests as % allocatable CPU: "
            f"`{budget['current_requests_percent_of_allocatable']['cpu']}`"
        ),
        (
            "- Current requests as % allocatable Memory: "
            f"`{budget['current_requests_percent_of_allocatable']['memory']}`"
        ),
        (
            "- Recommended requests as % allocatable CPU: "
            f"`{budget['recommended_requests_percent_of_allocatable']['cpu']}`"
        ),
        (
            "- Recommended requests as % allocatable Memory: "
            f"`{budget['recommended_requests_percent_of_allocatable']['memory']}`"
        ),
        "",
    ]

    if coverage_days < 14:
        lines.append("## Data Maturity Notice")
        lines.append("")
        lines.append(
            "Prometheus coverage is below 14 days. Use extra caution for downsizing decisions "
            "until the 14-day window is fully populated."
        )
        lines.append("")

    if recommendations:
        lines.extend(
            [
                "## Recommendations",
                "",
                "| Namespace | Workload | Container | CPU req | CPU rec | Mem req | Mem rec | Action | Notes |",
                "|---|---|---|---:|---:|---:|---:|---|---|",
            ]
        )
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
        lines.extend(["## Recommendations", "", "No significant tuning deltas were identified in this run."])

    markdown = "\n".join(lines) + "\n"
    return report, markdown


def build_apply_plan(report: dict) -> tuple[dict, str]:
    recommendations = report.get("recommendations", [])
    coverage_days = float(report.get("metrics_coverage_days_estimate") or 0.0)

    cpu_budget_pct = env_float("MAX_REQUESTS_PERCENT_CPU", 60.0)
    mem_budget_pct = env_float("MAX_REQUESTS_PERCENT_MEMORY", 65.0)
    max_changes = env_int("MAX_APPLY_CHANGES_PER_RUN", 5)
    min_days_upsize = env_float("MIN_DATA_DAYS_FOR_UPSIZE", 14.0)
    min_days_downsize = env_float("MIN_DATA_DAYS_FOR_DOWNSIZE", 14.0)

    allowlist_default = ",".join(sorted(APP_TEMPLATE_RELEASE_FILE_MAP.keys()))
    allowlist = set(env_list("APPLY_ALLOWLIST", allowlist_default))

    alloc_cpu_m = parse_cpu_to_m(report.get("budget", {}).get("allocatable", {}).get("cpu"))
    alloc_mem_mi = parse_mem_to_mi(report.get("budget", {}).get("allocatable", {}).get("memory"))
    cpu_budget_m = alloc_cpu_m * (cpu_budget_pct / 100.0)
    mem_budget_mi = alloc_mem_mi * (mem_budget_pct / 100.0)

    current_cpu_m = float(report.get("summary", {}).get("total_current_requests_cpu_m", 0.0))
    current_mem_mi = float(report.get("summary", {}).get("total_current_requests_memory_mi", 0.0))

    downsizes = []
    upsizes = []
    skipped = []

    for rec in recommendations:
        release = rec.get("release", "")
        container = rec.get("container", "")
        notes = rec.get("notes", [])

        if release not in allowlist:
            skipped.append({"reason": "not_allowlisted", "release": release, "container": container})
            continue

        path = APP_TEMPLATE_RELEASE_FILE_MAP.get(release)
        if not path:
            skipped.append({"reason": "path_not_mapped", "release": release, "container": container})
            continue

        cur_req_cpu = parse_cpu_to_m(rec.get("current", {}).get("requests", {}).get("cpu"))
        cur_req_mem = parse_mem_to_mi(rec.get("current", {}).get("requests", {}).get("memory"))
        rec_req_cpu = parse_cpu_to_m(rec.get("recommended", {}).get("requests", {}).get("cpu"))
        rec_req_mem = parse_mem_to_mi(rec.get("recommended", {}).get("requests", {}).get("memory"))

        cur_lim_cpu = rec.get("current", {}).get("limits", {}).get("cpu", "0m")
        cur_lim_mem = rec.get("current", {}).get("limits", {}).get("memory", "0Mi")
        rec_lim_cpu = rec.get("recommended", {}).get("limits", {}).get("cpu", "0m")
        rec_lim_mem = rec.get("recommended", {}).get("limits", {}).get("memory", "0Mi")

        delta_cpu = rec_req_cpu - cur_req_cpu
        delta_mem = rec_req_mem - cur_req_mem

        if abs(delta_cpu) < 1.0 and abs(delta_mem) < 1.0:
            continue

        item = {
            "namespace": rec.get("namespace"),
            "workload": rec.get("workload"),
            "release": release,
            "container": container,
            "path": path,
            "notes": notes,
            "current": {
                "requests": {
                    "cpu": rec.get("current", {}).get("requests", {}).get("cpu", "0m"),
                    "memory": rec.get("current", {}).get("requests", {}).get("memory", "0Mi"),
                },
                "limits": {
                    "cpu": cur_lim_cpu,
                    "memory": cur_lim_mem,
                },
            },
            "recommended": {
                "requests": {
                    "cpu": rec.get("recommended", {}).get("requests", {}).get("cpu", "0m"),
                    "memory": rec.get("recommended", {}).get("requests", {}).get("memory", "0Mi"),
                },
                "limits": {
                    "cpu": rec_lim_cpu,
                    "memory": rec_lim_mem,
                },
            },
            "delta": {
                "requests_cpu_m": round(delta_cpu, 1),
                "requests_memory_mi": round(delta_mem, 1),
            },
            "priority": (
                1 if "restart_guard" in notes else 0,
                rec.get("restarts_window", 0),
                abs(delta_mem) + abs(delta_cpu / 10.0),
            ),
        }

        is_upsize = delta_cpu > 0 or delta_mem > 0

        if is_upsize:
            if coverage_days < min_days_upsize and "restart_guard" not in notes:
                skipped.append({
                    "reason": "insufficient_data_for_upsize",
                    "coverage_days": coverage_days,
                    "min_days": min_days_upsize,
                    "release": release,
                    "container": container,
                })
                continue
            upsizes.append(item)
            continue

        # Downsize path
        if "restart_guard" in notes:
            skipped.append({"reason": "restart_guard_blocks_downsize", "release": release, "container": container})
            continue
        if "downscale_excluded" in notes:
            skipped.append({"reason": "downscale_excluded", "release": release, "container": container})
            continue
        if coverage_days < min_days_downsize:
            skipped.append({
                "reason": "insufficient_data_for_downsize",
                "coverage_days": coverage_days,
                "min_days": min_days_downsize,
                "release": release,
                "container": container,
            })
            continue
        downsizes.append(item)

    downsizes.sort(key=lambda x: -(abs(x["delta"]["requests_memory_mi"]) + abs(x["delta"]["requests_cpu_m"] / 10.0)))
    upsizes.sort(key=lambda x: (-x["priority"][0], -x["priority"][1], -x["priority"][2]))

    selected = []
    projected_cpu_m = current_cpu_m
    projected_mem_mi = current_mem_mi

    for item in downsizes:
        if len(selected) >= max_changes:
            skipped.append({"reason": "max_changes_reached", "release": item["release"], "container": item["container"]})
            continue
        projected_cpu_m += item["delta"]["requests_cpu_m"]
        projected_mem_mi += item["delta"]["requests_memory_mi"]
        item["selection_reason"] = "downsize_with_mature_data"
        selected.append(item)

    for item in upsizes:
        if len(selected) >= max_changes:
            skipped.append({"reason": "max_changes_reached", "release": item["release"], "container": item["container"]})
            continue

        next_cpu = projected_cpu_m + item["delta"]["requests_cpu_m"]
        next_mem = projected_mem_mi + item["delta"]["requests_memory_mi"]

        if next_cpu > cpu_budget_m or next_mem > mem_budget_mi:
            skipped.append(
                {
                    "reason": "budget_guard_block",
                    "release": item["release"],
                    "container": item["container"],
                    "projected_cpu_m": round(next_cpu, 1),
                    "projected_mem_mi": round(next_mem, 1),
                    "cpu_budget_m": round(cpu_budget_m, 1),
                    "mem_budget_mi": round(mem_budget_mi, 1),
                }
            )
            continue

        projected_cpu_m = next_cpu
        projected_mem_mi = next_mem
        item["selection_reason"] = "upsize_within_budget"
        selected.append(item)

    plan = {
        "generated_at": report.get("generated_at"),
        "metrics_window": report.get("metrics_window"),
        "metrics_coverage_days_estimate": coverage_days,
        "constraints": {
            "max_request_percent_cpu": cpu_budget_pct,
            "max_request_percent_memory": mem_budget_pct,
            "min_data_days_for_upsize": min_days_upsize,
            "min_data_days_for_downsize": min_days_downsize,
            "max_apply_changes_per_run": max_changes,
            "deadband_percent": report.get("policy", {}).get("deadband_percent"),
            "deadband_cpu_m": report.get("policy", {}).get("deadband_cpu_m"),
            "deadband_mem_mi": report.get("policy", {}).get("deadband_mem_mi"),
        },
        "current_requests": {
            "cpu_m": round(current_cpu_m, 1),
            "memory_mi": round(current_mem_mi, 1),
        },
        "projected_requests_after_selected": {
            "cpu_m": round(projected_cpu_m, 1),
            "memory_mi": round(projected_mem_mi, 1),
        },
        "budgets": {
            "cpu_m": round(cpu_budget_m, 1),
            "memory_mi": round(mem_budget_mi, 1),
        },
        "selected": selected,
        "skipped": skipped,
    }

    md_lines = [
        "# Resource Advisor Apply Plan",
        "",
        f"- Generated at: `{plan['generated_at']}`",
        f"- Metrics window: `{plan['metrics_window']}`",
        f"- Coverage estimate: `{coverage_days}` days",
        f"- Selected changes: **{len(selected)}**",
        f"- Skipped candidates: **{len(skipped)}**",
        "",
        "## Node Constraint Gates",
        "",
        (
            "- Deadband policy: "
            f"`{plan['constraints']['deadband_percent']}%` or CPU delta "
            f"`>= {plan['constraints']['deadband_cpu_m']}m` or Memory delta "
            f"`>= {plan['constraints']['deadband_mem_mi']}Mi`"
        ),
        f"- CPU budget (`requests`): `{plan['budgets']['cpu_m']}m`",
        f"- Memory budget (`requests`): `{plan['budgets']['memory_mi']}Mi`",
        f"- Current CPU requests: `{plan['current_requests']['cpu_m']}m`",
        f"- Current Memory requests: `{plan['current_requests']['memory_mi']}Mi`",
        f"- Projected CPU requests: `{plan['projected_requests_after_selected']['cpu_m']}m`",
        f"- Projected Memory requests: `{plan['projected_requests_after_selected']['memory_mi']}Mi`",
        "",
    ]

    if selected:
        md_lines.extend(
            [
                "## Selected Changes",
                "",
                "| Release | Container | CPU req | CPU new | Mem req | Mem new | Reason |",
                "|---|---|---:|---:|---:|---:|---|",
            ]
        )
        for item in selected:
            md_lines.append(
                "| {release} | {container} | {cur_cpu} | {new_cpu} | {cur_mem} | {new_mem} | {reason} |".format(
                    release=item["release"],
                    container=item["container"],
                    cur_cpu=item["current"]["requests"]["cpu"],
                    new_cpu=item["recommended"]["requests"]["cpu"],
                    cur_mem=item["current"]["requests"]["memory"],
                    new_mem=item["recommended"]["requests"]["memory"],
                    reason=item.get("selection_reason", ""),
                )
            )
    else:
        md_lines.extend(["## Selected Changes", "", "No changes selected for apply in this run."])

    md_lines.append("")
    md_lines.append("## Skipped Candidates")
    md_lines.append("")
    skip_reason_counts: dict[str, int] = {}
    for item in skipped:
        reason = item.get("reason", "unknown")
        skip_reason_counts[reason] = skip_reason_counts.get(reason, 0) + 1

    if skip_reason_counts:
        for reason, count in sorted(skip_reason_counts.items()):
            md_lines.append(f"- `{reason}`: {count}")
    else:
        md_lines.append("- none")

    md_lines.append("")

    return plan, "\n".join(md_lines) + "\n"


def describe_tune_action(item: dict) -> str:
    delta = item.get("delta", {})
    delta_cpu = float(delta.get("requests_cpu_m", 0.0) or 0.0)
    delta_mem = float(delta.get("requests_memory_mi", 0.0) or 0.0)

    cpu_action = "Increase" if delta_cpu > 0 else "Decrease" if delta_cpu < 0 else ""
    mem_action = "Increase" if delta_mem > 0 else "Decrease" if delta_mem < 0 else ""

    if cpu_action and mem_action:
        if cpu_action == mem_action:
            return f"{cpu_action} CPU and memory"
        return f"{cpu_action} CPU and {mem_action.lower()} memory"
    if mem_action:
        return f"{mem_action} memory"
    if cpu_action:
        return f"{cpu_action} CPU"
    return "Adjust resources"


def sanitize_tune_subject(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "resource-advisor"


def build_apply_pr_title(plan: dict) -> str:
    selected = plan.get("selected", [])
    if not selected:
        return "tune/resource-advisor: refresh apply plan"

    primary = selected[0]
    service = sanitize_tune_subject(str(primary.get("release", "resource-advisor")))
    action = describe_tune_action(primary)

    if len(selected) == 1:
        return f"tune/{service}: {action}"

    return f"tune/{service}: {action} (+{len(selected) - 1} more)"


def build_apply_branch_name(branch_hint: str, plan: dict) -> str:
    selected = plan.get("selected", [])
    now_tag = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S%f")

    if "/" in branch_hint:
        prefix = sanitize_tune_subject(branch_hint.split("/", 1)[0])
    else:
        prefix = "tune"

    if selected:
        primary = selected[0]
        service = sanitize_tune_subject(str(primary.get("release", "resource-advisor")))
        action = sanitize_tune_subject(describe_tune_action(primary))
        base = f"{prefix}/{service}-{action}"
    else:
        base = f"{prefix}/resource-advisor-refresh-apply-plan"

    suffix = f"-{now_tag}"
    max_len = 120
    allowed_base_len = max_len - len(suffix)
    if len(base) > allowed_base_len:
        base = base[:allowed_base_len].rstrip("-")
    branch = f"{base}{suffix}"
    return branch


def open_or_update_apply_pr(report: dict, plan: dict) -> None:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        log("GITHUB_TOKEN is not set; skipping apply PR mode work")
        return

    selected = plan.get("selected", [])
    if not selected:
        log("No selected recommendations for apply mode; skipping PR")
        return

    repository = os.getenv("GITHUB_REPOSITORY", "khzaw/rangoonpulse").strip()
    base_branch = os.getenv("GITHUB_BASE_BRANCH", "master").strip()
    head_branch_hint = os.getenv("GITHUB_APPLY_HEAD_BRANCH", "tune/resource-advisor-apply").strip()

    if "/" not in repository:
        log(f"Invalid GITHUB_REPOSITORY: {repository}")
        return

    head_branch = build_apply_branch_name(head_branch_hint, plan)
    log(f"Using apply PR branch: {head_branch}")

    if not ensure_branch(repository, base_branch, head_branch, token):
        return

    changed = False

    grouped: dict[str, list[dict]] = {}
    for item in selected:
        grouped.setdefault(item["path"], []).append(item)

    for path, items in grouped.items():
        status, _sha, content = read_repo_file(repository, head_branch, path, token)
        if status != 200 or content is None:
            log(f"Skipping {path}; unable to fetch content")
            continue

        patched = content
        any_item_applied = False

        for item in items:
            patched, item_changed, reason = patch_app_template_resources(
                content=patched,
                container_name=item["container"],
                req_cpu=item["recommended"]["requests"]["cpu"],
                req_mem=item["recommended"]["requests"]["memory"],
                lim_cpu=item["recommended"]["limits"]["cpu"],
                lim_mem=item["recommended"]["limits"]["memory"],
            )
            if item_changed:
                any_item_applied = True
            else:
                log(
                    "No patch for "
                    f"{item['release']}:{item['container']} in {path} ({reason})"
                )

        if not any_item_applied:
            continue

        file_changed = update_repo_file(
            repository=repository,
            branch=head_branch,
            path=path,
            content=patched,
            token=token,
            commit_message="resource-advisor: apply safe resource tuning",
        )
        changed = file_changed or changed

    if not changed:
        log("No repository changes for apply mode; skipping PR")
        return

    title = build_apply_pr_title(plan)
    skip_reason_counts: dict[str, int] = {}
    for item in plan.get("skipped", []):
        reason = item.get("reason", "unknown")
        skip_reason_counts[reason] = skip_reason_counts.get(reason, 0) + 1

    selected_lines = []
    for item in selected[:20]:
        selected_lines.append(
            "- `{release}/{container}`: CPU `{cur_cpu}` -> `{new_cpu}`, "
            "Memory `{cur_mem}` -> `{new_mem}`; rationale: `{reason}`; notes: `{notes}`".format(
                release=item.get("release"),
                container=item.get("container"),
                cur_cpu=item.get("current", {}).get("requests", {}).get("cpu"),
                new_cpu=item.get("recommended", {}).get("requests", {}).get("cpu"),
                cur_mem=item.get("current", {}).get("requests", {}).get("memory"),
                new_mem=item.get("recommended", {}).get("requests", {}).get("memory"),
                reason=item.get("selection_reason", "policy-selected"),
                notes=",".join(item.get("notes", [])) or "none",
            )
        )
    if len(selected) > 20:
        selected_lines.append(f"- ... and {len(selected) - 20} more")

    skipped_lines = []
    for reason, count in sorted(skip_reason_counts.items()):
        skipped_lines.append(f"- `{reason}`: {count}")
    if not skipped_lines:
        skipped_lines.append("- none")

    body = (
        "Automated safe resource apply proposal.\n\n"
        "## Constraints\n"
        f"- Metrics window: `{report.get('metrics_window')}`\n"
        f"- Metrics coverage estimate: `{plan.get('metrics_coverage_days_estimate')}` days\n"
        f"- Deadband policy: `{report.get('policy', {}).get('deadband_percent')}%` "
        f"or CPU delta `>= {report.get('policy', {}).get('deadband_cpu_m')}m` "
        f"or Memory delta `>= {report.get('policy', {}).get('deadband_mem_mi')}Mi`\n"
        f"- CPU request budget: `{plan.get('budgets', {}).get('cpu_m')}m`\n"
        f"- Memory request budget: `{plan.get('budgets', {}).get('memory_mi')}Mi`\n"
        f"- Current requests: CPU `{plan.get('current_requests', {}).get('cpu_m')}m`, "
        f"Memory `{plan.get('current_requests', {}).get('memory_mi')}Mi`\n"
        f"- Projected requests after selected changes: CPU "
        f"`{plan.get('projected_requests_after_selected', {}).get('cpu_m')}m`, Memory "
        f"`{plan.get('projected_requests_after_selected', {}).get('memory_mi')}Mi`\n\n"
        "## Selected Changes\n"
        + "\n".join(selected_lines)
        + "\n\n## Skipped Candidates (Reason Summary)\n"
        + "\n".join(skipped_lines)
        + "\n\n## Report Source\n"
        "- Latest machine-readable report is in ConfigMap "
        "`monitoring/resource-advisor-latest`.\n"
        "- This PR intentionally includes HelmRelease resource changes only.\n"
    )

    ensure_pull_request(
        repository=repository,
        token=token,
        head_branch=head_branch,
        base_branch=base_branch,
        title=title,
        body=body,
    )


def main() -> int:
    mode = os.getenv("MODE", "report").strip().lower() or "report"
    configmap_namespace = os.getenv("CONFIGMAP_NAMESPACE", "monitoring")
    configmap_name = os.getenv("CONFIGMAP_NAME", "resource-advisor-latest")

    log(f"Starting resource advisor in mode={mode}")
    report, report_md = build_report()

    write_outputs(report, report_md)

    kube = KubeClient()
    kube.upsert_configmap(
        namespace=configmap_namespace,
        name=configmap_name,
        data={
            "latest.json": json.dumps(report, indent=2, sort_keys=True),
            "latest.md": report_md,
            "lastRunAt": report.get("generated_at", ""),
            "mode": mode,
        },
    )

    if mode == "pr":
        log("Mode=pr is disabled. Reports are published to ConfigMap only.")
    elif mode == "apply-pr":
        plan, _ = build_apply_plan(report)
        open_or_update_apply_pr(report, plan)

    log("Resource advisor run completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"Fatal error: {exc}")
        raise
