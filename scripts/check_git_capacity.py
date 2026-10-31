#!/usr/bin/env python3
"""Render changed Git workloads and validate their combined CPU footprint."""

import argparse
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_capacity

capacity = check_capacity.capacity
WORKLOADS = capacity.CONTROLLERS | {'Pod', 'CronJob'}


def load_yaml(raw):
    import yaml
    class KubernetesLoader(yaml.SafeLoader):
        pass
    KubernetesLoader.add_constructor('tag:yaml.org,2002:value', lambda loader, node: loader.construct_scalar(node))
    return [obj for obj in yaml.load_all(raw, Loader=KubernetesLoader) if isinstance(obj, dict)]


def run(*args, cwd=None, input=None):
    return subprocess.check_output(args, cwd=cwd, input=input, stderr=subprocess.PIPE).decode()


def inventory(root):
    objects = load_yaml(run('kubectl', 'kustomize', 'flux', cwd=root))
    settings = next(o['data'] for o in objects if o['kind'] == 'ConfigMap' and o['metadata']['name'] == 'cluster-settings')
    paths = sorted({o['spec']['path'] for o in objects if o['kind'] == 'Kustomization'})
    def build(path):
        directory = root / path
        if any((directory / name).exists() for name in ('kustomization.yaml', 'kustomization.yml', 'Kustomization')):
            raw = run('kubectl', 'kustomize', path, cwd=root)
        else:
            # Flux auto-generates a kustomization for plain manifest directories.
            raw = '\n---\n'.join(p.read_text() for p in sorted(directory.rglob('*.yaml')))
        for name, value in settings.items():
            raw = raw.replace('${'+name+'}', str(value))
        return load_yaml(raw)
    with ThreadPoolExecutor(max_workers=8) as pool:
        objects.extend(obj for batch in pool.map(build, paths) for obj in batch)
    return {capacity.key(o): o for o in objects}


def merge(a, b):
    result = copy.deepcopy(a)
    for key, value in b.items():
        result[key] = merge(result.get(key, {}), value) if isinstance(value, dict) else value
    return result


def chart_inputs(release, objects):
    spec = release['spec']
    if spec.get('postRenderers') or spec.get('chartRef'):
        raise ValueError('Capacity rendering requires explicit support for postRenderers/chartRef; provide rendered workloads for review')
    chart = spec['chart']['spec']
    ref = chart['sourceRef']
    source = objects[(ref['kind'], ref.get('namespace', release['metadata'].get('namespace', 'default')), ref['name'])]
    values = {}
    for ref in spec.get('valuesFrom', []):
        if ref.get('kind', 'Secret') != 'ConfigMap' or ref.get('targetPath'):
            raise ValueError('Capacity rendering cannot resolve Secret valuesFrom or targetPath; use Git-managed ConfigMap values')
        key = ('ConfigMap', release['metadata'].get('namespace', 'default'), ref['name'])
        obj = objects.get(key)
        if obj is None:
            if ref.get('optional', False):
                continue
            raise ValueError(f'Capacity rendering requires Git-managed ConfigMap {key[1]}/{key[2]}')
        text = obj['data'][ref.get('valuesKey', 'values.yaml')]
        import yaml
        values = merge(values, yaml.safe_load(text) or {})
    return chart, source['spec'], merge(values, spec.get('values', {}))


def render_release(release, objects):
    chart, source, values = chart_inputs(release, objects)
    meta, spec = release['metadata'], release['spec']
    namespace = spec.get('targetNamespace', meta.get('namespace', 'default'))
    name = spec.get('releaseName', meta['name'] if namespace == meta.get('namespace', 'default') else namespace+'-'+meta['name'])
    chart_name = chart['chart']
    args = ['helm', 'template', name]
    if source.get('type') == 'oci':
        args.append(source['url'].rstrip('/')+'/'+chart_name)
    else:
        args.extend([chart_name, '--repo', source['url']])
    args.extend(['--namespace', namespace, '--version', chart['version'], '--kube-version', '1.37.1', '--values', '-'])
    with tempfile.TemporaryDirectory() as folder:
        config = Path(folder) / 'repositories.yaml'
        config.write_text('repositories: []\n')
        args.extend(['--repository-config', str(config), '--repository-cache', folder])
        objects = load_yaml(run(*args, input=json.dumps(values).encode()))
    candidates = [obj for obj in objects if obj['kind'] in WORKLOADS or (
        obj['kind'] not in {'PersistentVolumeClaim', 'HorizontalPodAutoscaler', 'VerticalPodAutoscaler'}
        and obj.get('spec', {}).get('resources')
    )]
    for obj in candidates:
        obj.setdefault('metadata', {}).setdefault('namespace', namespace)
    return candidates


def release_intent(release, objects):
    spec = release['spec']
    namespace = release['metadata'].get('namespace', 'default')
    inputs = [objects.get((ref.get('kind', 'Secret'), namespace, ref['name'])) for ref in spec.get('valuesFrom', [])]
    ref = spec.get('chart', {}).get('spec', {}).get('sourceRef', {})
    source = objects.get((ref.get('kind'), ref.get('namespace', namespace), ref.get('name')), {}).get('spec', {})
    return spec, inputs, {k: source.get(k) for k in ('url', 'type', 'secretRef')}


def changed_workloads(before, after):
    old_workloads = {k: o for k, o in before.items() if o['kind'] in WORKLOADS}
    new_workloads = {k: o for k, o in after.items() if o['kind'] in WORKLOADS}
    for key, obj in after.items():
        if obj['kind'] != 'HelmRelease' or obj.get('spec', {}).get('suspend'):
            continue
        old = before.get(key)
        # Resolved values include ConfigMap inputs and chart repository changes.
        if old and release_intent(old, before) == release_intent(obj, after) and old['metadata'] == obj['metadata']:
            continue
        new_rendered = {capacity.key(o): o for o in render_release(obj, after)}
        old_rendered = {capacity.key(o): o for o in render_release(old, before)} if old else {}
        for rendered_key in old_rendered.keys() | new_rendered.keys():
            if rendered_key[0] not in WORKLOADS:
                # An unrelated edit must not require modelling an unchanged
                # operator workload. Any change to that object still fails closed.
                if old_rendered.get(rendered_key) != new_rendered.get(rendered_key):
                    raise ValueError(f'{rendered_key[0]} changed operator-managed resources; render its generated workload explicitly before changing CPU')
                continue
            if rendered_key in new_rendered:
                new_workloads[rendered_key] = new_rendered[rendered_key]
            if rendered_key in old_rendered:
                old_workloads[rendered_key] = old_rendered[rendered_key]
    return [obj for key, obj in sorted(new_workloads.items())
            if key not in old_workloads or capacity.signature(obj) != capacity.signature(old_workloads[key])]


def validate_snapshot(payload, now=None):
    age = (time.time() if now is None else now) - float(payload['generatedAt'])
    if payload.get('schemaVersion') != 1 or not -60 <= age <= 1800:
        raise ValueError(f'Capacity snapshot is invalid or stale ({age:.0f}s); run resource-advisor-capacity-snapshot and retry')
    capacity.projection(payload['items'])
    return payload['items']


def check_batch(objects, state):
    guard = capacity.Guard()
    current = {capacity.key(o): o for o in state if o['kind'] != 'Node'}
    failed = False
    for obj in objects:
        old = current.get(capacity.key(obj))
        if old and capacity.terminal(old):
            old = None
        decision = guard.evaluate(obj, old, state)
        print(('PASS' if decision['allowed'] else 'FAIL'), '/'.join(capacity.key(obj)), decision['reason'])
        failed |= not decision['allowed']
    return int(failed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='Git base commit to compare')
    parser.add_argument('--snapshot', help='Local capacity snapshot for offline verification')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as folder:
        archive = subprocess.check_output(['git', 'archive', args.base], cwd=root)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(folder, filter='data')
        changes = changed_workloads(inventory(Path(folder)), inventory(root))
    if not changes:
        print('PASS: no CPU, replica, placement or rollout-budget changes')
        return 0
    if args.snapshot:
        payload = json.loads(Path(args.snapshot).read_text())
    else:
        request = urllib.request.Request('https://raw.githubusercontent.com/khzaw/rangoonpulse/capacity-state/capacity-snapshot.json', headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    return check_batch(changes, validate_snapshot(payload))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, subprocess.CalledProcessError) as exc:
        detail = exc.stderr.decode() if isinstance(exc, subprocess.CalledProcessError) and exc.stderr else str(exc)
        print(f'FAIL: CPU capacity validation unavailable: {detail}', file=sys.stderr)
        raise SystemExit(1)
