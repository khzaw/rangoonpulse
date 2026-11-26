#!/usr/bin/env python3
"""Render the README stack tags in .github/badges/ as self-contained SVG files.

    scripts/render_badges.py

A tag is a small copy of a service-map card: logo and name on the Control Panel
card colour. Each logo is downloaded from a pinned source and copied into the
tag, so a committed tag loads nothing from outside the repository. Rendering
needs network access; showing the README does not.
"""

import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

OUT = pathlib.Path(__file__).resolve().parent.parent / ".github" / "badges"

# Logo sources. DI and SH are the commits pinned in docs/diagrams/*.d2.
DI = "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/23fc02e7710a66e0c774989f6e78372e9b6c2e15/svg"
SH = "https://raw.githubusercontent.com/selfhst/icons/df07d93a4b9e1c3930007971a1dfa6203ea02aea/svg"
TABLER = "https://cdn.jsdelivr.net/npm/@tabler/icons@3.53.0/icons/outline"

# (file name, name on the tag, logo URL). README.md decides grouping and order.
TAGS = [
    # Cluster
    ("talos", "Talos", f"{DI}/talos.svg"),
    ("kubernetes", "Kubernetes", f"{DI}/kubernetes.svg"),
    ("canal", "Canal", f"{SH}/calico.svg"),
    ("coredns", "CoreDNS", f"{SH}/coredns-light.svg"),
    # GitOps
    ("flux", "Flux", f"{DI}/flux-cd.svg"),
    ("helm", "Helm", f"{SH}/helm-light.svg"),
    ("renovate", "Renovate", f"{DI}/renovate.svg"),
    ("sops", "SOPS", f"{TABLER}/lock.svg"),
    ("github-actions", "GitHub Actions", f"{DI}/github-light.svg"),
    # Ingress and TLS
    ("ingress-nginx", "ingress-nginx", f"{DI}/nginx.svg"),
    ("cert-manager", "cert-manager", f"{DI}/cert-manager.svg"),
    ("letsencrypt", "Let's Encrypt", f"{SH}/lets-encrypt-light.svg"),
    # Edge and DNS
    ("cloudflare", "Cloudflare Tunnel", f"{DI}/cloudflare.svg"),
    ("tailscale", "Tailscale", f"{DI}/tailscale-light.svg"),
    ("adguard", "AdGuard Home", f"{DI}/adguard-home.svg"),
    # Storage
    ("truenas", "TrueNAS", f"{DI}/truenas.svg"),
    ("postgresql", "PostgreSQL", f"{DI}/postgresql.svg"),
    # Observability
    ("prometheus", "Prometheus", f"{DI}/prometheus.svg"),
    ("alertmanager", "Alertmanager", f"{DI}/alertmanager.svg"),
    ("grafana", "Grafana", f"{DI}/grafana.svg"),
    ("gatus", "Gatus", f"{DI}/gatus.svg"),
    # Apps
    ("jellyfin", "Jellyfin", f"{DI}/jellyfin.svg"),
    ("immich", "Immich", f"{SH}/immich.svg"),
    ("sonarr", "Sonarr", f"{DI}/sonarr.svg"),
    ("radarr", "Radarr", f"{DI}/radarr.svg"),
    ("vaultwarden", "Vaultwarden", f"{DI}/vaultwarden-light.svg"),
    ("miniflux", "Miniflux", f"{DI}/miniflux-light.svg"),
]

# Geometry and colours follow the `card` class in docs/diagrams/service-map.d2.
HEIGHT = 28
PAD_LEFT = 8
LOGO = 16
GAP = 7
PAD_RIGHT = 10
FONT_SIZE = 12
# Every listed monospace font advances 0.6 em per character. `textLength` holds the
# name to that width on systems where the fallback font differs.
ADVANCE = 0.6 * FONT_SIZE
FONT = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace"
FILL = "#101010"
STROKE = "#2c2c2c"
TEXT = "#f1f1f1"
GLYPH = "#d0d0d0"  # stroke colour for line icons that draw with currentColor

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)
FORBIDDEN = {"image", "script", "foreignObject", "a", "iframe"}
ROOT_DROP = {"width", "height", "x", "y", "id", "class", "version", "viewBox"}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "render-badges"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode()


def local(name):
    """Split '{namespace}tag' into (namespace, tag)."""
    if name.startswith("{"):
        namespace, _, tag = name[1:].partition("}")
        return namespace, tag
    return "", name


def clean(element):
    """Drop editor metadata and refuse anything that could load an outside resource."""
    for child in list(element):
        namespace, tag = local(child.tag)
        if namespace != SVG_NS or tag in {"metadata", "title", "desc"}:
            element.remove(child)
            continue
        if tag in FORBIDDEN:
            raise ValueError(f"logo contains <{tag}>")
        clean(child)
    for key in list(element.attrib):
        namespace, attribute = local(key)
        if namespace not in {"", XLINK_NS}:
            del element.attrib[key]
        elif attribute == "href" and not element.attrib[key].startswith("#"):
            raise ValueError("logo links to an outside resource")
    if element.text and "url(" in element.text and "url(#" not in element.text:
        raise ValueError("logo style loads an outside resource")


def logo(url, x, y):
    """Return the logo as a nested <svg> placed at (x, y)."""
    root = ET.fromstring(fetch(url))
    if local(root.tag) != (SVG_NS, "svg"):
        raise ValueError("logo is not an SVG document")
    view_box = root.get("viewBox")
    if not view_box:
        size = [re.match(r"[\d.]+", root.get(side, "")) for side in ("width", "height")]
        if not all(size):
            raise ValueError("logo has no viewBox or size")
        view_box = f"0 0 {size[0].group()} {size[1].group()}"
    uses_current_colour = "currentColor" in ET.tostring(root, encoding="unicode")
    for key in list(root.attrib):
        if local(key)[1] in ROOT_DROP:
            del root.attrib[key]
    clean(root)
    root.set("x", str(x))
    root.set("y", str(y))
    root.set("width", str(LOGO))
    root.set("height", str(LOGO))
    root.set("viewBox", view_box)
    if uses_current_colour:
        root.set("color", GLYPH)
    body = ET.tostring(root, encoding="unicode")
    return re.sub(r">\s+<", "><", body).strip()


def render(name, url):
    text_x = PAD_LEFT + LOGO + GAP
    text_width = round(len(name) * ADVANCE, 1)
    width = round(text_x + text_width + PAD_RIGHT)
    label = name.replace("&", "&amp;").replace("<", "&lt;")
    return (
        f'<svg xmlns="{SVG_NS}" xmlns:xlink="{XLINK_NS}" width="{width}" height="{HEIGHT}" '
        f'viewBox="0 0 {width} {HEIGHT}" role="img" aria-label="{label}">'
        f'<rect x=".5" y=".5" width="{width - 1}" height="{HEIGHT - 1}" fill="{FILL}" stroke="{STROKE}"/>'
        f"{logo(url, PAD_LEFT, (HEIGHT - LOGO) // 2)}"
        f'<text x="{text_x}" y="18.2" font-family="{FONT}" font-size="{FONT_SIZE}" fill="{TEXT}" '
        f'textLength="{text_width}" lengthAdjust="spacing">{label}</text>'
        "</svg>\n"
    )


def main():
    rendered = {}
    for file_name, name, url in TAGS:
        try:
            rendered[f"{file_name}.svg"] = render(name, url)
        except (OSError, ValueError, ET.ParseError) as error:
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
