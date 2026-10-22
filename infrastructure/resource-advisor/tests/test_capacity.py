import copy
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from test_advisor import make_node
import advisor
import capacity


def node(name, cpu='5950m'):
    result = make_node(name, cpu)
    result['kind'] = 'Node'
    result['metadata']['labels'] = {'kubernetes.io/hostname': name}
    return result


def workload(name, cpu='100m', *, kind='Deployment', host='primary', replicas=1, namespace='default'):
    return {
        'kind': kind, 'metadata': {'name': name, 'namespace': namespace, 'uid': name+'-uid'},
        'spec': {'replicas': replicas, 'template': {'spec': {
            'nodeSelector': {'kubernetes.io/hostname': host},
            'containers': [{'name': 'main', 'image': 'example/test:1', 'resources': {'requests': {'cpu': cpu}}}],
        }}},
    }


def child(parent, name, *, kind='Pod'):
    obj = workload(name, kind=kind)
    obj['metadata']['ownerReferences'] = [{'kind': parent['kind'], 'name': parent['metadata']['name'],
                                          'uid': parent['metadata']['uid'], 'controller': True}]
    obj['spec'] = copy.deepcopy(parent['spec']['template']['spec']) if kind == 'Pod' else copy.deepcopy(parent['spec'])
    return obj


def baseline():
    return [node('primary'), node('utility', '3950m')] + [workload('other-'+str(i), '400m') for i in range(12)]


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.guard = capacity.Guard()

    def test_new_deployment_is_blocked_before_pods_exist(self):
        decision = self.guard.evaluate(workload('new', '151m'), None, baseline(), dry_run=True)
        self.assertFalse(decision['allowed'])
        self.assertIn('primary', decision['reason'])

    def test_safe_new_deployment_can_use_remaining_steady_capacity(self):
        self.assertTrue(self.guard.evaluate(workload('new', '150m'), None, baseline())['allowed'])

    def test_concurrent_unobserved_writes_share_one_budget(self):
        first = workload('first', '100m')
        self.assertTrue(self.guard.evaluate(first, None, baseline())['allowed'])
        self.assertFalse(self.guard.evaluate(workload('second', '100m'), None, baseline())['allowed'])

    def test_api_observation_replaces_pending_reservation_without_double_counting(self):
        first = workload('first', '100m')
        self.guard.evaluate(first, None, baseline())
        self.assertTrue(self.guard.evaluate(workload('second', '50m'), None, baseline()+[first])['allowed'])
        self.assertEqual(len(self.guard.pending), 1)

    def test_dry_run_does_not_reserve_capacity(self):
        for _ in range(2):
            self.assertTrue(self.guard.evaluate(workload('new', '100m'), None, baseline(), dry_run=True)['allowed'])
        self.assertEqual(self.guard.pending, [])

    def test_manual_upsize_and_scale_up_are_blocked(self):
        old = workload('current', '100m')
        for changed in [workload('current', '200m'), workload('current', '100m', replicas=2)]:
            with self.subTest(changed=changed['spec']):
                self.assertFalse(self.guard.evaluate(changed, old, baseline()+[old], dry_run=True)['allowed'])

    def test_recovery_downsize_is_allowed_while_reserve_is_short(self):
        old = workload('current', '500m')
        self.assertTrue(self.guard.evaluate(workload('current', '400m'), old, baseline()+[old])['allowed'])

    def test_unmerged_downsize_cannot_fund_other_growth(self):
        old = workload('current', '100m')
        self.guard.evaluate(workload('current', '25m'), old, baseline()+[old])
        self.assertFalse(self.guard.evaluate(workload('other-new', '100m'), None, baseline()+[old])['allowed'])

    def test_restart_or_image_change_with_pinned_unchanged_requests_is_allowed(self):
        old = workload('current', '500m')
        changed = copy.deepcopy(old)
        changed['spec']['template']['spec']['containers'][0]['image'] = 'example/test:2'
        self.assertTrue(self.guard.evaluate(changed, old, baseline()+[old])['allowed'])

    def test_unchanged_unpinned_intent_does_not_block_flux_noop_reconciliation(self):
        deployment = workload('utility-controller', '200m', host='utility')
        deployment['spec']['template']['spec'].pop('nodeSelector')
        rs = child(deployment, 'utility-rs', kind='ReplicaSet')
        running = child(rs, 'utility-pod')
        running['spec']['nodeName'] = 'utility'
        changed = copy.deepcopy(deployment)
        changed['metadata']['annotations'] = {'reconcile-test': 'true'}
        self.assertTrue(self.guard.evaluate(changed, deployment, baseline()+[deployment, rs, running])['allowed'])

    def test_utility_capacity_cannot_pay_for_primary_growth(self):
        self.assertFalse(self.guard.evaluate(workload('new', '200m'), None, baseline())['allowed'])
        self.assertTrue(self.guard.evaluate(workload('new', '200m', host='utility'), None, baseline())['allowed'])

    def test_unpinned_new_deployment_must_fit_every_eligible_node(self):
        obj = workload('new', '200m')
        obj['spec']['template']['spec'].pop('nodeSelector')
        self.assertFalse(self.guard.evaluate(obj, None, baseline())['allowed'])

    def test_rollout_surge_increases_required_reserve(self):
        obj = workload('new', '500m', replicas=3)
        obj['spec']['strategy'] = {'rollingUpdate': {'maxSurge': '100%'}}
        items = [node('primary')] + [workload('old-'+str(i), '400m') for i in range(8)]
        decision = self.guard.evaluate(obj, None, items)
        self.assertFalse(decision['allowed'])
        self.assertEqual(decision['cpuHeadroom']['nodes']['primary']['required_cpu_headroom_m'], 1650)

    def test_approved_rollout_child_can_use_protected_headroom(self):
        deployment = workload('current', '100m')
        rs = child(deployment, 'current-rs', kind='ReplicaSet')
        old_pod = child(rs, 'old-pod')
        new_pod = child(rs, 'replacement')
        old_pod['metadata']['deletionTimestamp'] = '2026-10-22T00:00:00Z'
        self.assertTrue(self.guard.evaluate(new_pod, None, baseline()+[deployment, rs, old_pod])['allowed'])

    def test_forged_controller_reference_cannot_create_unbounded_children(self):
        deployment = workload('current', '100m')
        rs = child(deployment, 'current-rs', kind='ReplicaSet')
        existing = child(rs, 'current-pod')
        self.assertFalse(self.guard.evaluate(child(rs, 'extra'), None, baseline()+[deployment, rs, existing])['allowed'])

    def test_child_cannot_exceed_approved_parent_request(self):
        deployment = workload('current', '100m')
        rs = child(deployment, 'current-rs', kind='ReplicaSet')
        new = child(rs, 'replacement')
        new['spec']['containers'][0]['resources']['requests']['cpu'] = '200m'
        self.assertFalse(self.guard.evaluate(new, None, baseline()+[deployment, rs])['allowed'])

    def test_small_job_can_use_job_allowance_but_cannot_drain_rollout_space(self):
        items = baseline()+[workload('current', '100m')]
        job = workload('job', '150m', kind='Job')
        self.assertTrue(self.guard.evaluate(job, None, items)['allowed'])
        self.assertFalse(self.guard.evaluate(workload('another-job', '51m', kind='Job'), None, items)['allowed'])

    def test_standalone_pod_does_not_get_job_allowance(self):
        obj = workload('pod', '200m', kind='Pod')
        obj['spec'] = obj['spec']['template']['spec']
        self.assertFalse(self.guard.evaluate(obj, None, baseline())['allowed'])

    def test_native_sidecars_and_overhead_count_toward_pod_requests(self):
        spec = {'containers': [{'resources': {'requests': {'cpu': '100m'}}}],
                'initContainers': [{'restartPolicy': 'Always', 'resources': {'requests': {'cpu': '500m'}}}],
                'overhead': {'cpu': '10m'}}
        self.assertEqual(advisor.pod_effective_requests({'spec': spec})[0], 610)

    def test_limits_only_template_cannot_hide_defaulted_cpu_requests(self):
        obj = workload('limits-only', '0m')
        obj['spec']['template']['spec']['containers'][0]['resources'] = {'limits': {'cpu': '500m'}}
        self.assertFalse(self.guard.evaluate(obj, None, baseline())['allowed'])
        self.assertEqual(capacity.cpu(obj), 500)

    def test_expired_unobserved_write_can_be_retried(self):
        now = [0]
        self.guard = capacity.Guard(clock=lambda: now[0])
        self.guard.evaluate(workload('first', '150m'), None, baseline())
        now[0] = 301
        self.assertTrue(self.guard.evaluate(workload('second', '100m'), None, baseline())['allowed'])

    def test_zero_replica_workload_does_not_reserve_replacement_space(self):
        stopped = workload('stopped', '5000m', replicas=0)
        self.assertTrue(self.guard.evaluate(workload('new', '100m'), None, baseline()+[stopped])['allowed'])

    def test_daemonset_is_checked_on_both_nodes(self):
        obj = workload('agent', '200m', kind='DaemonSet')
        obj['spec'].pop('replicas')
        obj['spec']['template']['spec'].pop('nodeSelector')
        self.assertFalse(self.guard.evaluate(obj, None, baseline())['allowed'])

    def test_preflight_reads_kubectl_multi_document_json_stream(self):
        path = Path(__file__).resolve().parents[3] / 'scripts/check_capacity.py'
        spec = importlib.util.spec_from_file_location('check_capacity', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        one, two = workload('one'), workload('two')
        raw = (json.dumps(one)+'\n'+json.dumps({'kind': 'List', 'items': [two]})).encode()
        self.assertEqual(module.decode_objects(raw), [one, two])
