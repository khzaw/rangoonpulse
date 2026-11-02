"""Policy updates must preserve the rest of the tailnet and remain idempotent."""

import json
import io
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.apply_agent_access_policy import main, merge_policy


ROOT = Path(__file__).resolve().parents[2]


class AgentAccessPolicyTests(unittest.TestCase):
    def setUp(self):
        self.fragment = json.loads((ROOT / "infrastructure/tailscale-operator/agent-access-policy.json").read_text())
        self.existing = {"tagOwners": {"tag:k8s-operator": ["autogroup:admin"]},
                         "acls": [{"action": "accept", "src": ["*"], "dst": ["*:*"]}],
                         "ssh": [{"action": "check", "src": ["autogroup:member"]}],
                         "grants": [{"src": ["tag:other"], "dst": ["tag:other"], "ip": ["tcp:22"]}]}

    def test_preserves_other_rules_and_does_not_mutate_inputs(self):
        original = json.dumps(self.existing, sort_keys=True)
        result = merge_policy(self.existing, self.fragment)
        self.assertEqual(json.dumps(self.existing, sort_keys=True), original)
        self.assertEqual(result["acls"], self.existing["acls"])
        self.assertEqual(result["ssh"], self.existing["ssh"])
        self.assertEqual(result["grants"][0], self.existing["grants"][0])
        self.assertEqual(result["tagOwners"]["tag:k8s-operator"], ["autogroup:admin"])
        self.assertEqual(len(result["grants"]), 2)

    def test_repeated_application_is_idempotent(self):
        result = merge_policy(self.existing, self.fragment)
        self.assertEqual(merge_policy(result, self.fragment), result)

    def test_conflicting_tag_owner_is_not_silently_overwritten(self):
        tag = next(iter(self.fragment["tagOwners"]))
        self.existing["tagOwners"][tag] = ["someone@example.invalid"]
        with self.assertRaisesRegex(ValueError, "ownership differs"):
            merge_policy(self.existing, self.fragment)

    def test_non_admin_tag_ownership_is_rejected(self):
        self.fragment["tagOwners"]["tag:homelab-agent-observer"] = ["autogroup:member"]
        with self.assertRaisesRegex(ValueError, "only by tailnet administrators"):
            merge_policy(self.existing, self.fragment)

    def test_fragment_cannot_replace_other_policy_sections(self):
        self.fragment["acls"] = []
        with self.assertRaisesRegex(ValueError, "only tagOwners and grants"):
            merge_policy(self.existing, self.fragment)

    def test_default_check_never_writes_policy(self):
        with patch("sys.argv", ["policy", "--tailnet", "example.invalid"]), \
                patch("scripts.apply_agent_access_policy.oauth_token", return_value="private-test-token"), \
                patch("scripts.apply_agent_access_policy.request_json", return_value=(self.existing, '"v1"')) as request, \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        self.assertEqual(request.call_count, 1)
        self.assertNotIn("data", request.call_args.kwargs)

    def test_apply_uses_etag_and_verifies_readback(self):
        desired = merge_policy(self.existing, self.fragment)
        with patch("sys.argv", ["policy", "--tailnet", "example.invalid", "--apply"]), \
                patch("scripts.apply_agent_access_policy.oauth_token", return_value="private-test-token"), \
                patch("scripts.apply_agent_access_policy.request_json", side_effect=[(self.existing, '"v1"'), (desired, '"v2"'), (desired, '"v2"')]) as request, \
                redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        self.assertEqual(request.call_args_list[1].kwargs["headers"]["If-Match"], '"v1"')
        self.assertEqual(json.loads(request.call_args_list[1].kwargs["data"]), desired)
        self.assertEqual(request.call_count, 3)

    def test_missing_etag_prevents_writes(self):
        with patch("sys.argv", ["policy", "--tailnet", "example.invalid", "--apply"]), \
                patch("scripts.apply_agent_access_policy.oauth_token", return_value="private-test-token"), \
                patch("scripts.apply_agent_access_policy.request_json", return_value=(self.existing, None)) as request, \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(), 1)
        self.assertEqual(request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
