"""Run the real exporter entrypoint with isolated, loopback-only test plumbing."""

import json
import os
import runpy
import socketserver
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from http import server
from pathlib import Path
from unittest import mock

EXPORTER = Path(__file__).resolve().parents[2] / "infrastructure/storage/democratic-csi/truenas-exporter/exporter.py"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class LoopbackHTTPServer(server.ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer.server_bind calls getfqdn(), which can block on host DNS
        # even for loopback. Fixture identity never needs a reverse lookup.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


def fixture_environment():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("TRUENAS_", "KUBERNETES_", "PYTHON"))
           and not key.lower().endswith("_proxy")}
    env.update(PORT="0", TRUENAS_USERNAME="fixture", TRUENAS_PASSWORD="fixture",
               TRUENAS_PLATFORM_IDLE_WATTS="12", TRUENAS_CPU_DYNAMIC_WATTS="10",
               NO_PROXY="*", no_proxy="*")
    return env


@contextmanager
def exporter_process(api_base):
    with tempfile.TemporaryDirectory(prefix="truenas-exporter-test-") as directory:
        ready = Path(directory) / "ready.json"
        env = fixture_environment()
        env["TRUENAS_API_BASE"] = api_base
        output_path = Path(directory) / "output.log"
        with output_path.open("wb") as output:
            process = subprocess.Popen(
                [sys.executable, "-I", "-u", str(Path(__file__).resolve()), str(ready)],
                env=env, stdout=output, stderr=subprocess.STDOUT,
            )
            last_error = "listener has not reported its address"
            try:
                deadline = time.monotonic() + 10
                while True:
                    if process.poll() is not None:
                        raise AssertionError("Exporter exited before becoming ready")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise AssertionError("Exporter readiness deadline exceeded")
                    if ready.exists():
                        try:
                            host, port = json.loads(ready.read_text())
                            base = f"http://{host}:{port}"
                            with HTTP.open(base + "/healthz", timeout=min(.5, remaining)) as response:
                                if response.status != 200 or response.read() != b"ok\n":
                                    raise AssertionError("Unexpected exporter health response")
                            break
                        except (OSError, ValueError) as exc:
                            last_error = repr(exc)
                    time.sleep(.05)
                yield base
            except Exception as exc:
                logs = output_path.read_text(errors="replace")
                raise AssertionError(
                    f"{exc}\nExporter pid={process.pid}, exit={process.poll()}, "
                    f"last readiness error={last_error}\nExporter output:\n{logs}"
                ) from exc
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)


def serve_exporter(ready):
    class LoopbackServer(LoopbackHTTPServer):
        def __init__(self, address, handler):
            # Only substitute the listener; execute production's __main__ below.
            super().__init__(("127.0.0.1", address[1]), handler)
            ready.write_text(json.dumps(self.server_address))

    sys.path.insert(0, str(EXPORTER.parent))
    with mock.patch.object(server, "ThreadingHTTPServer", LoopbackServer):
        runpy.run_path(str(EXPORTER), run_name="__main__")


if __name__ == "__main__":
    serve_exporter(Path(sys.argv[1]))
