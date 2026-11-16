"""Connector CPU accounting includes profiles, init containers and live identity."""

import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
import check_git_capacity as ci
import tailscale_capacity as tc


class ConnectorCapacityTests(unittest.TestCase):
    def setUp(self):
        self.connector = {'apiVersion': 'tailscale.com/v1alpha1', 'kind': 'Connector',
                          'metadata': {'name': 'dns'}, 'spec': {'subnetRouter': {'advertiseRoutes': ['10.0.0.233/32']}}}
        self.operator = {'kind': 'HelmRelease', 'metadata': {'name': 'tailscale-operator', 'namespace': 'tailscale'},
                         'spec': {'chart': {'spec': {'version': '1.104.7'}}}}
        self.objects = {ci.capacity.key(o): o for o in [self.connector, self.operator]}

    def add_profile(self, pod):
        self.connector['spec']['proxyClass'] = 'dns'
        self.objects[('ProxyClass', 'default', 'dns')] = {
            'kind': 'ProxyClass', 'metadata': {'name': 'dns'}, 'spec': {'statefulSet': {'pod': pod}},
        }

    def test_audited_defaults_and_profile_only_changes_are_counted(self):
        before = copy.deepcopy(self.objects)
        self.assertEqual(ci.capacity.cpu(tc.render(before)[0]), 1)
        self.add_profile({'nodeSelector': {'kubernetes.io/hostname': 'main'},
                          'tailscaleContainer': {'resources': {'requests': {'cpu': '100m', 'memory': '128Mi'}}}})
        changed = ci.changed_workloads(before, self.objects)
        self.assertEqual(len(changed), 1)
        self.assertEqual(ci.capacity.cpu(changed[0]), 100)
        self.assertEqual(ci.capacity.pod_spec(changed[0])['nodeSelector'], {'kubernetes.io/hostname': 'main'})
        profile_before = copy.deepcopy(self.objects)
        self.objects[('ProxyClass', 'default', 'dns')]['spec']['statefulSet']['pod']['tailscaleContainer']['resources']['requests']['cpu'] = '150m'
        self.assertEqual(ci.capacity.cpu(ci.changed_workloads(profile_before, self.objects)[0]), 150)

    def test_init_peak_and_limit_defaulting_match_kubernetes(self):
        self.add_profile({'tailscaleContainer': {'resources': {'requests': {'memory': '128Mi'}, 'limits': {'cpu': '80m'}}},
                          'tailscaleInitContainer': {'resources': {'requests': {'cpu': '125m'}}}})
        rendered = tc.render(self.objects)[0]
        self.assertEqual(ci.capacity.cpu(rendered), 125)
        rendered['spec']['template']['spec']['initContainers'] = []
        self.assertEqual(ci.capacity.cpu(rendered), 80)

    def test_existing_generated_identity_is_reused(self):
        rendered = tc.render(self.objects)[0]
        existing = {'kind': 'StatefulSet', 'metadata': {'name': 'ts-dns-abcde', 'namespace': 'tailscale',
                    'labels': {tc.PARENT: 'dns', tc.PARENT_TYPE: 'connector'}}}
        self.assertEqual(tc.resolve(rendered, [existing])['metadata']['name'], 'ts-dns-abcde')
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            tc.resolve(rendered, [existing, existing])
        existing['metadata'].pop('labels')
        with self.assertRaisesRegex(ValueError, 'Refresh the capacity snapshot'):
            tc.resolve(rendered, [existing])

    def test_unknown_version_or_missing_profile_fails_closed(self):
        self.operator['spec']['chart']['spec']['version'] = '1.105.0'
        with self.assertRaisesRegex(ValueError, 'Re-audit'):
            tc.render(self.objects)
        self.operator['spec']['chart']['spec']['version'] = '1.104.7'
        self.connector['spec']['proxyClass'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'Git-managed ProxyClass'):
            tc.render(self.objects)


if __name__ == '__main__':
    unittest.main()
