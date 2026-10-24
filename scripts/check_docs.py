#!/usr/bin/env python3
"""Check current docs, local references, and project skill metadata without dependencies."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    "AGENTS.md", "CLAUDE.md", "README.md", "docs/README.md",
    "docs/architecture.md", "docs/knowledge-base-conventions.md",
)
DOC_KEYS = {"title", "summary", "status", "owner", "last_reviewed"}
SKILL_KEYS = {"name", "description"}
MAX_REVIEW_AGE = timedelta(days=180)
FRONT_MATTER_RE = re.compile(r"^---\n(.*?)\n---(?:\n|$)", re.DOTALL)
LINK_RE = re.compile(r'!?\[[^\]\n]*\]\(([^)\n]+)\)')
REPO_PATH_RE = re.compile(
    r"`((?:docs|apps|core|infrastructure|flux|scripts|native|talos|\.agents)/[^`\n]+)`"
)
ABSOLUTE_USER_PATH_RE = re.compile(r"/Users/[^/\s`]+/")
HISTORY_HEADING_RE = re.compile(
    r"(?im)^#{1,6}\s+(?:historical|completed|incident timeline|migration (?:history|timeline))\b"
)


def parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, text[match.end():]


def without_fences(text: str) -> str:
    lines = []
    fence = ""
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = ""
            continue
        if not fence:
            lines.append(line)
    return "\n".join(lines)


def local_links(path: Path, body: str) -> list[tuple[str, Path]]:
    targets = []
    for match in LINK_RE.finditer(without_fences(body)):
        raw = match.group(1).strip()
        if raw.startswith("<") and ">" in raw:
            raw = raw[1:raw.index(">")]
        else:
            raw = raw.split(' "', 1)[0].split(" '", 1)[0]
        parsed = urlsplit(raw)
        if parsed.scheme or parsed.netloc or not (parsed.path or parsed.fragment):
            continue
        target = unquote(parsed.path)
        if any(token in target for token in ("<", ">", "${", "*")):
            continue
        targets.append((raw, (path.parent / target).resolve() if target else path.resolve()))
    return targets


def heading_anchors(text: str) -> set[str]:
    """Generate GitHub-style anchors for the simple headings used by repo docs."""
    anchors = set()
    for line in without_fences(text).splitlines():
        heading = re.match(r"^#{1,6}\s+(.+?)(?:\s+#+)?$", line)
        if not heading:
            continue
        title = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", heading.group(1))
        slug = re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")
        anchor = slug
        suffix = 0
        while anchor in anchors:
            suffix += 1
            anchor = f"{slug}-{suffix}"
        anchors.add(anchor)
    return anchors


def validate_repository(root: Path = ROOT, today: date | None = None) -> list[str]:
    root = root.resolve()
    today = today or date.today()
    errors = []
    for name in REQUIRED_FILES:
        if not (root / name).is_file():
            errors.append(f"missing required file: {name}")

    docs = sorted(p for p in (root / "docs").glob("*.md") if p.name != "README.md")
    skills = sorted((root / ".agents/skills").glob("*/SKILL.md"))
    entrypoints = [root / name for name in ("AGENTS.md", "README.md", "docs/README.md")]
    # A symlink to AGENTS.md is also a valid Claude entrypoint.
    if (root / "CLAUDE.md").is_file() and not (root / "CLAUDE.md").is_symlink():
        entrypoints.append(root / "CLAUDE.md")
    index = root / "docs/README.md"
    indexed = {target for _, target in local_links(index, index.read_text())} if index.is_file() else set()

    for path in [*docs, *skills, *entrypoints]:
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        meta, body = parse_front_matter(text)
        is_doc = path in docs
        is_skill = path in skills

        if is_doc or is_skill:
            keys = DOC_KEYS if is_doc else SKILL_KEYS
            missing = sorted(key for key in keys if not meta.get(key))
            if missing:
                errors.append(f"{rel}: missing or empty metadata: {', '.join(missing)}")
        if is_doc:
            if meta.get("status") != "active":
                errors.append(f"{rel}: status must be 'active'")
            try:
                reviewed = date.fromisoformat(meta.get("last_reviewed", ""))
            except ValueError:
                errors.append(f"{rel}: last_reviewed must be YYYY-MM-DD")
            else:
                if reviewed > today or today - reviewed > MAX_REVIEW_AGE:
                    errors.append(f"{rel}: future or stale last_reviewed: {reviewed}")
            if path.resolve() not in indexed:
                errors.append(f"docs/README.md does not link to {path.name}")
            if HISTORY_HEADING_RE.search(without_fences(body)):
                errors.append(f"{rel}: historical/completed section belongs in Git history")
        if is_skill:
            if meta.get("name") != path.parent.name:
                errors.append(f"{rel}: skill name must match folder {path.parent.name}")
            if "docs/" not in body:
                errors.append(f"{rel}: route factual context to focused docs")

        if ABSOLUTE_USER_PATH_RE.search(text):
            errors.append(f"{rel}: workstation-specific /Users/... path")
        if re.search(r"(?m)^(?:<{7}|={7}|>{7}|\|{7})(?: |$)", text):
            errors.append(f"{rel}: unresolved merge conflict")
        for raw, target in local_links(path, body):
            if not target.exists():
                errors.append(f"{rel}: broken local link {raw}")
            elif target.suffix == ".md":
                fragment = unquote(urlsplit(raw).fragment)
                if fragment and fragment not in heading_anchors(target.read_text(encoding="utf-8")):
                    errors.append(f"{rel}: missing heading in local link {raw}")
        for match in REPO_PATH_RE.finditer(without_fences(body)):
            raw = match.group(1).rstrip(".,;:")
            if any(token in raw for token in ("<", ">", "*", "${", "{", " ", "...")):
                continue
            if not (root / raw).exists():
                errors.append(f"{rel}: missing repository path {raw}")

    for path in (root / ".agents/skills").glob("*/agents/openai.yaml"):
        if ABSOLUTE_USER_PATH_RE.search(path.read_text()):
            errors.append(f"{path.relative_to(root)}: workstation-specific /Users/... path")
    return errors


def main() -> int:
    errors = validate_repository()
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        return 1
    print("OK: current docs, local links, repository paths, and skill metadata")
    return 0


if __name__ == "__main__":
    sys.exit(main())
