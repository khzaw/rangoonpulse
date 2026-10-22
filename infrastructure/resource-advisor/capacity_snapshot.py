"""Publish credential-free CPU capacity inputs for Git/CI validation."""

import base64
import copy
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import advisor
import capacity

PATHS = [
    '/api/v1/nodes', '/api/v1/pods', '/apis/apps/v1/deployments',
    '/apis/apps/v1/statefulsets', '/apis/apps/v1/daemonsets',
    '/apis/apps/v1/replicasets', '/apis/batch/v1/jobs',
]
BRANCH = 'capacity-state'
FILE = 'capacity-snapshot.json'


def sanitize(obj):
    """Allowlist scheduling inputs; never publish env, images, volumes or secrets."""
    kind = obj['kind']
    meta = obj['metadata']
    result = {'kind': kind, 'metadata': {k: copy.deepcopy(meta[k]) for k in (
        'name', 'namespace', 'uid', 'ownerReferences', 'deletionTimestamp',
    ) if k in meta}}
    if kind == 'Node':
        result['metadata']['labels'] = meta.get('labels', {})
        result['status'] = {'allocatable': {'cpu': obj['status']['allocatable']['cpu']}}
        return result
    spec = obj['spec']
    template = {k: copy.deepcopy(v) for k, v in capacity.placement(capacity.pod_spec(obj)).items() if v is not None}
    template['containers'] = [{'name': 'cpu-reservation', 'resources': {
        'requests': {'cpu': f'{capacity.cpu(obj):g}m'},
    }}]
    result['spec'] = template if kind == 'Pod' else {
        **{k: copy.deepcopy(spec[k]) for k in ('replicas', 'parallelism', 'strategy', 'updateStrategy') if k in spec},
        'template': {'spec': template},
    }
    result['status'] = {k: copy.deepcopy(obj.get('status', {})[k]) for k in ('phase', 'conditions') if k in obj.get('status', {})}
    return result


def collect():
    kube = advisor.KubeClient(timeout=10)
    def fetch(path):
        status, payload = kube.request_json('GET', path)
        if status != 200:
            raise ValueError(f'Capacity snapshot unavailable: {path} HTTP {status}')
        kind = payload['kind'].removesuffix('List')
        return [sanitize(dict(obj, kind=obj.get('kind', kind))) for obj in payload.get('items', [])]
    with ThreadPoolExecutor(max_workers=len(PATHS)) as pool:
        items = [obj for batch in pool.map(fetch, PATHS) for obj in batch]
    capacity.projection(items)  # Fail before publishing incomplete capacity inputs.
    return {'schemaVersion': 1, 'generatedAt': time.time(), 'items': items}


def publish(snapshot):
    token = os.environ['GITHUB_TOKEN']
    repository = os.getenv('GITHUB_REPOSITORY', 'khzaw/rangoonpulse')
    base = f'https://api.github.com/repos/{repository}'
    status, _ = advisor.github_request('GET', f'{base}/git/ref/heads/{BRANCH}', token)
    if status == 404:
        status, ref = advisor.github_request('GET', f'{base}/git/ref/heads/master', token)
        if status != 200:
            raise ValueError(f'Cannot read master ref: HTTP {status}')
        status, _ = advisor.github_request('POST', f'{base}/git/refs', token,
            {'ref': f'refs/heads/{BRANCH}', 'sha': ref['object']['sha']})
        if status not in (201, 422):
            raise ValueError(f'Cannot initialize capacity branch: HTTP {status}')
    elif status != 200:
        raise ValueError(f'Cannot read capacity branch: HTTP {status}')
    status, current = advisor.github_request('GET', f'{base}/contents/{FILE}?ref={BRANCH}', token)
    if status not in (200, 404):
        raise ValueError(f'Cannot read capacity snapshot: HTTP {status}')
    payload = {'branch': BRANCH, 'message': 'resource-advisor: refresh CPU capacity snapshot',
        'content': base64.b64encode(json.dumps(snapshot, separators=(',', ':')).encode()).decode()}
    if os.getenv('GITHUB_COMMIT_AUTHOR_NAME') and os.getenv('GITHUB_COMMIT_AUTHOR_EMAIL'):
        payload['author'] = {'name': os.environ['GITHUB_COMMIT_AUTHOR_NAME'], 'email': os.environ['GITHUB_COMMIT_AUTHOR_EMAIL']}
    if status == 200:
        payload['sha'] = current['sha']
    status, _ = advisor.github_request('PUT', f'{base}/contents/{FILE}', token, payload)
    if status not in (200, 201):
        raise ValueError(f'Cannot publish capacity snapshot: HTTP {status}')
    advisor.log(f'Published {len(snapshot["items"])} CPU capacity records to {BRANCH}')


if __name__ == '__main__':
    publish(collect())
