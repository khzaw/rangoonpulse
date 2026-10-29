"""Software-only NAS power model. No NAS installation or persistent sampler."""

import base64
import json
import math
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

# Rounded engineering allowances, not measured wall watts. See the power docs.
DRIVES = {"ST8000VN004": (8.0, 10.0), "ST8000NT001": (8.0, 10.0), "ST8000VN002": (4.0, 6.0)}


def metric(name, value):
    return f'{name}{{host="truenas"}} {value}\n'


class ApiClient:
    """Reuse the NAS middleware's supported file API; no NAS script or daemon.

    Non-buffered downloads stream tiny proc files, not a ramfs copy. One-off
    download URLs and credentials never enter logs, metrics or persistent state.
    """

    def __init__(self, base, username, password):
        self.base = base.rstrip("/")
        parts = urllib.parse.urlsplit(self.base)
        self.origin = urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))
        self.auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
        origin = self.origin

        class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                destination = urllib.parse.urlsplit(newurl)
                if f"{destination.scheme}://{destination.netloc}" != origin:
                    raise ValueError("Refusing a cross-origin telemetry redirect")
                return super().redirect_request(req, fp, code, msg, headers, newurl)

        self.opener = urllib.request.build_opener(SameOriginRedirect())

    def _request(self, url, deadline, body=None, limit=1048576, authenticated=True):
        # urllib's socket timeout is per read, not a deadline for DNS/headers.
        # A short-lived cluster-side worker provides a hard wall-clock bound;
        # credentials travel only over stdin. Kill/reap it before releasing state.
        remaining = min(3, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError("NAS power collection deadline exceeded")
        payload = {"base": self.base, "auth": self.auth, "url": url, "deadline": deadline,
                   "body": body, "limit": limit, "authenticated": authenticated}
        with subprocess.Popen([sys.executable, __file__], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as worker:
            try:
                data, _ = worker.communicate(json.dumps(payload).encode(), timeout=remaining)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.communicate()
                raise TimeoutError("NAS telemetry worker exceeded deadline") from None
            if worker.returncode != 0 or len(data) > limit:
                raise ValueError("NAS telemetry request failed")
        return data

    def _fetch(self, url, deadline, body=None, limit=1048576, authenticated=True):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("NAS power collection deadline exceeded")
        headers = {"Accept": "application/json"}
        if authenticated:
            headers["Authorization"] = self.auth
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with self.opener.open(request, timeout=min(3, remaining)) as response:
            data = bytearray()
            while len(data) <= limit:
                if time.monotonic() >= deadline:
                    raise TimeoutError("NAS telemetry stream exceeded deadline")
                chunk = response.read1(min(65536, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
        if len(data) > limit or time.monotonic() > deadline:
            raise ValueError("NAS telemetry response exceeded collection bounds")
        return data

    def get(self, path, deadline):
        return json.loads(self._request(self.base + path, deadline))

    def read_file(self, path, deadline):
        if path not in ("/proc/stat", "/proc/diskstats"):
            raise ValueError("Not a permitted telemetry source")
        result = json.loads(self._request(self.base + "/core/download", deadline, {
            "method": "filesystem.get", "args": [path], "filename": "telemetry.txt", "buffered": False,
        }))
        if not isinstance(result, list) or len(result) != 2 or not isinstance(result[1], str):
            raise ValueError("Invalid telemetry download response")
        url = urllib.parse.urlsplit(result[1])
        if url.scheme or url.netloc or not url.path.startswith("/_download/") or not url.path[len("/_download/"):].isdigit():
            raise ValueError("Telemetry download must stay on the NAS origin")
        return self._request(self.origin + result[1], deadline, limit=131072, authenticated=False).decode()


class PowerCollector:
    def __init__(self, api, clock=time, platform_watts=12.0, cpu_watts=10.0):
        if any(not math.isfinite(value) or value <= 0 for value in (platform_watts, cpu_watts)):
            raise ValueError("Power allowances must be positive and finite")
        self.lock = threading.Lock()
        self.api = api
        self.clock = clock
        self.platform_watts = platform_watts
        self.cpu_watts = cpu_watts
        self.previous = None

    def collect(self):
        if not self.lock.acquire(blocking=False):
            return metric("truenas_power_scrape_success", 0)
        try:
            return self._sample()
        except Exception:  # noqa: BLE001 - fail closed at the collection boundary.
            # A later scrape retries from fresh counters; never replay old watts.
            self.previous = None
            return metric("truenas_power_scrape_success", 0)
        finally:
            self.lock.release()

    def _sample(self):
        deadline = self.clock.monotonic() + 10
        inventory = self.api.get("/disk", deadline)
        cpu_text = self.api.read_file("/proc/stat", deadline)
        disk_text = self.api.read_file("/proc/diskstats", deadline)
        cpu_lines = [line.split() for line in cpu_text.splitlines()]
        cpu = next([int(x) for x in line[1:9]] for line in cpu_lines if line[0] == "cpu")
        boot = next(int(line[1]) for line in cpu_lines if line[0] == "btime")
        disks = {line[2]: int(line[12]) for line in map(str.split, disk_text.splitlines())}
        drives = [(item["name"], item["model"].split("-", 1)[0]) for item in inventory if item.get("rotationrate")]
        if sorted(model for _, model in drives) != sorted(DRIVES):
            raise ValueError("Drive inventory does not match the power model")
        identities = sorted((item["name"], item.get("identifier"), item["model"])
                            for item in inventory if item.get("rotationrate"))
        if len(cpu) != 8 or min(cpu) < 0 or boot <= 0 or any(disks[name] < 0 for name, _ in drives):
            raise ValueError("Invalid initial kernel counters")
        if any(item.get("hddstandby") != "ALWAYS ON" for item in inventory if item.get("rotationrate")):
            raise ValueError("The spinning-drive model requires disabled standby")
        current = (self.clock.monotonic(), cpu, boot, disks, identities)
        previous, self.previous = self.previous, current
        if previous is None:
            return metric("truenas_power_scrape_success", 0)
        elapsed = current[0] - previous[0]
        if boot != previous[2] or identities != previous[4] or not 0 < elapsed <= 300:
            return metric("truenas_power_scrape_success", 0)
        delta = [value - old for value, old in zip(cpu, previous[1])]
        if len(cpu) != 8 or min(cpu) < 0 or min(delta) < 0 or sum(delta) <= 0:
            raise ValueError("CPU counters are invalid or reset")
        if any(disks[name] < previous[3][name] for name, _ in drives):
            raise ValueError("Disk counters reset")
        cpu_ratio = (sum(delta) - delta[3] - delta[4]) / sum(delta)
        disk_watts = sum(DRIVES[model][0] + (DRIVES[model][1] - DRIVES[model][0]) *
                         min(1, (disks[name] - previous[3][name]) / (elapsed * 1000))
                         for name, model in drives)
        dynamic_cpu = self.cpu_watts * cpu_ratio
        return "".join(metric(name, value) for name, value in (
            ("truenas_power_scrape_success", 1),
            ("truenas_power_sample_timestamp_seconds", self.clock.time()),
            ("truenas_power_cpu_utilization_ratio", cpu_ratio),
            ("truenas_power_platform_watts", self.platform_watts),
            ("truenas_power_cpu_dynamic_watts", dynamic_cpu),
            ("truenas_power_disks_estimated_watts", disk_watts),
            ("truenas_estimated_power_watts", self.platform_watts + dynamic_cpu + disk_watts),
        ))


if __name__ == "__main__":
    try:
        params = json.loads(sys.stdin.buffer.read(131073))
        client = ApiClient(params.pop("base"), "", "")
        client.auth = params.pop("auth")
        sys.stdout.buffer.write(client._fetch(**params))
    except Exception:  # noqa: BLE001 - never log URLs, credentials or remote errors.
        raise SystemExit(1) from None
