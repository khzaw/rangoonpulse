#!/usr/bin/env python3
"""Render the README tags in .github/badges/ as self-contained SVG files.

    scripts/render_badges.py

shields.io draws each tag once, at render time. The logo it embeds as an image
is rewritten to inline paths, so a committed tag loads nothing from outside the
repository. Rendering needs network access; showing the README does not.
"""

import base64
import pathlib
import re
import sys
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / ".github" / "badges"

# Control Panel palette: near-black name, light-grey role, white logo.
STYLE = {"style": "flat-square", "labelColor": "101010", "logoColor": "white"}
ROLE_FILL = "e6e6e6"

# (file name, name, role, simple-icons slug or None). README.md decides the order.
TAGS = [
    # Cluster and delivery
    ("talos", "Talos", "Linux", "talos"),
    ("kubernetes", "Kubernetes", "2 nodes", "kubernetes"),
    ("flux", "Flux", "GitOps", "flux"),
    ("helm", "Helm", "charts", "helm"),
    ("renovate", "Renovate", "updates", "renovate"),
    ("sops", "SOPS", "age", None),
    # Network and edge
    ("nginx", "NGINX", "ingress", "nginx"),
    ("letsencrypt", "Let's Encrypt", "TLS", "letsencrypt"),
    ("cloudflare", "Cloudflare", "Tunnel", "cloudflare"),
    ("tailscale", "Tailscale", "remote access", "tailscale"),
    ("adguard", "AdGuard Home", "DNS", "adguard"),
    # Storage, data, and observability
    ("truenas", "TrueNAS", "NFS", "truenas"),
    ("postgresql", "PostgreSQL", "databases", "postgresql"),
    ("prometheus", "Prometheus", "metrics", "prometheus"),
    ("grafana", "Grafana", "dashboards", "grafana"),
    ("gatus", "Gatus", "health checks", None),
    # Hardware and docs
    ("intel", "Intel", "amd64", "intel"),
    ("raspberrypi", "Raspberry Pi", "arm64", "raspberrypi"),
    ("macmini", "Mac mini", "M4", "apple"),
    ("d2", "D2", "diagrams", None),
]

IMAGE = re.compile(
    r'<image x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" '
    r'href="data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)"/>'
)
PATH = re.compile(r'<path d="([^"]+)"/>')


def segment(text):
    """Escape one part of a shields.io static badge path."""
    return urllib.parse.quote(text.replace("-", "--").replace("_", "__"), safe="")


def fetch(name, role, logo):
    query = dict(STYLE, logo=logo) if logo else STYLE
    url = (
        f"https://img.shields.io/badge/{segment(name)}-{segment(role)}-{ROLE_FILL}"
        f"?{urllib.parse.urlencode(query)}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "render-badges"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode()


def inline_logo(match):
    x, y, width, height, encoded = match.groups()
    logo = base64.b64decode(encoded).decode()
    view_box = re.search(r'viewBox="([^"]+)"', logo).group(1)
    paths = PATH.findall(logo)
    if not paths or "<path" in PATH.sub("", logo):
        raise ValueError("logo is not made of plain paths")
    body = "".join(f'<path d="{d}"/>' for d in paths)
    return f'<svg x="{x}" y="{y}" width="{width}" height="{height}" viewBox="{view_box}">{body}</svg>'


def render(name, role, logo):
    svg = fetch(name, role, logo)
    if logo and not IMAGE.search(svg):
        raise ValueError(f"shields.io has no logo named {logo!r}")
    svg = IMAGE.sub(inline_logo, svg)
    if "href" in svg or "data:" in svg:
        raise ValueError("tag still refers to an embedded or outside resource")
    return svg + "\n"


def main():
    rendered = {}
    for file_name, name, role, logo in TAGS:
        try:
            rendered[f"{file_name}.svg"] = render(name, role, logo)
        except (OSError, ValueError) as error:
            sys.exit(f"ERROR: {file_name}: {error}; nothing was written")

    # Write only after every tag rendered, so a failed run leaves the directory as it was.
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.svg"):
        if stale.name not in rendered:
            stale.unlink()
    for file_name, svg in rendered.items():
        (OUT / file_name).write_text(svg)
    print(f"OK: rendered {len(rendered)} tags to {OUT.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    main()
