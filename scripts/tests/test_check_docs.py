"""Exercise the docs gate against small repositories, including failed renames."""

from datetime import date, datetime, timezone
import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("check_docs", Path(__file__).parents[1] / "check_docs.py")
check_docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_docs)
TODAY = date(2026, 10, 25)


def document(body="# Guide\n", **metadata):
    fields = dict(title="Guide", summary="Current operating guidance.", status="active",
                  owner="homelab", last_reviewed=TODAY.isoformat())
    fields.update(metadata)
    return "---\n" + "\n".join(f"{k}: {v}" for k, v in fields.items()) + "\n---\n\n" + body


class DocsGateTests(unittest.TestCase):
    def test_review_day_uses_singapore_midnight_on_utc_runners(self):
        self.assertEqual(check_docs.review_date(datetime(2026, 10, 24, 15, 59, tzinfo=timezone.utc)),
                         date(2026, 10, 24))
        self.assertEqual(check_docs.review_date(datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)),
                         date(2026, 10, 25))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write("AGENTS.md", "Read `docs/architecture.md`.\n")
        self.write("README.md", "[Guide](docs/README.md)\n")
        (self.root / "CLAUDE.md").symlink_to("AGENTS.md")
        self.write("docs/architecture.md", document())
        self.write("docs/knowledge-base-conventions.md", document())
        self.write("docs/README.md", "[Architecture](./architecture.md)\n"
                   "[Conventions](./knowledge-base-conventions.md)\n")

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def errors(self):
        return check_docs.validate_repository(self.root, TODAY)

    def test_valid_repo_and_examples_do_not_create_fake_references(self):
        self.write("README.md", '[Guide](docs/README.md)\n[External](https://example.com/no-file)\n'
                   '```md\n[Example](missing.md)\n`docs/missing.md`\n```\n')
        self.assertEqual(self.errors(), [])

    def test_real_link_coverage_is_required_after_rename(self):
        self.write("docs/README.md", 'architecture.md is mentioned, but not linked.\n'
                   '[Old guide](./before-rename.md)\n'
                   '[Conventions](./knowledge-base-conventions.md)\n')
        errors = self.errors()
        self.assertTrue(any("does not link to architecture.md" in e for e in errors))
        self.assertTrue(any("broken local link ./before-rename.md" in e for e in errors))

    def test_relative_links_titles_and_encoded_spaces(self):
        self.write("docs/extra file.txt", "reference")
        self.write("docs/architecture.md", document(
            '[Config](../README.md "Overview")\n[Extra](<extra%20file.txt>)\n'))
        self.assertEqual(self.errors(), [])

    def test_local_heading_links_follow_renamed_sections(self):
        self.write("docs/architecture.md", document(
            '# Guide\n## Node Capacity\n## Node Capacity\n'
            '[Local](#node-capacity-1)\n[Other](./knowledge-base-conventions.md#guide)\n'))
        self.assertEqual(self.errors(), [])
        self.write("README.md", '[Old section](docs/architecture.md#previous-heading)\n')
        self.assertTrue(any("missing heading in local link" in e for e in self.errors()))

    def test_missing_code_path_is_rejected_but_template_path_is_allowed(self):
        self.write("docs/architecture.md", document('`apps/missing.yaml`\n`apps/<name>/`\n'))
        self.assertEqual(len(self.errors()), 1)
        self.assertIn("missing repository path apps/missing.yaml", self.errors()[0])

    def test_empty_metadata_and_noncurrent_status_fail(self):
        self.write("docs/architecture.md", document(title="", status="historical"))
        self.assertTrue(any("missing or empty metadata: title" in e for e in self.errors()))
        self.assertTrue(any("status must be 'active'" in e for e in self.errors()))

    def test_invalid_future_and_stale_dates_fail(self):
        for value in ("not-a-date", "2026-10-26", "2025-01-01"):
            with self.subTest(value=value):
                self.write("docs/architecture.md", document(last_reviewed=value))
                self.assertTrue(any("last_reviewed" in e for e in self.errors()))

    def test_bad_claude_symlink_fails(self):
        path = self.root / "CLAUDE.md"
        path.unlink()
        path.symlink_to("a Markdown paragraph is not a symlink target")
        self.assertIn("missing required file: CLAUDE.md", self.errors())

    def test_skill_name_and_portability_are_checked(self):
        self.write(".agents/skills/deploy/SKILL.md", "---\nname: other\ndescription: Deploy\n---\n"
                   "Read `docs/architecture.md`.\n")
        self.write(".agents/skills/deploy/agents/openai.yaml", 'prompt: "/Users/someone/repo"\n')
        errors = self.errors()
        self.assertTrue(any("skill name must match folder deploy" in e for e in errors))
        self.assertTrue(any("workstation-specific" in e for e in errors))

    def test_merge_conflicts_and_completed_sections_fail(self):
        self.write("docs/architecture.md", document(
            '## Completed migration\n<<<<<<< Updated upstream\nold\n=======\nnew\n>>>>>>> Stash\n'))
        errors = self.errors()
        self.assertTrue(any("unresolved merge conflict" in e for e in errors))
        self.assertTrue(any("historical/completed section" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
