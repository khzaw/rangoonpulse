#!/usr/bin/env python3
"""Read-only CPU preflight for rendered Kubernetes workloads, using live intent."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'infrastructure/resource-advisor'))
import capacity


def decode_objects(raw):
    decoder = json.JSONDecoder()
    remaining = raw.decode().strip()
    objects = []
    while remaining:
        payload, end = decoder.raw_decode(remaining)
        objects.extend(payload['items'] if payload.get('kind') == 'List' else [payload])
        remaining = remaining[end:].lstrip()
    return objects


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', '-f', required=True, help='Rendered workload YAML/JSON, or - for stdin')
    args = parser.parse_args()
    raw = subprocess.check_output(['kubectl', 'create', '--dry-run=client', '--validate=false', '-f', args.file, '-o', 'json'])
    objects = decode_objects(raw)
    state = json.loads(subprocess.check_output([
        'kubectl', 'get', 'nodes,pods,deployments,statefulsets,daemonsets,replicasets,jobs', '-A', '-o', 'json',
    ]))['items']
    current = {capacity.key(o): o for o in state if o['kind'] != 'Node'}
    guard = capacity.Guard()
    checked = 0
    failed = False
    for obj in objects:
        kind = obj.get('kind')
        if kind == 'HelmRelease':
            print('FAIL: render the Helm chart first; HelmRelease values alone do not include chart defaults', file=sys.stderr)
            failed = True
            continue
        if kind not in capacity.CONTROLLERS | {'Pod', 'CronJob'}:
            continue
        decision = guard.evaluate(obj, current.get(capacity.key(obj)), state)
        checked += 1
        print(('PASS' if decision['allowed'] else 'FAIL'), '/'.join(capacity.key(obj)), decision['reason'])
        failed = failed or not decision['allowed']
    if not checked and not failed:
        print('FAIL: no rendered workloads found', file=sys.stderr)
        failed = True
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
