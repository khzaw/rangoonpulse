#!/usr/bin/env python3

from __future__ import annotations

from datetime import date
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
SKILLS_DIR = ROOT / ".agents" / "skills"
DOCS_INDEX = DOCS_DIR / "README.md"

REQUIRED_FILES = [
    ROOT / "AGENTS.md",
    DOCS_INDEX,
    DOCS_DIR / "architecture.md",
    DOCS_DIR / "knowledge-base-conventions.md",
]

CANONICAL_DOCS = {
    DOCS_DIR / "architecture.md",
    DOCS_DIR / "knowledge-base-conventions.md",
}

REQUIRED_DOC_KEYS = {"title", "summary", "status", "owner", "last_reviewed"}
REQUIRED_SKILL_KEYS = {"name", "description"}
ALLOWED_STATUS = {"active", "draft", "historical"}
FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)


def parse_front_matter(path: Path) -> tuple[dict[str, str] | None, str]:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return None, text

    meta: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, text[match.end() :]


def validate_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def main() -> int:
    errors: list[str] = []

    for required in REQUIRED_FILES:
        if not required.exists():
            errors.append(f"missing required file: {required.relative_to(ROOT)}")

    docs_index_text = DOCS_INDEX.read_text(encoding="utf-8") if DOCS_INDEX.exists() else ""

    for doc_path in sorted(DOCS_DIR.glob("*.md")):
        if doc_path.name == "README.md":
            continue
        if doc_path.name not in docs_index_text:
            errors.append(f"docs/README.md does not reference {doc_path.name}")

    for doc_path in sorted(CANONICAL_DOCS):
        meta, _ = parse_front_matter(doc_path)
        if meta is None:
            errors.append(f"{doc_path.relative_to(ROOT)} is missing front matter")
            continue

        missing = REQUIRED_DOC_KEYS - meta.keys()
        if missing:
            missing_list = ", ".join(sorted(missing))
            errors.append(f"{doc_path.relative_to(ROOT)} is missing doc keys: {missing_list}")

        status = meta.get("status")
        if status and status not in ALLOWED_STATUS:
            errors.append(
                f"{doc_path.relative_to(ROOT)} has invalid status {status!r}; "
                f"expected one of {sorted(ALLOWED_STATUS)}"
            )

        last_reviewed = meta.get("last_reviewed")
        if last_reviewed and not validate_iso_date(last_reviewed):
            errors.append(
                f"{doc_path.relative_to(ROOT)} has invalid last_reviewed {last_reviewed!r}; "
                "expected YYYY-MM-DD"
            )

    skill_files = sorted(SKILLS_DIR.glob("*/SKILL.md"))
    for skill_path in skill_files:
        meta, body = parse_front_matter(skill_path)
        if meta is None:
            errors.append(f"{skill_path.relative_to(ROOT)} is missing front matter")
            continue

        missing = REQUIRED_SKILL_KEYS - meta.keys()
        if missing:
            missing_list = ", ".join(sorted(missing))
            errors.append(f"{skill_path.relative_to(ROOT)} is missing skill keys: {missing_list}")

        skill_name = meta.get("name")
        if skill_name and skill_name != skill_path.parent.name:
            errors.append(
                f"{skill_path.relative_to(ROOT)} has name {skill_name!r}, "
                f"expected {skill_path.parent.name!r}"
            )

        if "docs/" not in body and "/docs/" not in body:
            errors.append(
                f"{skill_path.relative_to(ROOT)} does not reference repo docs; "
                "route skills back to focused source-of-truth docs"
            )

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(
        "OK: checked "
        f"{len(list(DOCS_DIR.glob('*.md')))} docs files and {len(skill_files)} skill files"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
