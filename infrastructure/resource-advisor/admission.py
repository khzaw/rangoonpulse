"""TLS AdmissionReview endpoint; no workload writes are performed here."""

import copy
import json
import os
import ssl
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import advisor
import capacity

PATHS = [
    '/api/v1/nodes', '/api/v1/pods', '/apis/apps/v1/deployments',
    '/apis/apps/v1/statefulsets', '/apis/apps/v1/daemonsets',
    '/apis/apps/v1/replicasets', '/apis/batch/v1/jobs',
]
LOCK = threading.Lock()
GUARD = capacity.Guard()
DECISIONS = Counter()
READY = False


class SnapshotReader:
    def __init__(self):
        self.built_at = 0.0
        self.items = []

    def read(self):
        if self.items and time.monotonic() - self.built_at < 1:
            return self.items
        kube = advisor.KubeClient(timeout=3)
        def fetch(path):
            status, payload = kube.request_json('GET', path)
            if status != 200:
                raise ValueError(f'Capacity snapshot unavailable: {path} HTTP {status}')
            kind = payload.get('kind', '').removesuffix('List')
            return [dict(obj, kind=obj.get('kind', kind)) for obj in payload.get('items', [])]
        with ThreadPoolExecutor(max_workers=len(PATHS)) as pool:
            self.items = [obj for batch in pool.map(fetch, PATHS) for obj in batch]
        self.built_at = time.monotonic()
        return self.items


READER = SnapshotReader()


def evaluate_review(request, items, guard=GUARD):
    obj = copy.deepcopy(request['object'])
    old = copy.deepcopy(request.get('oldObject'))
    resource = request.get('resource', {}).get('resource', '')
    if request.get('subResource') == 'scale':
        parent_kind = capacity.RESOURCES[resource]
        parent = next((o for o in items if capacity.key(o) == (
            parent_kind, request['namespace'], request['name']
        )), None)
        if parent is None:
            raise ValueError('Scale target missing from live capacity snapshot')
        old = copy.deepcopy(parent)
        obj = copy.deepcopy(parent)
        obj['spec']['replicas'] = request['object']['spec']['replicas']
    else:
        obj.setdefault('kind', capacity.RESOURCES.get(resource, ''))
        if old:
            old.setdefault('kind', obj['kind'])
    return guard.evaluate(obj, old, items, dry_run=request.get('dryRun', False))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        uid = ''
        kind = 'unknown'
        try:
            if self.path.split('?', 1)[0] != '/validate':
                raise ValueError('Unknown admission endpoint')
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 1024 * 1024:
                raise ValueError('AdmissionReview must be at most 1 MiB')
            review = json.loads(self.rfile.read(length))
            request = review['request']
            uid = request['uid']
            kind = request.get('kind', {}).get('kind', 'unknown')
            with LOCK:
                decision = evaluate_review(request, READER.read())
        except Exception as exc:
            decision = {'allowed': False, 'reason': f'CPU capacity check unavailable: {exc}'}
        DECISIONS[(kind, str(decision['allowed']).lower())] += 1
        response = {'uid': uid, 'allowed': decision['allowed']}
        if not decision['allowed']:
            response['status'] = {'code': 403, 'message': decision['reason']}
            advisor.log(f'CPU admission denied {kind}: {decision["reason"]}')
        body = json.dumps({'apiVersion': 'admission.k8s.io/v1', 'kind': 'AdmissionReview', 'response': response}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class TLSServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        self.cert = Path(os.getenv('ADMISSION_TLS_DIR', '/var/run/admission-tls'))
        self.cert_version = None
        self.context = None
        self.reload_certificate()
        super().__init__(address, Handler)

    def reload_certificate(self):
        version = ((self.cert / 'tls.crt').stat().st_mtime_ns, (self.cert / 'tls.key').stat().st_mtime_ns)
        if version != self.cert_version:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(self.cert / 'tls.crt', self.cert / 'tls.key')
            self.context = context
            self.cert_version = version

    def get_request(self):
        connection, address = super().get_request()
        try:
            self.reload_certificate()
            connection.settimeout(10)
            return self.context.wrap_socket(connection, server_side=True), address
        except Exception:
            connection.close()
            raise


def start():
    global READY
    server = TLSServer(('0.0.0.0', int(os.getenv('ADMISSION_PORT', '8443'))))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    READY = True
    advisor.log('CPU admission TLS listener ready')
