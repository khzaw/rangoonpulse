#!/usr/bin/env bash
# Render docs/diagrams/*.d2 to PNG, or check that the committed renders are current.
#
#   scripts/render-diagrams.sh           render every diagram and refresh SHA256SUMS
#   scripts/render-diagrams.sh --check   fail when a source or this script changed without a render
#
# Rendering needs Docker and network access: D2 downloads each icon and embeds it.
# The check needs neither, so it runs in `make validate-all` and CI.
set -euo pipefail
export LC_ALL=C

# Bump deliberately: a new D2 or ELK version moves every node. Re-render and review the images.
D2_IMAGE="terrastruct/d2:v0.9.0"
RENDER_IMAGE="rangoonpulse-diagrams:d2-v0.9.0"
FONTS="/usr/share/fonts/truetype/ibm-plex"

cd "$(dirname "$0")/.."
dir="docs/diagrams"
sums="$dir/SHA256SUMS"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# The renders depend on the sources and on the pinned toolchain in this script.
manifest() {
  sha256 "$dir"/*.d2 scripts/render-diagrams.sh
}

if [ "${1:-}" = "--check" ]; then
  status=0
  for src in "$dir"/*.d2; do
    if [ ! -s "${src%.d2}.png" ]; then
      echo "ERROR: ${src%.d2}.png is missing; run 'make diagrams'" >&2
      status=1
    fi
  done
  if [ ! -f "$sums" ] || ! diff <(manifest) "$sums" >/dev/null; then
    echo "ERROR: $dir sources or scripts/render-diagrams.sh changed without a render; run 'make diagrams'" >&2
    status=1
  fi
  [ "$status" -eq 0 ] && echo "OK: diagram renders match their sources"
  exit "$status"
fi

# D2 lays out with IBM Plex metrics; librsvg draws the PNG with the same installed fonts.
docker build --quiet --tag "$RENDER_IMAGE" - >/dev/null <<EOF
FROM $D2_IMAGE
USER root
RUN apt-get update \\
 && apt-get install -y --no-install-recommends librsvg2-bin fonts-ibm-plex pngquant \\
 && rm -rf /var/lib/apt/lists/*
USER debian
EOF

# Runs inside the image: D2 source on stdin, PNG on stdout, so no host path is mounted.
# librsvg ignores the fonts D2 embeds, so the SVG is pointed at the installed family instead.
# Iconify serves icons as "data:image/svg+xml; charset=utf-8;base64", which librsvg draws blank.
render='
set -eu
d2 --layout elk --elk-nodeNodeBetweenLayers=40 --pad 40 --scale 1 --omit-version \
  --font-regular "$FONTS/IBMPlexSans-Regular.ttf" --font-italic "$FONTS/IBMPlexSans-Italic.ttf" \
  --font-bold "$FONTS/IBMPlexSans-SemiBold.ttf" --font-semibold "$FONTS/IBMPlexSans-SemiBold.ttf" \
  --font-mono "$FONTS/IBMPlexMono-Regular.ttf" --font-mono-italic "$FONTS/IBMPlexMono-Italic.ttf" \
  --font-mono-bold "$FONTS/IBMPlexMono-SemiBold.ttf" --font-mono-semibold "$FONTS/IBMPlexMono-SemiBold.ttf" \
  - /tmp/diagram.svg >/tmp/d2.log 2>&1 || { cat /tmp/d2.log >&2; exit 1; }
sed -E \
  -e "s/font-family: \"d2-[0-9]+-font-regular\";/font-family: \"IBM Plex Sans\";/g" \
  -e "s/font-family: \"d2-[0-9]+-font-bold\";/font-family: \"IBM Plex Sans\"; font-weight: 600;/g" \
  -e "s/font-family: \"d2-[0-9]+-font-italic\";/font-family: \"IBM Plex Sans\"; font-style: italic;/g" \
  -e "s/font-family: \"d2-[0-9]+-font-mono\";/font-family: \"IBM Plex Mono\";/g" \
  -e "s/font-family: \"d2-[0-9]+-font-mono-bold\";/font-family: \"IBM Plex Mono\"; font-weight: 600;/g" \
  -e "s/; charset=utf-8;base64/;base64/g" \
  /tmp/diagram.svg | rsvg-convert --zoom 2 --output /tmp/diagram.png
pngquant --quality 85-100 --speed 1 --strip --force --output /tmp/diagram.q.png /tmp/diagram.png
cat /tmp/diagram.q.png
'

# A failed render leaves the committed PNG and SHA256SUMS as they were.
trap 'rm -f "$dir"/*.png.tmp' EXIT

for src in "$dir"/*.d2; do
  out="${src%.d2}.png"
  echo ">> rendering $out"
  docker run --rm -i --env FONTS="$FONTS" --entrypoint sh "$RENDER_IMAGE" -c "$render" <"$src" >"$out.tmp"
  mv "$out.tmp" "$out"
done

manifest >"$sums"
echo ">> refreshed $sums"
