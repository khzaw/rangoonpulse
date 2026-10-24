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
    def test_publish_replaces_only_capacity_branch_with_parentless_snapshot(self):
        snapshot = {'schemaVersion': 1, 'generatedAt': 123, 'items': []}
        env = {'GITHUB_TOKEN': 'test-token', 'GITHUB_REPOSITORY': 'owner/repo',
               'GITHUB_COMMIT_AUTHOR_NAME': 'Operator',
               'GITHUB_COMMIT_AUTHOR_EMAIL': 'operator@example.com'}
        with patch.dict('os.environ', env, clear=True), \
                patch.object(capacity_snapshot.advisor, 'github_request', side_effect=[
                    (201, {'sha': 'tree'}), (201, {'sha': 'commit'}), (200, {}),
                ]) as request, patch.object(capacity_snapshot.advisor, 'log'):
            capacity_snapshot.publish(snapshot)
        calls = request.call_args_list
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0].args[:2], ('POST', 'https://api.github.com/repos/owner/repo/git/trees'))
        tree = calls[0].args[3]
        self.assertEqual(set(tree), {'tree'})  # No base_tree inheriting application files.
        self.assertEqual(len(tree['tree']), 1)
        self.assertEqual(tree['tree'][0]['path'], 'capacity-snapshot.json')
        self.assertEqual(json.loads(tree['tree'][0]['content']), snapshot)
        self.assertEqual(calls[1].args[3]['parents'], [])
        self.assertEqual(calls[1].args[3]['tree'], 'tree')
        self.assertEqual(calls[1].args[3]['author'], {'name': 'Operator', 'email': 'operator@example.com'})
        self.assertEqual(calls[2].args[:2], ('PATCH', 'https://api.github.com/repos/owner/repo/git/refs/heads/capacity-state'))
        self.assertEqual(calls[2].args[3], {'sha': 'commit', 'force': True})

    def test_publish_initializes_missing_branch_without_master(self):
        with patch.dict('os.environ', {'GITHUB_TOKEN': 'test-token'}, clear=True), \
                patch.object(capacity_snapshot.advisor, 'github_request', side_effect=[
                    (201, {'sha': 'tree'}), (201, {'sha': 'commit'}), (404, {}), (201, {}),
                ]) as request, patch.object(capacity_snapshot.advisor, 'log'):
            capacity_snapshot.publish({'items': []})
        self.assertEqual(request.call_args.args[3], {'ref': 'refs/heads/capacity-state', 'sha': 'commit'})
        self.assertNotIn('author', request.call_args_list[1].args[3])

    def test_publish_fails_closed_on_api_errors(self):
        for responses, message in [
            ([(403, {})], 'create capacity tree'),
            ([(201, {'sha': 'tree'}), (403, {})], 'create capacity commit'),
            ([(201, {'sha': 'tree'}), (201, {'sha': 'commit'}), (422, {})], 'replace capacity branch'),
            ([(201, {'sha': 'tree'}), (201, {'sha': 'commit'}), (404, {}), (403, {})], 'initialize capacity branch'),
        ]:
            with self.subTest(message=message), \
                    patch.dict('os.environ', {'GITHUB_TOKEN': 'test-token'}, clear=True), \
                    patch.object(capacity_snapshot.advisor, 'github_request', side_effect=responses) as request, \
                    self.assertRaisesRegex(ValueError, message):
                capacity_snapshot.publish({'items': []})
            self.assertEqual(request.call_count, len(responses))

    def test_published_snapshot_omits_application_data_and_preserves_cpu(self):
        obj = workload('sample', '100m')
        pod = obj['spec']['template']['spec']
        pod['containers'][0]['env'] = [{'name': 'PASSWORD', 'value': 'private-value'}]
        pod['containers'][0]['resources'] = {'limits': {'cpu': '500m'}}
        pod['initContainers'] = [{'restartPolicy': 'Always', 'resources': {'requests': {'cpu': '25m'}}}]
        pod['overhead'] = {'cpu': '10m'}
        pod['volumes'] = [{'secret': {'secretName': 'private-secret'}}]
        obj['status'] = {'conditions': [{'type': 'Available', 'status': 'True', 'message': 'private-status-detail'}]}
        clean = capacity_snapshot.sanitize(obj)
        text = json.dumps(clean)
        for excluded in ['PASSWORD', 'private-value', 'private-secret', 'example/test', 'volumes', 'env', 'private-status-detail']:
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

    def operator_release_changes(self, old_operator, new_operator):
        old_release = {'kind': 'HelmRelease', 'metadata': {'name': 'monitoring'},
                       'spec': {'values': {'grafana': {'adminPassword': 'old'}}}}
        new_release = copy.deepcopy(old_release)
        new_release['spec']['values']['grafana'] = {'admin': {'existingSecret': 'grafana-admin'}}
        chart = ({'chart': 'monitoring', 'version': '1.0.0'}, {'url': 'https://charts.invalid'}, {})
        # Exercise real rendering/filtering; replace Helm and YAML decoding only.
        with patch.object(ci, 'chart_inputs', return_value=chart), \
                patch.object(ci, 'run', return_value='rendered'), \
                patch.object(ci, 'load_yaml', side_effect=[
                    [workload('grafana'), new_operator], [workload('grafana'), old_operator],
                ]):
            return ci.changed_workloads(
                {capacity.key(old_release): old_release},
                {capacity.key(new_release): new_release},
            )

    def test_unchanged_operator_resources_allow_unrelated_chart_changes(self):
        operator = {'kind': 'Prometheus', 'metadata': {'name': 'metrics'},
                    'spec': {'replicas': 1, 'resources': {'requests': {'cpu': '100m'}}}}
        self.assertEqual(self.operator_release_changes(operator, copy.deepcopy(operator)), [])

    def test_operator_resource_replica_and_placement_changes_fail_closed(self):
        operator = {'kind': 'Prometheus', 'metadata': {'name': 'metrics'},
                    'spec': {'replicas': 1, 'resources': {'requests': {'cpu': '100m'}}}}
        for change in [
            {'resources': {'requests': {'cpu': '200m'}}},
            {'replicas': 2},
            {'nodeSelector': {'kubernetes.io/hostname': 'utility'}},
            {'resources': {}},
        ]:
            changed = copy.deepcopy(operator)
            changed['spec'].update(change)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'operator-managed'):
                self.operator_release_changes(copy.deepcopy(operator), changed)

    def test_new_operator_resource_is_not_silently_skipped(self):
        operator = {'kind': 'Alertmanager', 'metadata': {'name': 'alerts'},
                    'spec': {'resources': {'requests': {'cpu': '100m'}}}}
        unrelated = {'kind': 'ConfigMap', 'metadata': {'name': 'old-config'}}
        with self.assertRaisesRegex(ValueError, 'operator-managed'):
            self.operator_release_changes(unrelated, operator)
