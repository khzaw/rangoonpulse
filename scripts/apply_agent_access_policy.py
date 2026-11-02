#!/usr/bin/env python3
"""Merge the Git-managed agent access fragment into the existing tailnet policy."""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "infrastructure/tailscale-operator/agent-access-policy.json"
API = "https://api.tailscale.com/api/v2/"


def merge_policy(current: dict, fragment: dict) -> dict:
    """Add declared tags/grants without replacing unrelated policy or tag ownership."""
    if set(fragment) != {"tagOwners", "grants"}:
        raise ValueError("The agent policy fragment must contain only tagOwners and grants")
    result = copy.deepcopy(current)
    owners = result.setdefault("tagOwners", {})
    for tag, allowed in fragment["tagOwners"].items():
        if allowed != ["autogroup:admin"]:
            raise ValueError("Agent access tags must be owned only by tailnet administrators")
        if tag in owners and owners[tag] != allowed:
            raise ValueError("Existing agent tag ownership differs; review it before changing access")
        owners[tag] = list(allowed)
    grants = result.setdefault("grants", [])
    for grant in fragment["grants"]:
        if grant not in grants:
            grants.append(copy.deepcopy(grant))
    return result


def request_json(url: str, *, token: str | None = None, data: bytes | None = None,
                 headers: dict[str, str] | None = None) -> tuple[dict, str | None]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response), response.headers.get("ETag")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Tailscale API rejected the request (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("Tailscale API could not be reached") from None


def oauth_token(kubeconfig: str | None) -> str:
    """Keep provider credentials and token responses in memory, out of argv and output."""
    client_id = os.environ.get("TAILSCALE_CLIENT_ID")
    client_secret = os.environ.get("TAILSCALE_CLIENT_SECRET")
    if not client_id or not client_secret:
        command = ["kubectl"]
        if kubeconfig:
            command += ["--kubeconfig", kubeconfig]
        command += ["--request-timeout=10s", "-n", "tailscale", "get", "secret", "operator-oauth", "-o", "json"]
        try:
            result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=20)
            data = json.loads(result.stdout)["data"]
            client_id = base64.b64decode(data["client_id"]).decode()
            client_secret = base64.b64decode(data["client_secret"]).decode()
        except (subprocess.SubprocessError, OSError, ValueError, KeyError):
            raise RuntimeError("Could not load the existing operator OAuth credential") from None
    body = urllib.parse.urlencode({"grant_type": "client_credentials",
                                   "client_id": client_id, "client_secret": client_secret}).encode()
    response, _ = request_json(API + "oauth/token", data=body)
    return response["access_token"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tailnet", required=True, help="Tailnet name or MagicDNS suffix")
    parser.add_argument("--kubeconfig", help="Explicit operator/recovery kubeconfig for the existing OAuth Secret")
    parser.add_argument("--apply", action="store_true", help="Apply the merged policy; default is read-only")
    args = parser.parse_args()
    try:
        fragment = json.loads(POLICY.read_text())
        token = oauth_token(args.kubeconfig)
        url = API + "tailnet/" + urllib.parse.quote(args.tailnet, safe="") + "/acl"
        current, etag = request_json(url, token=token)
        desired = merge_policy(current, fragment)
        if desired == current:
            print("Agent access policy is already current")
            return 0
        print("Policy change: administrator-owned agent tags and TCP 443 access to the API proxy")
        if not args.apply:
            print("Read-only check; use --apply after reviewing the Git-managed fragment")
            return 0
        if not etag:
            raise RuntimeError("Policy has no ETag; refusing a write without concurrency protection")
        request_json(url, token=token, data=json.dumps(desired).encode(),
                     headers={"Content-Type": "application/hujson", "If-Match": etag})
        live, _ = request_json(url, token=token)
        if live != desired:
            raise RuntimeError("Policy read-back differs; inspect live state before retrying")
        print("Agent access policy applied and verified; unrelated rules preserved")
        return 0
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        # Only fixed messages above are safe; never print provider payloads or credentials.
        if isinstance(error, RuntimeError):
            print(str(error), file=sys.stderr)
        else:
            print("Agent access policy configuration is invalid; no credentials printed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
