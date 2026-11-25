---
title: Diagrams
summary: D2 sources, the pinned render pipeline, and the rules for reading and changing the README diagrams.
status: active
owner: homelab
last_reviewed: 2026-11-26
---

# Diagrams

The README diagrams are code. Each one is a [D2](https://d2lang.com/) text file under `docs/diagrams/`, rendered to a PNG that is committed beside it.

| Diagram | Source | Shows |
| --- | --- | --- |
| Service map | [`service-map.d2`](./diagrams/service-map.d2) | Every workload group and how requests, data, and control move between them |
| GitOps loop | [`gitops-loop.d2`](./diagrams/gitops-loop.d2) | How a commit reaches the cluster, and which automation writes back to Git |

## Read The Service Map

| Mark | Meaning |
| --- | --- |
| White line | Private path: LAN or Tailscale client to the ingress VIP |
| Amber line | Permanent public path through Cloudflare Tunnel |
| Green line | Temporary share through exposure-control |
| Grey solid line | Data: SQL, volumes, requests between apps |
| Grey dashed line | Control: Git sync, certificates, metrics, alerts |
| Box with a title | A group. A line goes to the group, not to one card in it |
| Dashed frame | The Kubernetes cluster. Everything inside is reconciled by Flux |

The map is a group-level picture, not a routing table. It carries no addresses, ports, or hostnames; those stay in `flux/cluster-settings.yaml` and the [networking guide](./networking.md). A share line reaches only the apps wired in `apps/exposure-control/services.json`, and only while a share is enabled.

## Render

```bash
make diagrams
```

`scripts/render-diagrams.sh` builds a small image from the pinned `terrastruct/d2` release with `librsvg`, `pngquant`, and IBM Plex added. For each source it:

1. lays the diagram out with D2 and the ELK engine, measuring text with IBM Plex
2. draws the SVG to a PNG at twice the size with `rsvg-convert`
3. reduces the PNG to a palette image with `pngquant`
4. rewrites `docs/diagrams/SHA256SUMS`

The source goes in on stdin and the PNG comes out on stdout, so no host path is mounted. Rendering needs Docker and network access, because D2 downloads each icon and embeds it. The repository stores no icon files.

Commit the `.d2` change, the PNG, and `SHA256SUMS` together.

## Freshness Check

```bash
make check-diagrams
```

`SHA256SUMS` holds the hash of every source and of the render script. The check fails when a source or the script changed without a render, or when a PNG is missing. It needs neither Docker nor network access, and runs in `make validate-all` and CI.

The check compares inputs only. It does not compare the image with the cluster, so a diagram can pass and still be wrong. Open the PNG after every render.

## Change A Diagram

1. Edit the `.d2` file. To add a part, copy a sibling card in the same group and change the label and icon.
2. Run `make diagrams` and open the PNG.
3. Stage the source, the PNG, and `SHA256SUMS`.

Add, move, or remove a card in the service map in the same change that adds, renames, or retires a service or platform component.

Layout rules:

- Draw a line from group to group. A line into one card of a grid group stops ELK from layering the groups, and the sheet goes flat.
- Write a line that points to a higher layer as `upper <- lower`. `lower -> upper` turns the layers upside down.
- Give line styles for all three forms: `(** -> **)`, `(** <- **)`, and `(** <-> **)`. A line without a rule gets the D2 default colour.
- Set a path colour on the line itself with `style.stroke`. A class on a line loses to the global line style.
- Declaration order influences left-to-right order within a layer. Reordering groups can move the whole sheet.
- Keep the palette from the Control Panel: black canvas, `#101010` cards, sharp corners, and green, amber, and red only as path or status colours.

## Icons

Each card names an icon URL:

- [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) and [selfh.st icons](https://github.com/selfhst/icons) for product logos, pinned to a commit in the `vars` block of each source
- [Iconify](https://iconify.design/) Tabler icons for self-built apps and generic parts, with the colour set in the URL because D2 cannot recolour an icon

Prefer the `-light` variant of a monochrome logo so it reads on the dark card. Iconify is an unpinned API and can answer HTTP 429 for some minutes. The render then stops and leaves the committed PNG and `SHA256SUMS` as they were. Run it again later.

## Toolchain Pins

The D2 version lives in `scripts/render-diagrams.sh`, outside Renovate. A new D2 or ELK release moves nodes, so an upgrade is a deliberate change: bump the pin, render, and review both images before committing.

The PNG is the published form because GitHub serves a raw SVG with a content security policy that blocks the embedded icons and fonts. D2's own PNG export rejects many third-party icon SVGs, so the pipeline rasterizes with `librsvg` instead.
