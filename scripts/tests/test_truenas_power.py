"""TrueNAS power estimation uses bounded live reads and fails closed."""

import importlib.util
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
POWER = ROOT / "infrastructure/storage/democratic-csi/truenas-exporter/power.py"


class Clock:
    now = 1793264400.0
    elapsed = 0.0

    def time(self):
        return self.now

    def monotonic(self):
        return self.elapsed

    def advance(self, seconds):
        self.now += seconds
        self.elapsed += seconds


class API:
    def __init__(self):
        self.active = False
        self.fail = False
        self.boot = 1700000000
        self.models = ["ST8000VN004-3CP101", "ST8000NT001-3LZ101", "ST8000VN002-2ZM188"]

    def snapshot(self, deadline):
        return {"inventory": self.get("/disk", deadline),
                "cpu": self.read_file("/proc/stat", deadline),
                "disks": self.read_file("/proc/diskstats", deadline)}

    def get(self, path, deadline):
        if self.fail:
            raise TimeoutError("NAS offline")
        return [{"name": f"sd{chr(97+i)}", "model": model, "rotationrate": 7200,
                 "identifier": f"drive-{i}", "hddstandby": "ALWAYS ON"}
                for i, model in enumerate(self.models)]

    def read_file(self, path, deadline):
        if self.fail:
            raise TimeoutError("NAS offline")
        if path == "/proc/stat":
            return ("cpu  130 0 60 1210 0 0 0 0 0 0\n" if self.active else
                    "cpu  100 0 50 850 0 0 0 0 0 0\n") + f"btime {self.boot}\n"
        return "\n".join(f"8 {i*16} sd{chr(97+i)} 1 0 2 3 4 0 5 6 0 {61000 if self.active and i == 0 else 1000} 1000"
                         for i in range(len(self.models)))


class PowerTests(unittest.TestCase):
    def load(self):
        self.assertTrue(POWER.is_file(), "Add the restart-safe NAS power collector")
        spec = importlib.util.spec_from_file_location("truenas_power", POWER)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_slow_headers_are_bounded_before_urlopen_returns(self):
        module = self.load()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                try:
                    if self.path.endswith("/chunk"):
                        self.connection.sendall(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                    else:
                        self.connection.sendall(b"HTTP/1.1 200 OK\r\nX-Delay: ")
                    for _ in range(30):
                        self.connection.sendall(b"0" if self.path.endswith("/chunk") else b"x")
                        time.sleep(.02)
                    self.connection.sendall(b"2\r\n{}\r\n0\r\n\r\n" if self.path.endswith("/chunk") else b"\r\nContent-Length: 2\r\n\r\n{}")
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, format, *args):
                pass
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                client = module.ApiClient(f"http://127.0.0.1:{server.server_port}/api/v2.0", "fixture", "fixture")
                for path in ("/slow", "/chunk"):
                    started = time.monotonic()
                    with self.assertRaises((TimeoutError, ValueError, OSError)):
                        client.get(path, time.monotonic()+.12)
                    self.assertLess(time.monotonic()-started, .35)
            finally:
                server.shutdown()
                worker.join(2)

    def test_slow_trickle_cannot_hold_a_collection_lock_forever(self):
        module = self.load()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "40")
                self.end_headers()
                try:
                    for _ in range(40):
                        self.wfile.write(b"x")
                        self.wfile.flush()
                        time.sleep(.02)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, format, *args):
                pass
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                client = module.ApiClient(f"http://127.0.0.1:{server.server_port}/api/v2.0", "fixture", "fixture")
                started = time.monotonic()
                with self.assertRaises((TimeoutError, ValueError)):
                    client.get("/slow", time.monotonic()+.12)
                self.assertLess(time.monotonic()-started, .35)
            finally:
                server.shutdown()
                worker.join(2)

    def test_real_exporter_starts_offline_and_recovers_after_process_restart(self):
        exporter = POWER.with_name("exporter.py")
        self.assertTrue(exporter.is_file(), "Serve power through the existing exporter")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, PORT=str(port), TRUENAS_USERNAME="fixture", TRUENAS_PASSWORD="fixture",
                   TRUENAS_API_BASE="http://127.0.0.1:1/api/v2.0")
        for _ in range(2):
            worker = subprocess.Popen([sys.executable, str(exporter)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic()+5
                while True:
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=.5) as response:
                            self.assertEqual(response.read(), b"ok\n")
                        break
                    except OSError:
                        if worker.poll() is not None or time.monotonic() >= deadline:
                            self.fail("Exporter did not start independently of NAS availability")
                        time.sleep(.05)
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/power", timeout=2) as response:
                    body = response.read().decode()
                    self.assertIn('truenas_power_scrape_success{host="truenas"} 0', body)
                    self.assertNotIn("truenas_estimated_power_watts{", body)
            finally:
                worker.terminate()
                try:
                    worker.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    worker.kill()
                    worker.communicate(timeout=3)

    def test_real_process_collects_after_reconnect_and_restart(self):
        self.load()
        fixture = API()
        state = {"online": True, "generation": 0}
        class NAS(BaseHTTPRequestHandler):
            def respond(self, body):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)
            def do_GET(self):
                if not state["online"]:
                    self.send_error(503)
                elif self.path.endswith("/disk"):
                    self.respond(json.dumps(fixture.get("/disk", 0)).encode())
                elif self.path == "/_download/1":
                    state["generation"] += 1
                    generation = state["generation"]
                    self.respond(f"cpu {generation*10} 0 0 {generation*90} 0 0 0 0\nbtime 1700000000\n".encode())
                else:
                    self.respond("\n".join(f"8 {i*16} sd{chr(97+i)} 1 0 2 3 4 0 5 6 0 {state['generation']*100} 1000"
                                           for i in range(3)).encode())
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                number = 1 if body["args"] == ["/proc/stat"] else 2
                self.respond(json.dumps([number, f"/_download/{number}"]).encode())
            def log_message(self, format, *args):
                pass
        with ThreadingHTTPServer(("127.0.0.1", 0), NAS) as server:
            nas_worker = threading.Thread(target=server.serve_forever, daemon=True)
            nas_worker.start()
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            env = dict(os.environ, PORT=str(port), TRUENAS_USERNAME="fixture", TRUENAS_PASSWORD="fixture",
                       TRUENAS_API_BASE=f"http://127.0.0.1:{server.server_port}/api/v2.0")
            def power():
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/power", timeout=10) as response:
                    return response.read().decode()
            try:
                for _ in range(2):
                    process = subprocess.Popen([sys.executable, str(POWER.with_name("exporter.py"))], env=env,
                                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    try:
                        deadline = time.monotonic()+5
                        while True:
                            try:
                                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=.5) as response:
                                    self.assertEqual(response.status, 200)
                                break
                            except OSError:
                                if process.poll() is not None or time.monotonic() >= deadline:
                                    self.fail("Exporter failed to restart")
                                time.sleep(.05)
                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        self.assertIn('truenas_power_scrape_success{host="truenas"} 1', power())
                        state["online"] = False
                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        state["online"] = True
                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        self.assertIn('truenas_power_scrape_success{host="truenas"} 1', power())
                    finally:
                        process.terminate()
                        try:
                            process.communicate(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.communicate(timeout=3)
            finally:
                server.shutdown()
                nas_worker.join(2)

    def test_invalid_first_snapshot_cannot_poison_a_later_interval(self):
        module = self.load()
        api, clock = API(), Clock()
        original = api.read_file
        api.read_file = lambda path, deadline: original(path, deadline).replace("cpu  100", "cpu  -100")
        collector = module.PowerCollector(api=api, clock=clock)
        collector.collect()
        api.read_file = original
        api.active = True
        clock.advance(120)
        self.assertNotIn("truenas_estimated_power_watts{", collector.collect())

    def test_invalid_counters_never_become_valid_watts(self):
        for failure in ("negative_cpu", "reset_disk", "standby"):
            with self.subTest(failure=failure):
                module = self.load()
                api, clock = API(), Clock()
                collector = module.PowerCollector(api=api, clock=clock)
                collector.collect()
                clock.advance(120)
                api.active = True
                original_read, original_get = api.read_file, api.get
                if failure == "negative_cpu":
                    api.read_file = lambda path, deadline, original_read=original_read: original_read(path, deadline).replace("cpu  130", "cpu  -130")
                elif failure == "reset_disk":
                    api.read_file = lambda path, deadline, original_read=original_read: original_read(path, deadline).replace("61000", "10")
                else:
                    def inventory(path, deadline, original_get=original_get):
                        items = original_get(path, deadline)
                        items[0]["hddstandby"] = "10"
                        return items
                    api.get = inventory
                self.assertNotIn("truenas_estimated_power_watts{", collector.collect())

    def test_invalid_model_constants_are_rejected(self):
        module = self.load()
        for value in (float("nan"), float("inf"), -1, 0):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.PowerCollector(api=API(), platform_watts=value)

    def test_overlapping_scrape_is_bounded_and_does_not_replace_baseline(self):
        module = self.load()
        entered, release = threading.Event(), threading.Event()
        api = API()
        original = api.get
        def blocked(path, deadline):
            entered.set()
            release.wait(2)
            return original(path, deadline)
        api.get = blocked
        collector = module.PowerCollector(api=api)
        worker = threading.Thread(target=collector.collect)
        worker.start()
        self.assertTrue(entered.wait(1))
        try:
            started = time.monotonic()
            self.assertNotIn("truenas_estimated_power_watts{", collector.collect())
            self.assertLess(time.monotonic()-started, .2)
        finally:
            release.set()
            worker.join(3)

    def test_builtin_file_api_uses_unbuffered_download_and_bounds(self):
        module = self.load()
        self.assertTrue(hasattr(module, "ApiClient"), "Add bounded read-only TrueNAS API transport")
        requests = []
        fixture = API()

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append(body)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps([42, "/_download/42?auth_token=fixture"]).encode())

            def do_GET(self):
                if self.path.endswith("/redirect"):
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:1/leak")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                if self.path.endswith("/disk"):
                    self.wfile.write(json.dumps(fixture.get("/disk", 0)).encode())
                else:
                    self.wfile.write(fixture.read_file(requests[-1]["args"][0], 0).encode())

            def log_message(self, format, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                client = module.ApiClient(f"http://127.0.0.1:{server.server_port}/api/v2.0", "fixture", "fixture")
                self.assertTrue(client.read_file("/proc/stat", time.monotonic()+3).startswith("cpu "))
                self.assertEqual(requests, [{"method": "filesystem.get", "args": ["/proc/stat"], "filename": "telemetry.txt", "buffered": False}])
                with self.assertRaises(ValueError):
                    client.read_file("/etc/passwd", time.monotonic()+3)
                with self.assertRaises(TimeoutError):
                    client.get("/disk", time.monotonic()-1)
                with self.assertRaises(ValueError):
                    client.get("/redirect", time.monotonic()+3)
                self.assertTrue(hasattr(client, "snapshot"), "Batch a poll into one worker instead of five cold imports")
                with mock.patch.object(module.subprocess, "Popen", wraps=subprocess.Popen) as workers:
                    snapshot = client.snapshot(time.monotonic()+5)
                    self.assertEqual(workers.call_count, 1)
                self.assertEqual(len(snapshot["inventory"]), 3)
                self.assertTrue(snapshot["cpu"].startswith("cpu "))
                self.assertIn("sda", snapshot["disks"])
            finally:
                server.shutdown()
                worker.join(2)

    def test_boot_or_long_gap_requires_a_new_baseline(self):
        for change in ("boot", "gap"):
            with self.subTest(change=change):
                module = self.load()
                api, clock = API(), Clock()
                collector = module.PowerCollector(api=api, clock=clock)
                collector.collect()
                clock.advance(301 if change == "gap" else 120)
                api.active = True
                if change == "boot":
                    api.boot += 1
                self.assertNotIn("truenas_estimated_power_watts{", collector.collect())

    def test_missing_drive_does_not_silently_reduce_the_baseline(self):
        module = self.load()
        api, clock = API(), Clock()
        collector = module.PowerCollector(api=api, clock=clock)
        collector.collect()
        clock.advance(120)
        api.active = True
        api.models.pop()
        self.assertNotIn("truenas_estimated_power_watts{", collector.collect())

    def test_offline_start_and_reconnect_need_fresh_counters(self):
        module = self.load()
        api, clock = API(), Clock()
        collector = module.PowerCollector(api=api, clock=clock)
        api.fail = True
        self.assertEqual(collector.collect(), 'truenas_power_scrape_success{host="truenas"} 0\n')
        api.fail = False
        self.assertNotIn("truenas_estimated_power_watts{", collector.collect())
        clock.advance(120)
        api.active = True
        self.assertIn('truenas_estimated_power_watts{host="truenas"} 34.0', collector.collect())
        api.fail = True
        self.assertNotIn("truenas_estimated_power_watts{", collector.collect())
        api.fail = False
        self.assertNotIn("truenas_estimated_power_watts{", collector.collect())

    def test_warm_start_then_live_cpu_and_disk_model(self):
        module = self.load()
        api, clock = API(), Clock()
        collector = module.PowerCollector(api=api, clock=clock)
        first = collector.collect()
        self.assertIn('truenas_power_scrape_success{host="truenas"} 0', first)
        self.assertNotIn("truenas_estimated_power_watts{", first)
        clock.advance(120)
        api.active = True
        second = collector.collect()
        self.assertIn('truenas_estimated_power_watts{host="truenas"} 34.0', second)
        self.assertIn('truenas_power_scrape_success{host="truenas"} 1', second)
        self.assertIn('truenas_power_sample_timestamp_seconds{host="truenas"} 1793264520.0', second)


if __name__ == "__main__":
    unittest.main()
