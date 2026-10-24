"""Offline regression coverage for official-source parsing and safe generation."""

import copy
import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update_power_tariff as tariff

FIXTURE = Path(__file__).parent / "fixtures/sp-electricity-q4-2026.html"


class TariffTests(unittest.TestCase):
    def setUp(self):
        self.html = FIXTURE.read_text()
        self.entry = tariff.parse_tariff(self.html)
        self.history = json.loads(tariff.DATA.read_text())[:1]

    def test_official_fixture_ignores_gas_and_script_duplicates(self):
        self.assertEqual(self.entry["sgd_per_kwh"], "0.3116")
        self.assertEqual(self.entry["start"], "2026-10-01")
        self.assertEqual(self.entry["end"], "2026-12-31")

    def test_rejects_malformed_sources(self):
        variants = [
            "<h1>Service unavailable</h1>", self.html + self.html,
            self.html.replace("ELECTRICITY TARIFF", "GAS TARIFF"),
            self.html.replace("31.16 cents", "28.59 cents"),
            self.html.replace("31 Dec 26", "30 Dec 26"),
            self.html.replace("1 Oct", "2 Oct"),
            self.html.replace("Q4 2026", "Q3 2026"),
            self.html.replace("31.16 cents", "99.99 cents"),
        ]
        for html in variants:
            with self.subTest(html=html), self.assertRaises(ValueError):
                tariff.parse_tariff(html)

    def test_current_and_future_publications(self):
        for today in (date(2026, 9, 29), date(2026, 10, 25)):
            entries, safe = tariff.merge_tariff(self.history, self.entry, today)
            self.assertEqual(len(entries), 2)
            self.assertTrue(safe)

    def test_rejects_stale_or_far_future(self):
        for today in (date(2027, 1, 1), date(2026, 1, 1)):
            with self.assertRaises(ValueError):
                tariff.merge_tariff(self.history, self.entry, today)

    def test_noop_is_idempotent(self):
        entries = self.history + [self.entry]
        merged, safe = tariff.merge_tariff(entries, self.entry, date(2026, 10, 25))
        self.assertEqual(merged, entries)
        self.assertFalse(safe)

    def test_known_quarter_correction_needs_manual_review(self):
        changed = dict(self.entry, sgd_per_kwh="0.3200")
        with self.assertRaises(ValueError):
            tariff.merge_tariff(self.history + [self.entry], changed, date(2026, 10, 25))

    def test_large_change_disables_auto_merge(self):
        changed = dict(self.entry, sgd_per_kwh="0.5000")
        _, safe = tariff.merge_tariff(self.history, changed, date(2026, 10, 25))
        self.assertFalse(safe)

    def test_missing_quarter_rejected(self):
        changed = dict(self.entry, start="2027-01-01", end="2027-03-31")
        with self.assertRaises(ValueError):
            tariff.merge_tariff(self.history, changed, date(2026, 12, 30))

    def test_generated_file_and_singapore_boundary(self):
        entries = json.loads(tariff.DATA.read_text())
        content = tariff.RULES.read_text()
        self.assertEqual(tariff.update_rules(entries, content), content)
        self.assertEqual(tariff.epoch("2026-10-01"), 1790784000)
        rendered = tariff.render(entries)
        self.assertIn("vector(time()) >= 1790784000", rendered)
        self.assertIn("vector(time()) < 1790784000", rendered)
        self.assertIn("vector(0.3116)", rendered)

    def test_render_rejects_corrupt_history(self):
        entries = copy.deepcopy(self.history * 2)
        with self.assertRaises(ValueError):
            tariff.render(entries)
        with self.assertRaises(ValueError):
            tariff.update_rules(self.history, "missing markers")


if __name__ == "__main__":
    unittest.main()
