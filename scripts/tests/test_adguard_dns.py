"""Check primary upstream normalization preserves unrelated persistent config."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]


def startup(instance):
    manifest = yaml.safe_load(
        (ROOT / "apps/adguard" / instance / "helmrelease.yaml").read_text()
    )
    return manifest["spec"]["values"]["controllers"]["main"]["containers"]["main"]["args"][0]


class AdGuardDNSTests(unittest.TestCase):
    def normalize(self, config):
        script = startup("primary")
        subprocess.run(["sh", "-n"], input=script, text=True, check=True)
        block = script.split("# Keep primary Cloudflare upstreams", 1)[1]
        block = block.split("\n", 1)[1].split("# Keep DHCP disabled", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            conf = Path(directory) / "conf"
            conf.mkdir()
            path = conf / "AdGuardHome.yaml"
            path.write_text(config)
            subprocess.run(
                ["sh", "-eu", "-c", block],
                env=dict(os.environ, DATA=directory, CFG=str(path)),
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(list(conf.iterdir()), [path], "Temporary config file leaked")
            return path.read_text()

    def test_preserves_resolver_variants_and_other_runtime_settings(self):
        config = """dns:
  upstream_dns:
    - 1.1.1.2
    - 1.1.1.1
    - 1.0.0.1
    - https://1.0.0.2/dns-query
    - 9.9.9.9
    - '[/internal.example/]1.1.1.1'
    - tls://1.1.1.1
  bootstrap_dns:
    - 1.1.1.1
  upstream_mode: fastest_addr
filters: []
user_rules:
  - '@@||example.com^'
clients:
  persistent:
    - name: custom
      upstreams:
        - 1.1.1.1
"""
        expected = yaml.safe_load(config)
        expected["dns"]["upstream_dns"][:3] = [
            "https://1.1.1.2/dns-query",
            "https://1.1.1.1/dns-query",
            "https://1.0.0.1/dns-query",
        ]
        result = self.normalize(config)
        self.assertEqual(yaml.safe_load(result), expected)
        self.assertEqual(self.normalize(result), result)

    def test_quoted_addresses_explicit_udp_and_ports(self):
        for upstream in ("1.0.0.3", '"1.1.1.3:53"', "'udp://1.1.1.1:53'", "tcp://1.0.0.1:53"):
            with self.subTest(upstream=upstream):
                config = f"dns:\n  upstream_dns:\n    - {upstream}\n"
                address = (
                    upstream.strip("\"'")
                    .removeprefix("udp://")
                    .removeprefix("tcp://")
                    .removesuffix(":53")
                )
                self.assertEqual(
                    yaml.safe_load(self.normalize(config))["dns"]["upstream_dns"],
                    [f"https://{address}/dns-query"],
                )

    def test_empty_or_missing_upstreams_are_preserved(self):
        for config in ("dns:\n  upstream_dns: []\nfilters: []\n", "dns:\n  port: 53\n"):
            with self.subTest(config=config):
                self.assertEqual(self.normalize(config), config)

    def test_seeded_transport_is_instance_specific(self):
        for instance in ("primary", "secondary"):
            with self.subTest(instance=instance), tempfile.TemporaryDirectory() as directory:
                script = startup(instance)
                seed = 'if [ ! -f "$CFG" ]; then' + script.split('if [ ! -f "$CFG" ]; then', 1)[1]
                seed = seed.split("# Keep key DNS performance settings", 1)[0]
                path = Path(directory) / "AdGuardHome.yaml"
                subprocess.run(["sh", "-eu", "-c", seed], env=dict(os.environ, CFG=str(path)), check=True)
                upstreams = ["1.1.1.1", "1.0.0.1"]
                if instance == "primary":
                    upstreams = [f"https://{address}/dns-query" for address in upstreams]
                self.assertEqual(yaml.safe_load(path.read_text())["dns"]["upstream_dns"], upstreams)


if __name__ == "__main__":
    unittest.main()
