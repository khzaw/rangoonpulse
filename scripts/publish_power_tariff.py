#!/usr/bin/env python3
"""Publish only the two generated tariff files as a reviewable GitHub PR.

Uses GitHub's configured authenticated identity (no commit author override).
"""

import base64
import json
import os
import subprocess
from pathlib import Path

from update_power_tariff import DATA, ROOT, RULES

BRANCH = "automation/power-tariff"


def api(endpoint: str, payload: dict | None = None):
    command = ["gh", "api", endpoint]
    if payload is not None:
        command += ["--method", "POST", "--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, check=True, capture_output=True)
    return json.loads(result.stdout)


def main() -> None:
    repo = os.environ["GITHUB_REPOSITORY"]
    prefix = f"repos/{repo}"
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    latest = api(f"{prefix}/git/ref/heads/master")["object"]["sha"]
    if head != latest:
        raise RuntimeError("master changed during check; retry against the latest commit")
    paths = [str(path.relative_to(ROOT)) for path in (DATA, RULES)]
    changed = subprocess.check_output(["git", "diff", "--name-only"], text=True).splitlines()
    if not changed:
        print("No tariff changes")
        return
    if set(changed) - set(paths):
        raise RuntimeError("Unexpected changed files; refusing to publish")
    tree = api(f"{prefix}/git/trees", {
        "base_tree": api(f"{prefix}/git/commits/{head}")["tree"]["sha"],
        "tree": [{"path": path, "mode": "100644", "type": "blob",
                  "sha": api(f"{prefix}/git/blobs", {
                      "content": base64.b64encode((ROOT / path).read_bytes()).decode(),
                      "encoding": "base64"})["sha"]} for path in paths],
    })
    refs = api(f"{prefix}/git/matching-refs/heads/{BRANCH}")
    existing = next((ref for ref in refs if ref["ref"] == f"refs/heads/{BRANCH}"), None)
    unchanged = False
    if existing:
        previous = api(f"{prefix}/git/commits/{existing['object']['sha']}")
        unchanged = previous["tree"]["sha"] == tree["sha"]
    if unchanged:
        commit = {"sha": existing["object"]["sha"]}
    else:
        commit = api(f"{prefix}/git/commits", {
            "message": "monitoring: update Singapore electricity tariff",
            "tree": tree["sha"], "parents": [head],
        })
    if existing and not unchanged:
        # Only the dedicated automation branch is ever replaced.
        subprocess.run(["gh", "api", f"{prefix}/git/refs/heads/{BRANCH}",
                        "--method", "PATCH", "--input", "-"],
                       input=json.dumps({"sha": commit["sha"], "force": True}),
                       text=True, check=True, capture_output=True)
    elif not existing:
        api(f"{prefix}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
    prs = api(f"{prefix}/pulls?state=open&head={repo.split('/')[0]}:{BRANCH}")
    if prs:
        pr = prs[0]
    else:
        pr = api(f"{prefix}/pulls", {
            "title": "monitoring: update Singapore electricity tariff",
            "head": BRANCH, "base": "master",
            "body": "Updates the GST-inclusive Singapore electricity tariff from SP Group's official publication and regenerates the effective-dated Prometheus rules. The new rate activates at Singapore midnight on its effective date; the last known rate remains available with an expiry alert if a later update is missed.",
        })
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with Path(output).open("a") as stream:
            stream.write(f"pr_url={pr['html_url']}\n")
    print(pr["html_url"])


if __name__ == "__main__":
    main()
