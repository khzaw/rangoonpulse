"""Exercise the startup filter merge without touching live AdGuard state."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
URL = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/native.lgwebos.txt"


class AdGuardFilterTests(unittest.TestCase):
    def merge(self, instance, config, success=True):
        manifest = yaml.safe_load(
            (ROOT / "apps/adguard" / instance / "helmrelease.yaml").read_text()
        )
        startup = manifest["spec"]["values"]["controllers"]["main"]["containers"]["main"]["args"][0]
        subprocess.run(["sh", "-n"], input=startup, text=True, check=True)
        merge = startup.split("# Keep the LG telemetry subscription", 1)[1]
        merge = merge.split("\n", 1)[1].split("exec /opt/adguardhome/AdGuardHome", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            conf = Path(directory) / "conf"
            conf.mkdir()
            path = conf / "AdGuardHome.yaml"
            path.write_text(config)
            env = dict(os.environ, DATA=directory, CFG=str(path))
            result = subprocess.run(
                ["sh", "-eu", "-c", merge], env=env, text=True, capture_output=True
            )
            self.assertEqual(result.returncode == 0, success, result.stderr)
            self.assertEqual(list(conf.iterdir()), [path], "Temporary merge file leaked")
            if not success:
                self.assertEqual(path.read_text(), config)
            return path.read_text()

    def test_preserves_runtime_settings_and_is_idempotent(self):
        original = {
            "dns": {"upstream_dns": ["1.1.1.1"]},
            "filters": [{"enabled": False, "url": "https://example.com/list.txt", "name": "Existing", "id": 42}],
            "whitelist_filters": [],
            "user_rules": ["@@||example.com^"],
            "dhcp": {"enabled": False},
        }
        config = yaml.safe_dump(original, sort_keys=False, indent=2)
        # AdGuard indents sequence items two spaces under their top-level key.
        config = config.replace("\n- ", "\n  - ").replace("\n  url:", "\n    url:").replace("\n  name:", "\n    name:").replace("\n  id:", "\n    id:")
        for instance in ("primary", "secondary"):
            with self.subTest(instance=instance):
                result = self.merge(instance, config)
                parsed = yaml.safe_load(result)
                added = parsed["filters"].pop()
                self.assertEqual(parsed, original)
                self.assertEqual((added["url"], added["enabled"]), (URL, True))
                self.assertEqual(self.merge(instance, result), result)

    def test_empty_missing_and_last_filters_section(self):
        for instance in ("primary", "secondary"):
            for config in ("filters: []\nuser_rules: []\n", "user_rules: []\n", "filters: []\n"):
                with self.subTest(instance=instance, config=config):
                    parsed = yaml.safe_load(self.merge(instance, config))
                    self.assertEqual(len(parsed["filters"]), 1)
                    self.assertEqual(parsed["filters"][0]["url"], URL)

    def test_existing_subscription_keeps_id_and_becomes_enabled(self):
        for instance in ("primary", "secondary"):
            for quoted in (URL, '"' + URL + '"'):
                with self.subTest(instance=instance, quoted=quoted):
                    config = f"filters:\n  - enabled: false\n    url: {quoted}\n    name: Existing LG\n    id: 99\nuser_rules: []\n"
                    parsed = yaml.safe_load(self.merge(instance, config))
                    self.assertEqual(parsed["filters"], [{"enabled": True, "url": URL, "name": "Existing LG", "id": 99}])

    def test_id_conflict_leaves_original_config_intact(self):
        config = "filters:\n  - enabled: true\n    url: https://example.com/list.txt\n    name: Existing\n    id: 2026110301\nuser_rules: []\n"
        for instance in ("primary", "secondary"):
            with self.subTest(instance=instance):
                self.merge(instance, config, success=False)


if __name__ == "__main__":
    unittest.main()
