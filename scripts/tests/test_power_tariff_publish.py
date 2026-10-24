"""Ensure tariff publishing is narrowly scoped and preserves pending approvals."""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import publish_power_tariff as publisher


class PublishTests(unittest.TestCase):
    @patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"})
    @patch.object(publisher, "api")
    @patch.object(publisher.subprocess, "check_output")
    def test_noop_has_no_writes(self, command, api):
        command.side_effect = ["base\n", ""]
        api.return_value = {"object": {"sha": "base"}}
        publisher.main()
        api.assert_called_once_with("repos/owner/repo/git/ref/heads/master")

    @patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"})
    @patch.object(publisher, "api")
    @patch.object(publisher.subprocess, "check_output")
    def test_refuses_stale_checkout(self, command, api):
        command.return_value = "base\n"
        api.return_value = {"object": {"sha": "newer"}}
        with self.assertRaises(RuntimeError):
            publisher.main()
        self.assertEqual(api.call_count, 1)

    @patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"})
    @patch.object(publisher, "api")
    @patch.object(publisher.subprocess, "check_output")
    def test_refuses_unrelated_changes(self, command, api):
        command.side_effect = ["base\n", "unrelated.yaml\n"]
        api.return_value = {"object": {"sha": "base"}}
        with self.assertRaises(RuntimeError):
            publisher.main()
        self.assertEqual(api.call_count, 1)

    @patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo"})
    @patch.object(publisher.subprocess, "run")
    @patch.object(publisher, "api")
    @patch.object(publisher.subprocess, "check_output")
    def test_pending_identical_tree_is_not_recommitted(self, command, api, run):
        command.side_effect = ["base\n", "infrastructure/monitoring/power-tariffs.json\n"]
        api.side_effect = [
            {"object": {"sha": "base"}},
            {"tree": {"sha": "base-tree"}},
            {"sha": "blob1"}, {"sha": "blob2"}, {"sha": "new-tree"},
            [{"ref": "refs/heads/automation/power-tariff", "object": {"sha": "old-commit"}}],
            {"tree": {"sha": "new-tree"}},
            [{"html_url": "https://github.com/owner/repo/pull/1"}],
        ]
        publisher.main()
        run.assert_not_called()
        self.assertFalse(any(call.args[0].endswith("/git/commits") for call in api.call_args_list))


if __name__ == "__main__":
    unittest.main()
