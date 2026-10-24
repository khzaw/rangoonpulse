"""Publish credential-free CPU capacity inputs for Git/CI validation."""

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
    status = obj.get('status', {})
    result['status'] = {'conditions': [{k: c[k] for k in ('type', 'status') if k in c}
                                      for c in status.get('conditions', [])]}
    if 'phase' in status:
        result['status']['phase'] = status['phase']
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
    # Build a standalone tree and root commit: runtime state must not retain
    # previous snapshots or inherit master history and application files.
    status, tree = advisor.github_request('POST', f'{base}/git/trees', token, {
        'tree': [{'path': FILE, 'mode': '100644', 'type': 'blob',
                  'content': json.dumps(snapshot, separators=(',', ':'))}],
    })
    if status != 201:
        raise ValueError(f'Cannot create capacity tree: HTTP {status}')
    payload = {'message': 'resource-advisor: refresh CPU capacity snapshot',
               'tree': tree['sha'], 'parents': []}
    if os.getenv('GITHUB_COMMIT_AUTHOR_NAME') and os.getenv('GITHUB_COMMIT_AUTHOR_EMAIL'):
        payload['author'] = {'name': os.environ['GITHUB_COMMIT_AUTHOR_NAME'], 'email': os.environ['GITHUB_COMMIT_AUTHOR_EMAIL']}
    status, commit = advisor.github_request('POST', f'{base}/git/commits', token, payload)
    if status != 201:
        raise ValueError(f'Cannot create capacity commit: HTTP {status}')
    status, _ = advisor.github_request('PATCH', f'{base}/git/refs/heads/{BRANCH}', token,
        {'sha': commit['sha'], 'force': True})
    if status == 404:
        status, _ = advisor.github_request('POST', f'{base}/git/refs', token,
            {'ref': f'refs/heads/{BRANCH}', 'sha': commit['sha']})
        if status != 201:
            raise ValueError(f'Cannot initialize capacity branch: HTTP {status}')
    elif status != 200:
        raise ValueError(f'Cannot replace capacity branch: HTTP {status}')
    advisor.log(f'Published {len(snapshot["items"])} CPU capacity records to {BRANCH}')


if __name__ == '__main__':
    publish(collect())
