"""Regression checks for Helm inputs and post-rendered capacity."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "check_git_capacity", Path(__file__).parents[1] / "check_git_capacity.py"
)
check_git_capacity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_git_capacity)


class ChartInputsTests(unittest.TestCase):
    def setUp(self):
        self.release = {
            "metadata": {"name": "transmission", "namespace": "default"},
            "spec": {
                "chart": {
                    "spec": {
                        "chart": "app-template",
                        "sourceRef": {"kind": "HelmRepository", "name": "bjw-s-charts", "namespace": "flux-system"},
                    }
                },
                "valuesFrom": [
                    {"kind": "ConfigMap", "name": "transmission-vpn-state", "valuesKey": "values.yaml", "optional": True}
                ],
                "values": {"controllers": {"main": {"containers": {"gluetun": {"enabled": False}}}}},
            },
        }
        self.objects = {
            ("HelmRepository", "flux-system", "bjw-s-charts"): {"spec": {"url": "https://example.test/charts"}}
        }

    def test_missing_optional_runtime_configmap_uses_inline_values(self):
        chart, source, values = check_git_capacity.chart_inputs(self.release, self.objects)

        self.assertEqual(chart["chart"], "app-template")
        self.assertEqual(source["url"], "https://example.test/charts")
        self.assertFalse(values["controllers"]["main"]["containers"]["gluetun"]["enabled"])

    def test_missing_required_configmap_is_rejected(self):
        self.release["spec"]["valuesFrom"][0]["optional"] = False

        with self.assertRaisesRegex(ValueError, "Git-managed ConfigMap default/transmission-vpn-state"):
            check_git_capacity.chart_inputs(self.release, self.objects)


class CsiCredentialTests(unittest.TestCase):
    def setUp(self):
        self.release = {
            'metadata': {'name': 'democratic-csi-hdd', 'namespace': 'democratic-csi'},
            'spec': {
                'chart': {'spec': {
                    'chart': 'democratic-csi', 'version': '0.15.1',
                    'sourceRef': {'kind': 'HelmRepository', 'name': 'democratic-csi', 'namespace': 'flux-system'},
                }},
                'valuesFrom': [
                    {'kind': 'Secret', 'name': 'credentials', 'targetPath': 'driver.config.httpConnection.' + key}
                    for key in ['username', 'password']
                ],
                'values': {'node': {'driverRegistrar': {'resources': {'requests': {'cpu': '20m'}}}}},
            },
        }
        self.objects = {('HelmRepository', 'flux-system', 'democratic-csi'): {
            'spec': {'url': 'https://democratic-csi.github.io/charts/'},
        }}

    def test_audited_credentials_need_no_secret_read_and_retain_resources(self):
        _, _, values = check_git_capacity.chart_inputs(self.release, self.objects)
        self.assertEqual(values['node']['driverRegistrar']['resources']['requests']['cpu'], '20m')
        self.assertNotIn('driver', values)

    def test_unknown_secret_path_or_chart_fails_closed(self):
        mutations = [
            lambda r, o: r['spec']['valuesFrom'][0].update(targetPath='node.driver.resources.requests.cpu'),
            lambda r, o: r['spec']['valuesFrom'][0].pop('targetPath'),
            lambda r, o: r['spec']['chart']['spec'].update(version='0.15.2'),
            lambda r, o: r['spec']['chart']['spec'].update(chart='another-chart'),
            lambda r, o: o[('HelmRepository', 'flux-system', 'democratic-csi')]['spec'].update(url='https://example.test/charts'),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                release, objects = copy.deepcopy(self.release), copy.deepcopy(self.objects)
                mutate(release, objects)
                with self.assertRaisesRegex(ValueError, 'Secret valuesFrom'):
                    check_git_capacity.chart_inputs(release, objects)


class PostRendererTests(unittest.TestCase):
    def setUp(self):
        self.workload = {
            'apiVersion': 'apps/v1', 'kind': 'Deployment',
            'metadata': {'name': 'test', 'namespace': 'default'},
            'spec': {'replicas': 1, 'template': {'spec': {'containers': [{
                'name': 'main', 'image': 'example:v1', 'resources': {'requests': {'cpu': '20m'}},
            }]}}},
        }
        self.renderer = {'kustomize': {'patches': [{
            'target': {'kind': 'Deployment', 'name': 'test'},
            'patch': json.dumps([{'op': 'replace', 'path': '/spec/template/spec/containers/0/resources/requests/cpu', 'value': '200m'}]),
        }]}}

    def test_resource_patch_reaches_capacity_comparison(self):
        release = {
            'kind': 'HelmRelease', 'metadata': {'name': 'test', 'namespace': 'default'},
            'spec': {'chart': {'spec': {}}, 'postRenderers': [self.renderer]},
        }
        old = copy.deepcopy(release)
        old['spec'].pop('postRenderers')
        key = ('HelmRelease', 'default', 'test')
        command = check_git_capacity.run

        def render_command(*args, **kwargs):
            return json.dumps(self.workload) if args[0] == 'helm' else command(*args, **kwargs)

        with patch.object(check_git_capacity, 'chart_inputs', return_value=(
                {'chart': 'test', 'version': '1.0.0'}, {'url': 'https://example.test'}, {})), \
                patch.object(check_git_capacity, 'run', side_effect=render_command):
            changes = check_git_capacity.changed_workloads({key: old}, {key: release})
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]['spec']['template']['spec']['containers'][0]['resources']['requests']['cpu'], '200m')

    def test_renderers_run_in_order_and_leave_helm_hooks_unchanged(self):
        hook = copy.deepcopy(self.workload)
        hook['metadata']['annotations'] = {'helm.sh/hook': 'pre-install'}
        raw = json.dumps(self.workload) + '\n---\n' + json.dumps(hook)
        second = {'kustomize': {
            'images': [{'name': 'example', 'newTag': 'v2'}],
            'patches': [{'target': {'kind': 'Deployment', 'name': 'test'}, 'patch': json.dumps([
                {'op': 'test', 'path': '/spec/template/spec/containers/0/resources/requests/cpu', 'value': '200m'},
                {'op': 'replace', 'path': '/spec/replicas', 'value': 2},
            ])}],
        }}
        rendered = check_git_capacity.load_yaml(check_git_capacity.post_render(raw, [self.renderer, second]))
        self.assertEqual(rendered[0]['spec']['replicas'], 2)
        self.assertEqual(rendered[0]['spec']['template']['spec']['containers'][0]['image'], 'example:v2')
        self.assertEqual(rendered[1], hook)

    def test_unsupported_renderers_and_file_patches_fail_closed(self):
        for renderer in [
            {'exec': {}}, {'kustomize': {'resources': ['https://example.test']}},
            {'kustomize': {'patches': [{'path': '/tmp/patch.yaml'}]}},
        ]:
            with self.subTest(renderer=renderer), self.assertRaises(ValueError):
                check_git_capacity.post_render(json.dumps(self.workload), [renderer])


if __name__ == "__main__":
    unittest.main()
