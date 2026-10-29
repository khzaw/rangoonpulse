"""Keep the NAS display alias separate from its existing metric identity."""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class NASDisplayTests(unittest.TestCase):
    def setUp(self):
        source = (ROOT / "infrastructure/monitoring/grafana-dashboard-node-power-estimation.yaml").read_text()
        self.dashboard = json.loads(source.split("  node-power-estimation.json: |\n", 1)[1])

    def test_selector_displays_nas_but_selects_the_existing_series(self):
        variable = next(v for v in self.dashboard["templating"]["list"] if v["name"] == "node")
        self.assertIn("nas", variable["label"])
        self.assertIn("query_result(", variable["query"]["query"])
        self.assertIn("homelab:node_estimated_power_watts", variable["query"]["query"])
        pattern = variable["regex"][1:-2].replace("(?<", "(?P<")
        groups = {}
        for match in re.finditer(pattern, 'metric{display_host="nas",node="truenas"} 32'):
            groups.update({key: value for key, value in match.groupdict().items() if value is not None})
        self.assertEqual(groups, {"text": "nas", "value": "truenas"})
        self.assertEqual(variable["allValue"], ".*")

    def test_host_legends_use_the_alias_without_rewriting_queries(self):
        for panel in self.dashboard["panels"]:
            if panel["id"] not in (10, 11):
                continue
            self.assertIn('node=~"$node"', panel["targets"][0]["expr"])
            self.assertIn({"matcher": {"id": "byName", "options": "truenas"},
                           "properties": [{"id": "displayName", "value": "nas"}]},
                          panel["fieldConfig"].get("overrides", []))

    def test_visible_copy_calls_the_host_nas(self):
        for panel in self.dashboard["panels"]:
            for value in (panel["title"], panel.get("description", ""), panel.get("options", {}).get("content", "")):
                self.assertNotIn("TrueNAS", value)
        app = (ROOT / "apps/exposure-control/app.js").read_text()
        self.assertIn("Kubernetes nodes + Iris + nas", app)


if __name__ == "__main__":
    unittest.main()
