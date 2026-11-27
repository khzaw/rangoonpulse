import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  docSlug,
  pageUrl,
  parseFrontMatter,
  parseSidebarFromReadme,
  rewriteLinks,
  stripLeadingH1,
} from "./sync-docs.mjs";

test("parseFrontMatter extracts rangoonpulse doc metadata", () => {
  const sample = `---
title: Networking and Access Topology
summary: Current private ingress and Tunnel paths.
status: active
owner: homelab
last_reviewed: 2026-11-27
---

# Networking and Access Topology

Body text.
`;
  const { meta, body } = parseFrontMatter(sample);
  assert.equal(meta.title, "Networking and Access Topology");
  assert.equal(meta.summary, "Current private ingress and Tunnel paths.");
  assert.equal(meta.last_reviewed, "2026-11-27");
  const { h1, body: stripped } = stripLeadingH1(body);
  assert.equal(h1, "Networking and Access Topology");
  assert.equal(stripped.trim(), "Body text.");
});

test("docSlug and pageUrl normalize README and focused guides under /docs", () => {
  assert.equal(docSlug("README.md"), "");
  assert.equal(pageUrl("README.md"), "/docs/");
  assert.equal(docSlug("networking.md"), "networking");
  assert.equal(pageUrl("networking.md"), "/docs/networking/");
});

test("parseSidebarFromReadme mirrors docs/README.md sections and catches uncategorized guides", () => {
  const readme = `# Rangoonpulse Documentation

## Repository And Configuration

- [\`architecture.md\`](./architecture.md): source map
- [\`diagrams.md\`](./diagrams.md): D2 diagrams

## Project-Local Skills

- \`rangoonpulse-shared-worktree\`
`;
  const valid = new Set(["architecture", "diagrams", "extra-guide"]);
  const sidebar = parseSidebarFromReadme(readme, valid);
  assert.deepEqual(sidebar, [
    { label: "Start Here", items: [{ label: "Documentation Index", slug: "index" }] },
    {
      label: "Repository And Configuration",
      items: [{ slug: "architecture" }, { slug: "diagrams" }],
    },
    {
      label: "Additional Guides",
      items: [{ slug: "extra-guide" }],
    },
  ]);
});

test("rewriteLinks rewrites doc links, images, and repo links while ignoring code fences", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp-docs-test-"));
  const docsDir = path.join(tmp, "docs");
  fs.mkdirSync(path.join(docsDir, "diagrams"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "apps/dynacat"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "flux"), { recursive: true });
  fs.writeFileSync(path.join(docsDir, "networking.md"), "# Net\n");
  fs.writeFileSync(path.join(docsDir, "diagrams/service-map.png"), "png");
  fs.writeFileSync(path.join(docsDir, "diagrams/service-map.d2"), "d2");
  fs.writeFileSync(path.join(tmp, "apps/dynacat/helmrelease.yaml"), "yaml");

  const input = [
    "See [net](./networking.md#paths) and [hr](../apps/dynacat/helmrelease.yaml).",
    "Multiline [agent access and",
    "recovery](./networking.md#paths).",
    "Dir [dynacat](../apps/dynacat/) and [source](./diagrams/service-map.d2).",
    "![map](./diagrams/service-map.png)",
    "```md",
    "[keep-literal](./networking.md)",
    "```",
  ].join("\n");

  const output = rewriteLinks(input, "README.md", { docsDir, repoDir: tmp, hasRepoTree: true });
  assert.match(output, /\[net\]\(\/docs\/networking\/#paths\)/);
  assert.match(output, /recovery\]\(\/docs\/networking\/#paths\)/);
  assert.match(output, /\[hr\]\(https:\/\/github\.com\/khzaw\/rangoonpulse\/blob\/master\/apps\/dynacat\/helmrelease\.yaml\)/);
  assert.match(output, /\[dynacat\]\(https:\/\/github\.com\/khzaw\/rangoonpulse\/tree\/master\/apps\/dynacat\)/);
  assert.match(output, /\[source\]\(https:\/\/github\.com\/khzaw\/rangoonpulse\/blob\/master\/docs\/diagrams\/service-map\.d2\)/);
  assert.match(output, /!\[map\]\(\/docs\/diagrams\/service-map\.png\)/);
  assert.match(output, /\[keep-literal\]\(\.\/networking\.md\)/);

  fs.rmSync(tmp, { recursive: true, force: true });
});
