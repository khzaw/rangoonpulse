import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from power import ApiClient, PowerCollector

PORT = int(os.environ.get("PORT", "9118"))
TRUENAS_API_BASE = os.environ.get("TRUENAS_API_BASE", "http://10.0.0.210/api/v2.0").rstrip("/")
TRUENAS_USERNAME = os.environ["TRUENAS_USERNAME"]
TRUENAS_PASSWORD = os.environ["TRUENAS_PASSWORD"]
POWER = PowerCollector(
    ApiClient(TRUENAS_API_BASE, TRUENAS_USERNAME, TRUENAS_PASSWORD),
    platform_watts=float(os.environ.get("TRUENAS_PLATFORM_IDLE_WATTS", "12")),
    cpu_watts=float(os.environ.get("TRUENAS_CPU_DYNAMIC_WATTS", "10")),
)
KUBE_API = "https://{}:{}".format(
    os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc"),
    os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443"),
)
TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"


def _read_token():
    with open(TOKEN_PATH, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def _kube_get(path):
    req = urllib.request.Request(KUBE_API + path)
    req.add_header("Authorization", "Bearer " + _read_token())
    ctx = ssl.create_default_context(cafile=CA_PATH)
    with urllib.request.urlopen(req, timeout=20, context=ctx) as response:
        return json.load(response)


def _truenas_get(path):
    req = urllib.request.Request(TRUENAS_API_BASE + path)
    auth = base64.b64encode(f"{TRUENAS_USERNAME}:{TRUENAS_PASSWORD}".encode()).decode("ascii")
    req.add_header("Authorization", "Basic " + auth)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def _prop(item, key, default=0):
    value = item.get(key, default)
    if isinstance(value, dict):
        for field in ("parsed", "rawvalue", "value"):
            if field in value and value[field] not in (None, ""):
                value = value[field]
                break
        else:
            return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _label(value):
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _metric(name, labels, value):
    label_text = ",".join(f'{key}="{_label(val)}"' for key, val in sorted(labels.items()))
    return f"{name}{{{label_text}}} {value}\n"


def _collect():
    lines = [
        "# HELP truenas_pvc_dataset_used_bytes TrueNAS ZFS dataset bytes used by dataset for Kubernetes PVC-backed datasets.\n",
        "# TYPE truenas_pvc_dataset_used_bytes gauge\n",
        "# HELP truenas_pvc_dataset_available_bytes TrueNAS ZFS dataset available bytes for Kubernetes PVC-backed datasets.\n",
        "# TYPE truenas_pvc_dataset_available_bytes gauge\n",
        "# HELP truenas_pvc_dataset_capacity_bytes Effective dataset capacity bytes for Kubernetes PVC-backed datasets.\n",
        "# TYPE truenas_pvc_dataset_capacity_bytes gauge\n",
        "# HELP truenas_pvc_dataset_utilization_ratio TrueNAS ZFS dataset utilization ratio for Kubernetes PVC-backed datasets.\n",
        "# TYPE truenas_pvc_dataset_utilization_ratio gauge\n",
        "# HELP truenas_pvc_dataset_scrape_success TrueNAS dataset scrape success by PVC-backed dataset.\n",
        "# TYPE truenas_pvc_dataset_scrape_success gauge\n",
        "# HELP truenas_pvc_dataset_last_scrape_timestamp_seconds Last successful TrueNAS dataset scrape timestamp.\n",
        "# TYPE truenas_pvc_dataset_last_scrape_timestamp_seconds gauge\n",
    ]
    now = int(time.time())
    pvs = _kube_get("/api/v1/persistentvolumes").get("items", [])
    datasets = {item.get("name"): item for item in _truenas_get("/pool/dataset")}
    for pv in pvs:
        spec = pv.get("spec", {})
        csi = spec.get("csi") or {}
        attrs = csi.get("volumeAttributes") or {}
        share = attrs.get("share", "")
        claim = spec.get("claimRef") or {}
        namespace = claim.get("namespace")
        pvc = claim.get("name")
        if not namespace or not pvc or not share.startswith("/mnt/"):
            continue
        driver = csi.get("driver", "")
        if not driver.startswith("org.democratic-csi"):
            continue
        dataset = share.removeprefix("/mnt/")
        labels = {
            "namespace": namespace,
            "persistentvolumeclaim": pvc,
            "persistentvolume": pv.get("metadata", {}).get("name", ""),
            "storageclass": spec.get("storageClassName", ""),
            "dataset": dataset,
            "pool": dataset.split("/", 1)[0],
        }
        try:
            item = datasets[dataset]
            used = _prop(item, "usedbydataset")
            available = _prop(item, "available")
            refquota = _prop(item, "refquota")
            quota = _prop(item, "quota")
            capacity = refquota or quota or used + available
            utilization = used / capacity if capacity > 0 else 0
            lines.append(_metric("truenas_pvc_dataset_used_bytes", labels, used))
            lines.append(_metric("truenas_pvc_dataset_available_bytes", labels, available))
            lines.append(_metric("truenas_pvc_dataset_capacity_bytes", labels, capacity))
            lines.append(_metric("truenas_pvc_dataset_utilization_ratio", labels, utilization))
            lines.append(_metric("truenas_pvc_dataset_scrape_success", labels, 1))
            lines.append(_metric("truenas_pvc_dataset_last_scrape_timestamp_seconds", labels, now))
        except Exception as exc:  # noqa: BLE001 - isolate individual dataset failures.
            error_labels = dict(labels)
            error_labels["error"] = exc.__class__.__name__
            lines.append(_metric("truenas_pvc_dataset_scrape_success", error_labels, 0))
    return "".join(lines).encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok\n")
            return
        if self.path.split("?", 1)[0] == "/power":
            body = POWER.collect().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?", 1)[0] != "/metrics":
            self.send_response(404)
            self.end_headers()
            return
        try:
            body = _collect()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001 - bounded HTTP error boundary.
            body = f"collector error: {exc.__class__.__name__}\n".encode()
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"serving TrueNAS PVC dataset metrics on :{PORT}", flush=True)
    server.serve_forever()
