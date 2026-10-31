"""Regression checks for optional Helm values used by the Git capacity preflight."""

import importlib.util
from pathlib import Path
import unittest


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


if __name__ == "__main__":
    unittest.main()
