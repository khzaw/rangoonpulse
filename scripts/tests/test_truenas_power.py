"""TrueNAS power estimation uses bounded live reads and fails closed."""

import importlib.util
import json
import os
import subprocess
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest import mock

# Support both unittest discovery and package-qualified invocation.
try:
    from . import truenas_exporter_fixture as fixture
except ImportError:
    import truenas_exporter_fixture as fixture

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
    def setUp(self):
        # Isolate both this process's HTTP clients and their Python workers.
        self.enterContext(mock.patch.dict(os.environ, fixture.fixture_environment(), clear=True))

    def test_fixture_server_does_not_depend_on_reverse_dns(self):
        with mock.patch("socket.getfqdn", side_effect=AssertionError("Unexpected reverse DNS lookup")):
            with fixture.LoopbackHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler) as server:
                self.assertEqual(server.server_address[0], "127.0.0.1")
                self.assertGreater(server.server_port, 0)

    def test_fixture_environment_ignores_host_configuration(self):
        with mock.patch.dict(os.environ, {
            "TRUENAS_API_BASE": "http://host.invalid", "TRUENAS_PASSWORD": "host-password",
            "TRUENAS_PLATFORM_IDLE_WATTS": "invalid", "KUBERNETES_SERVICE_HOST": "host.invalid",
            "PYTHONPATH": "/host-packages", "HTTPS_PROXY": "http://proxy.invalid",
            "http_proxy": "http://proxy.invalid", "NO_PROXY": "host.invalid", "PORT": "9118",
        }):
            env = fixture.fixture_environment()
        self.assertNotIn("TRUENAS_API_BASE", env)
        self.assertNotIn("KUBERNETES_SERVICE_HOST", env)
        self.assertNotIn("PYTHONPATH", env)
        self.assertNotIn("HTTPS_PROXY", env)
        self.assertNotIn("http_proxy", env)
        self.assertEqual(env["TRUENAS_PASSWORD"], "fixture")
        self.assertEqual(env["TRUENAS_PLATFORM_IDLE_WATTS"], "12")
        self.assertEqual(env["NO_PROXY"], "*")
        self.assertEqual(env["PORT"], "0")

    def test_exporter_startup_failure_includes_child_diagnostics(self):
        env = fixture.fixture_environment()
        env["TRUENAS_PLATFORM_IDLE_WATTS"] = "invalid-fixture-value"
        with mock.patch.object(fixture, "fixture_environment", return_value=env):
            with self.assertRaises(AssertionError) as failure:
                with fixture.exporter_process("http://127.0.0.1:1/api/v2.0"):
                    self.fail("Exporter unexpectedly accepted invalid configuration")
        message = str(failure.exception)
        self.assertIn("Exporter exited before becoming ready", message)
        self.assertIn("exit=1", message)
        self.assertIn("last readiness error=", message)
        self.assertIn("ValueError", message)
        self.assertIn("invalid-fixture-value", message)

    def load(self):
        self.assertTrue(POWER.is_file(), "Add the restart-safe NAS power collector")
        spec = importlib.util.spec_from_file_location("truenas_power", POWER)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def assert_slow_response_bounded(self, framing):
        module = self.load()
        entered, release = threading.Event(), threading.Event()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                try:
                    if framing == "headers":
                        self.connection.sendall(b"HTTP/1.1 200 OK\r\nX-Delay: ")
                    elif framing == "chunk":
                        self.connection.sendall(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                    else:
                        self.connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n")
                    entered.set()
                    # Keep data arriving below the inactivity timeout until the
                    # parent kills the poll, rather than finishing on a timer.
                    while not release.is_set():
                        self.connection.sendall(b"0" if framing == "chunk" else b"x")
                        release.wait(.05)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, format, *args):
                pass

        with fixture.LoopbackHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                client = module.ApiClient(f"http://127.0.0.1:{server.server_port}/api/v2.0", "fixture", "fixture")
                started = time.monotonic()
                # Either the worker notices its deadline or its supervisor
                # kills it; both must be bounded after reaching the fixture.
                with self.assertRaises((TimeoutError, ValueError)):
                    client.get("/slow", started + 2)
                elapsed = time.monotonic() - started
                self.assertTrue(entered.is_set(), "Worker timed out before reaching the slow HTTP fixture")
                self.assertGreater(elapsed, 1, "Request failed before exercising the slow-response deadline")
                self.assertLess(elapsed, 3, "Overdue worker was not promptly reaped")
            finally:
                release.set()
                server.shutdown()
                worker.join(2)

    def test_slow_headers_are_bounded_before_urlopen_returns(self):
        for framing in ("headers", "chunk"):
            with self.subTest(framing=framing):
                self.assert_slow_response_bounded(framing)

    def test_slow_trickle_cannot_hold_a_collection_lock_forever(self):
        self.assert_slow_response_bounded("body")

    def test_overdue_worker_is_killed_and_reaped(self):
        module = self.load()
        worker = mock.MagicMock()
        worker.__enter__.return_value = worker
        worker.communicate.side_effect = [subprocess.TimeoutExpired("fixture", 2), (b"", None)]
        client = module.ApiClient("http://127.0.0.1:1/api/v2.0", "fixture", "fixture")
        with mock.patch.object(module.subprocess, "Popen", return_value=worker):
            with self.assertRaisesRegex(TimeoutError, "NAS telemetry worker exceeded deadline"):
                client.get("/disk", time.monotonic() + 2)
        worker.kill.assert_called_once_with()
        self.assertEqual(worker.communicate.call_count, 2)
        self.assertEqual(worker.communicate.call_args, mock.call())

    def test_real_exporter_starts_offline_and_recovers_after_process_restart(self):
        for restart in range(2):
            with self.subTest(restart=restart), fixture.exporter_process("http://127.0.0.1:1/api/v2.0") as base:
                with fixture.HTTP.open(base + "/power", timeout=10) as response:
                    body = response.read().decode()
                    self.assertIn('truenas_power_scrape_success{host="truenas"} 0', body)
                    self.assertNotIn("truenas_estimated_power_watts{", body)

    def test_real_process_collects_after_reconnect_and_restart(self):
        self.load()
        api_fixture = API()
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
                    self.respond(json.dumps(api_fixture.get("/disk", 0)).encode())
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
        with fixture.LoopbackHTTPServer(("127.0.0.1", 0), NAS) as server:
            nas_worker = threading.Thread(target=server.serve_forever, daemon=True)
            nas_worker.start()
            try:
                for restart in range(2):
                    with self.subTest(restart=restart), fixture.exporter_process(
                        f"http://127.0.0.1:{server.server_port}/api/v2.0"
                    ) as base:
                        def power():
                            with fixture.HTTP.open(base + "/power", timeout=10) as response:
                                return response.read().decode()

                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        self.assertIn('truenas_power_scrape_success{host="truenas"} 1', power())
                        state["online"] = False
                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        state["online"] = True
                        self.assertNotIn("truenas_estimated_power_watts{", power())
                        self.assertIn('truenas_power_scrape_success{host="truenas"} 1', power())
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
        api_fixture = API()

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
                    self.wfile.write(json.dumps(api_fixture.get("/disk", 0)).encode())
                else:
                    self.wfile.write(api_fixture.read_file(requests[-1]["args"][0], 0).encode())

            def log_message(self, format, *args):
                pass

        with fixture.LoopbackHTTPServer(("127.0.0.1", 0), Handler) as server:
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
