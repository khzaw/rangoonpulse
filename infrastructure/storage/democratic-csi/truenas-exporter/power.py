"""Software-only NAS power model. No NAS installation or persistent sampler."""

import base64
import json
import math
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

# Rounded engineering allowances, not measured wall watts. See the power docs.
DRIVES = {"ST8000VN004": (8.0, 10.0), "ST8000NT001": (8.0, 10.0), "ST8000VN002": (4.0, 6.0)}

# Each authenticated middleware request costs a login on the NAS, and the CPU
# download also creates a middleware job. Disk busy counters come from Netdata
# every poll; the static drive inventory and the exact /proc/stat CPU counters
# are refreshed on these slower cadences (seconds) once a baseline exists.
INVENTORY_SECONDS = 3600
CPU_SECONDS = 600

# Raw incremental values are Linux busy milliseconds, not Netdata's ms/s
# averages. names=no preserves the exact middleware disk identifier.
NETDATA_QUERY = urllib.parse.urlencode({
    "format": "prometheus", "data": "raw", "timestamps": "yes", "names": "no",
    "help": "no", "types": "no", "filter": "truenas_disk_stats.busy.*",
    # Netdata tracks an averaging cursor per server. Never move the existing
    # Prometheus scrape's cursor, even though this reader only uses raw values.
    "server": "rangoonpulse-power",
})
BUSY_SAMPLE = re.compile(
    r'netdata_Disk_Busy_Time_total\{chart="truenas_disk_stats\.busy\.([^"\\]+)",'
    r'family="disk\.busy",dimension="([^"\\]+)\.busy"\} ([0-9]+) ([0-9]+)'
)


def disk_samples(text, identities, now):
    samples = {}
    for line in text.splitlines():
        if not line.startswith("netdata_Disk_Busy_Time_total{"):
            continue
        match = BUSY_SAMPLE.fullmatch(line)
        if not match:
            raise ValueError("Invalid Netdata busy sample")
        identity, dimension, value, timestamp = match.groups()
        if identity != dimension or identity in samples:
            raise ValueError("Ambiguous Netdata disk identity")
        samples[identity] = (int(value), int(timestamp) / 1000)
    selected = {name: samples[identity] for name, identity, _ in identities}
    if any(not 0 <= now - timestamp <= 5 for _, timestamp in selected.values()):
        raise ValueError("Netdata busy sample is stale or future dated")
    return selected


def cpu_counters(text):
    lines = [line.split() for line in text.splitlines()]
    cpu = next([int(x) for x in line[1:9]] for line in lines if line and line[0] == "cpu")
    boot = next(int(line[1]) for line in lines if line and line[0] == "btime")
    if len(cpu) != 8 or min(cpu) < 0 or boot <= 0:
        raise ValueError("Invalid kernel CPU counters")
    return cpu, boot


def metric(name, value):
    return f'{name}{{host="truenas"}} {value}\n'


class ApiClient:
    """Reuse middleware CPU/inventory and Netdata disk telemetry.

    Non-buffered downloads stream tiny proc files, not a ramfs copy. One-off
    download URLs and credentials never enter logs, metrics or persistent state.
    """

    def __init__(self, base, username, password, netdata_base="http://10.0.0.210:6999"):
        self.base = base.rstrip("/")
        self.netdata_base = netdata_base.rstrip("/")
        parts = urllib.parse.urlsplit(self.base)
        self.origin = urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))
        self.auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()

        class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                destination = urllib.parse.urlsplit(newurl)
                source = urllib.parse.urlsplit(req.full_url)
                if (destination.scheme, destination.netloc) != (source.scheme, source.netloc):
                    raise ValueError("Refusing a cross-origin telemetry redirect")
                return super().redirect_request(req, fp, code, msg, headers, newurl)

        self.opener = urllib.request.build_opener(SameOriginRedirect())

    def _request(self, url, deadline, body=None, limit=1048576, authenticated=True):
        payload = {"base": self.base, "auth": self.auth, "url": url, "deadline": deadline,
                   "body": body, "limit": limit, "authenticated": authenticated}
        return self._isolated(payload, min(deadline, time.monotonic() + 3), limit)

    def snapshot(self, deadline, inventory=True, cpu=True):
        # One interpreter per poll, not one cold import per HTTP request. This
        # preserves the existing CPU cap without weakening cancellation. Only
        # the requested middleware reads are made; Netdata is read every poll.
        payload = {"base": self.base, "netdata_base": self.netdata_base, "auth": self.auth,
                   "operation": "snapshot", "deadline": deadline,
                   "inventory": bool(inventory), "cpu": bool(cpu)}
        return json.loads(self._isolated(payload, deadline, 2097152))

    def _isolated(self, payload, deadline, limit):
        # urllib's inactivity timeout does not bound slow headers or framing.
        # Kill/reap a whole overdue poll before releasing the parent's lock.
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("NAS power collection deadline exceeded")
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
        if path != "/proc/stat":
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

    def read_disks(self, deadline):
        return self._request(self.netdata_base + "/api/v1/allmetrics?" + NETDATA_QUERY,
                             deadline, limit=131072, authenticated=False).decode()


class DirectApiClient(ApiClient):
    """Used only inside the already-supervised collection worker."""

    def _request(self, url, deadline, body=None, limit=1048576, authenticated=True):
        return self._fetch(url, deadline, body, limit, authenticated)


class PowerCollector:
    def __init__(self, api, clock=time, platform_watts=12.0, cpu_watts=10.0,
                 inventory_seconds=INVENTORY_SECONDS, cpu_seconds=CPU_SECONDS):
        if any(not math.isfinite(value) or value <= 0 for value in (platform_watts, cpu_watts)):
            raise ValueError("Power allowances must be positive and finite")
        self.lock = threading.Lock()
        self.api = api
        self.clock = clock
        self.platform_watts = platform_watts
        self.cpu_watts = cpu_watts
        self.inventory_seconds = inventory_seconds
        self.cpu_seconds = cpu_seconds
        self.previous = None
        self.inventory = None
        self.cpu = None

    def reset(self):
        # A later scrape retries from fresh counters and a fresh inventory;
        # never replay old watts.
        self.previous = None
        self.inventory = None
        self.cpu = None

    def collect(self):
        if not self.lock.acquire(blocking=False):
            return metric("truenas_power_scrape_success", 0)
        try:
            return self._sample()
        except Exception:  # noqa: BLE001 - fail closed at the collection boundary.
            self.reset()
            return metric("truenas_power_scrape_success", 0)
        finally:
            self.lock.release()

    def _sample(self):
        started = self.clock.monotonic()
        deadline = started + 25
        need_inventory = self.inventory is None or started - self.inventory[0] >= self.inventory_seconds
        # Until a CPU ratio exists, read counters on every poll so a restart or
        # failure costs the usual two polls rather than a whole CPU interval.
        need_cpu = (self.cpu is None or self.cpu["ratio"] is None
                    or started - self.cpu["at"] >= self.cpu_seconds)
        snapshot = self.api.snapshot(deadline, inventory=need_inventory, cpu=need_cpu)
        now = self.clock.monotonic()
        if need_inventory:
            self.inventory = (now, snapshot["inventory"])
        inventory = self.inventory[1]
        drives = [(item["name"], item["model"].split("-", 1)[0]) for item in inventory if item.get("rotationrate")]
        if sorted(model for _, model in drives) != sorted(DRIVES):
            raise ValueError("Drive inventory does not match the power model")
        identities = sorted((item["name"], item.get("identifier"), item["model"])
                            for item in inventory if item.get("rotationrate"))
        if (len({name for name, _, _ in identities}) != len(DRIVES)
                or len({identity for _, identity, _ in identities}) != len(DRIVES)
                or any(not identity for _, identity, _ in identities)):
            raise ValueError("Missing or duplicate disk identity")
        if any(item.get("hddstandby") != "ALWAYS ON" for item in inventory if item.get("rotationrate")):
            raise ValueError("The spinning-drive model requires disabled standby")
        disks = disk_samples(snapshot["disks"], identities, self.clock.time())
        if need_cpu:
            self._update_cpu(snapshot["cpu"], now)
        current = (now, disks, identities)
        previous, self.previous = self.previous, current
        if previous is None or self.cpu["ratio"] is None:
            return metric("truenas_power_scrape_success", 0)
        elapsed = current[0] - previous[0]
        if identities != previous[2] or not 0 < elapsed <= 300:
            return metric("truenas_power_scrape_success", 0)
        if any(disks[name][0] < previous[1][name][0]
               or not 0 < disks[name][1] - previous[1][name][1] <= 300 for name, _ in drives):
            raise ValueError("Disk counters reset or source timestamp did not advance")
        cpu_ratio = self.cpu["ratio"]
        disk_watts = sum(DRIVES[model][0] + (DRIVES[model][1] - DRIVES[model][0]) *
                         min(1, (disks[name][0] - previous[1][name][0]) /
                             ((disks[name][1] - previous[1][name][1]) * 1000))
                         for name, model in drives)
        dynamic_cpu = self.cpu_watts * cpu_ratio
        return "".join(metric(name, value) for name, value in (
            ("truenas_power_scrape_success", 1),
            ("truenas_power_sample_timestamp_seconds", min(timestamp for _, timestamp in disks.values())),
            ("truenas_power_cpu_utilization_ratio", cpu_ratio),
            ("truenas_power_platform_watts", self.platform_watts),
            ("truenas_power_cpu_dynamic_watts", dynamic_cpu),
            ("truenas_power_disks_estimated_watts", disk_watts),
            ("truenas_estimated_power_watts", self.platform_watts + dynamic_cpu + disk_watts),
        ))

    def _update_cpu(self, text, now):
        counters, boot = cpu_counters(text)
        previous, ratio = self.cpu, None
        if (previous is not None and boot == previous["boot"]
                and 0 < now - previous["at"] <= self.cpu_seconds + 300):
            delta = [value - old for value, old in zip(counters, previous["counters"])]
            if min(delta) < 0 or sum(delta) <= 0:
                raise ValueError("CPU counters are invalid or reset")
            ratio = (sum(delta) - delta[3] - delta[4]) / sum(delta)
        elif previous is not None and boot != previous["boot"]:
            # A reboot invalidates every counter baseline, including disks.
            self.previous = None
        self.cpu = {"at": now, "counters": counters, "boot": boot, "ratio": ratio}


if __name__ == "__main__":
    try:
        params = json.loads(sys.stdin.buffer.read(131073))
        operation = params.pop("operation", "request")
        client = DirectApiClient(params.pop("base"), "", "", params.pop("netdata_base", ""))
        client.auth = params.pop("auth")
        if operation == "snapshot":
            deadline = params["deadline"]
            result = {"inventory": client.get("/disk", deadline) if params.get("inventory", True) else None,
                      "cpu": client.read_file("/proc/stat", deadline) if params.get("cpu", True) else None,
                      "disks": client.read_disks(deadline)}
            sys.stdout.buffer.write(json.dumps(result).encode())
        else:
            sys.stdout.buffer.write(client._fetch(**params))
    except Exception:  # noqa: BLE001 - never log URLs, credentials or remote errors.
        raise SystemExit(1) from None
