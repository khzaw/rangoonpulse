import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import capacity
import capacity_snapshot
from test_capacity import baseline, workload

path = Path(__file__).resolve().parents[3] / 'scripts/check_git_capacity.py'
spec = importlib.util.spec_from_file_location('check_git_capacity', path)
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class CapacityCITests(unittest.TestCase):
    def test_published_snapshot_omits_application_data_and_preserves_cpu(self):
        obj = workload('sample', '100m')
        pod = obj['spec']['template']['spec']
        pod['containers'][0]['env'] = [{'name': 'PASSWORD', 'value': 'private-value'}]
        pod['containers'][0]['resources'] = {'limits': {'cpu': '500m'}}
        pod['initContainers'] = [{'restartPolicy': 'Always', 'resources': {'requests': {'cpu': '25m'}}}]
        pod['overhead'] = {'cpu': '10m'}
        pod['volumes'] = [{'secret': {'secretName': 'private-secret'}}]
        clean = capacity_snapshot.sanitize(obj)
        text = json.dumps(clean)
        for excluded in ['PASSWORD', 'private-value', 'private-secret', 'example/test', 'volumes', 'env']:
            self.assertNotIn(excluded, text)
        self.assertEqual(capacity.cpu(clean), 535)
        self.assertEqual(capacity.placement(capacity.pod_spec(clean)), capacity.placement(pod))

    def test_published_and_raw_projection_match(self):
        items = baseline()
        self.assertEqual(capacity.projection(items), capacity.projection([capacity_snapshot.sanitize(o) for o in items]))

    def test_stale_and_future_snapshots_fail_closed(self):
        for generated in [0, 2001]:
            with self.subTest(generated=generated), self.assertRaises(ValueError):
                ci.validate_snapshot({'schemaVersion': 1, 'generatedAt': generated, 'items': baseline()}, now=1900)
        self.assertEqual(ci.validate_snapshot({'schemaVersion': 1, 'generatedAt': 1890, 'items': baseline()}, now=1900), baseline())

    def test_changed_services_share_a_single_batch_budget(self):
        with patch('builtins.print'):
            self.assertEqual(ci.check_batch([workload('first', '100m'), workload('second', '100m')], baseline()), 1)
            self.assertEqual(ci.check_batch([workload('first', '50m'), workload('second', '100m')], baseline()), 0)

    def test_ci_cannot_spend_unfinished_downsizes(self):
        old = workload('old', '100m')
        with patch('builtins.print'):
            self.assertEqual(ci.check_batch([workload('old', '25m'), workload('new', '100m')], baseline()+[old]), 1)

    def test_image_only_changes_do_not_need_a_snapshot(self):
        old = workload('old')
        new = copy.deepcopy(old)
        new['spec']['template']['spec']['containers'][0]['image'] = 'example/test:2'
        self.assertEqual(ci.changed_workloads({capacity.key(old): old}, {capacity.key(new): new}), [])

    def test_chart_defaults_in_changed_release_are_validated(self):
        release = {'kind': 'HelmRelease', 'metadata': {'name': 'new'}, 'spec': {}}
        with patch.object(ci, 'render_release', return_value=[workload('defaulted', '200m')]) as render:
            changes = ci.changed_workloads({}, {capacity.key(release): release})
        render.assert_called_once()
        with patch('builtins.print'):
            self.assertEqual(ci.check_batch(changes, baseline()), 1)

    def test_changed_replica_and_placement_intent_is_not_skipped(self):
        old = workload('old')
        for new in [workload('old', replicas=2), workload('old', host='utility')]:
            with self.subTest(new=new):
                self.assertEqual(ci.changed_workloads({capacity.key(old): old}, {capacity.key(new): new}), [new])

    def test_unchanged_runtime_values_are_not_required_for_unrelated_ci(self):
        release = {'kind': 'HelmRelease', 'metadata': {'name': 'runtime'},
                   'spec': {'valuesFrom': [{'kind': 'ConfigMap', 'name': 'runtime-state'}]}}
        objects = {capacity.key(release): release}
        with patch.object(ci, 'render_release') as render:
            self.assertEqual(ci.changed_workloads(objects, objects), [])
        render.assert_not_called()
