"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const View = require("./updates-view.js");

const NOW = Date.parse("2026-11-27T06:00:00Z");

function image(name, overrides) {
  return {
    id: name,
    name,
    namespace: "default",
    imageRepo: "ghcr.io/acme/" + name,
    image: "ghcr.io/acme/" + name + ":1.0.0",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    status: "update",
    statusText: "Update available",
    detail: "",
    ...overrides,
  };
}

const renovate = {
  configured: true,
  repository: "owner/repo",
  activeRun: null,
  lastRun: { runNumber: 7, status: "completed", conclusion: "success", updatedAt: "2026-11-27T05:00:00Z", url: "https://github.com/owner/repo/actions/runs/7" },
  openPrCount: 1,
  openPrs: [{ number: 12, title: "Update ghcr.io/acme/paperless docker tag to v1.1.0", headRefName: "renovate/paperless-1.x", url: "https://github.com/owner/repo/pull/12" }],
  rateLimitedUpdates: [{ branchName: "renovate/queuey-1.x", title: "Update ghcr.io/acme/queuey docker tag to v1.1.0" }],
  detectedDependencies: [],
  dashboardIssueUrl: "https://github.com/owner/repo/issues/1",
};

function model(overrides) {
  return View.buildModel({
    images: { checkedAt: "2026-11-27T04:00:00Z", items: [
      image("plain"),
      image("paperless"),
      image("queuey"),
      image("postgres", { imageRepo: "docker.io/library/postgres", image: "postgres:16@sha256:aaaaaaa1111", currentVersion: "16", latestVersion: "16", detail: "Tag '16' now points to sha256:bbbbbbb2222...." }),
      image("valkey", { imageRepo: "docker.io/valkey/valkey", currentVersion: "9.1-alpine", latestVersion: "9.2-alpine" }),
      image("current", { status: "current", latestVersion: "1.0.0" }),
      image("flaky", { status: "unknown", statusText: "Registry error", detail: "request timeout", latestVersion: null }),
    ] },
    charts: { checkedAt: "2026-11-27T04:00:00Z", items: [
      { id: "podinfo", name: "podinfo", namespace: "apps", chart: "podinfo", repo: "podinfo", currentVersion: "6.0.0", specVersion: "6.1.0", latestVersion: "6.1.0", status: "update" },
    ] },
    renovate,
    activity: { windowHours: 168, events: [
      { id: "commit:a", at: "2026-11-27T03:00:00Z", kind: "commit", actor: { name: "renovate" }, text: "Update Helm release kube-prometheus-stack to v93.11.1", area: "monitoring", tags: [["state", "applied"]], links: [{ label: "abc1234", href: "https://github.com/owner/repo/commit/abc" }, { label: "#5", href: "https://github.com/owner/repo/pull/5" }] },
      { id: "commit:b", at: "2026-11-27T02:00:00Z", kind: "commit", actor: { name: "flux" }, text: "Update blog image", detail: "111 → 222", area: "blog", tags: [["state", "pending"]], links: [] },
      { id: "commit:c", at: "2026-11-27T01:00:00Z", kind: "commit", actor: { name: "operator", kind: "person" }, text: "docs: tidy", tags: [], links: [] },
      { id: "rollout:x", at: "2026-11-27T01:00:00Z", kind: "rollout", actor: { name: "flux" }, text: "Rolled out x", tags: [], links: [] },
    ] },
    now: NOW,
    ...overrides,
  });
}

function rowsIn(m, lane) {
  return m.lanes.find((entry) => entry.id === lane).rows.map((row) => row.name);
}

test("sorts available updates into lanes by what moves them on", () => {
  const m = model();
  assert.deepEqual(rowsIn(m, "action").sort(), ["paperless", "plain", "postgres"]);
  assert.deepEqual(rowsIn(m, "flight").sort(), ["podinfo", "queuey"]);
  assert.deepEqual(rowsIn(m, "held"), ["valkey"]);
  assert.equal(m.counts.available, 6);
  assert.equal(m.counts.action, 3);
  assert.equal(m.counts.unchecked, 1);
  assert.equal(m.counts.current, 1);
  assert.equal(m.counts.tracked, 8);
});

test("names where each update stands and links to what moves it", () => {
  const all = model().lanes.flatMap((lane) => lane.rows);
  const plain = all.find((row) => row.name === "plain");
  assert.equal(plain.state.label, "No PR");
  assert.match(plain.state.why, /Run Renovate/);

  const pr = all.find((row) => row.name === "paperless");
  assert.equal(pr.state.label, "Review PR");
  assert.deepEqual(pr.state.links[0], { label: "#12", href: "https://github.com/owner/repo/pull/12", primary: true });

  const queued = all.find((row) => row.name === "queuey");
  assert.deepEqual(queued.state.links[0], { label: "Dashboard", href: renovate.dashboardIssueUrl });

  const chart = all.find((row) => row.name === "podinfo");
  assert.equal(chart.state.label, "Rolling out");
  assert.match(chart.state.why, /Git at 6\.1\.0/);
});

test("a running Renovate workflow takes over updates it would pick up", () => {
  const m = model({ renovate: { ...renovate, activeRun: { runNumber: 8, status: "in_progress", url: "https://github.com/owner/repo/actions/runs/8" } } });
  assert.ok(rowsIn(m, "flight").includes("plain"));
  const plain = m.lanes.flatMap((lane) => lane.rows).find((row) => row.name === "plain");
  assert.equal(plain.state.label, "Renovating");
  assert.equal(plain.state.links[0].href, "https://github.com/owner/repo/actions/runs/8");
});

test("shows a rebuilt floating tag as a build with its new digest", () => {
  const postgres = model().lanes.flatMap((lane) => lane.rows).find((row) => row.name === "postgres");
  assert.equal(postgres.bump, "build");
  assert.equal(postgres.toDigest, "bbbbbbb");
  const html = View.bodyMarkup(model(), { now: NOW });
  assert.match(html, /<span class="upd-tag">16<\/span><span class="upd-digest" [^>]*>bbbbbbb<\/span><span class="upd-bump" data-bump="build">/);
  assert.equal(View.changeLabel({ currentVersion: "16", latestVersion: "16" }), "16 · new build");
  assert.equal(View.changeLabel({ currentVersion: "1.0", latestVersion: "2.0" }), "1.0 → 2.0");
});

test("names how far a version moves", () => {
  assert.equal(View.bump("1.3.15", "2026.11.3"), "major");
  assert.equal(View.bump("9.1-alpine", "9.2-alpine"), "minor");
  assert.equal(View.bump("v1.2.3", "v1.2.4"), "patch");
  assert.equal(View.bump("latest", "latest"), "build");
  assert.equal(View.bump("pg16", "pg17"), "");
});

test("filters every list by kind and search text", () => {
  const charts = model({ kind: "chart" });
  assert.deepEqual(charts.lanes.flatMap((lane) => lane.rows).map((row) => row.name), ["podinfo"]);
  assert.deepEqual(charts.landed.map((row) => row.name), ["kube-prometheus-stack"]);
  assert.equal(charts.current.length, 0);

  const searched = model({ query: "VALKEY" });
  assert.deepEqual(searched.lanes.flatMap((lane) => lane.rows).map((row) => row.name), ["valkey"]);
  assert.equal(searched.counts.available, 6, "counts describe the whole report, not the filter");
});

test("recent changes come from Renovate and image automation commits only", () => {
  const landed = model().landed;
  assert.deepEqual(landed.map((row) => [row.name, row.kind, row.to, row.state, row.by]), [
    ["kube-prometheus-stack", "chart", "v93.11.1", "applied", "renovate"],
    ["blog", "image", "", "pending", "image automation"],
  ]);
  assert.equal(landed[1].change, "222");
  assert.equal(model().counts.landedPending, 1);
});

test("links each image to where its releases are published", () => {
  assert.deepEqual(View.imageLinks("ghcr.io/owner/app").map((link) => link.href), [
    "https://github.com/owner/app/releases",
    "https://ghcr.io/owner/app",
  ]);
  assert.equal(View.imageLinks("lscr.io/linuxserver/sonarr")[0].href, "https://github.com/linuxserver/docker-sonarr/releases");
  assert.equal(View.imageLinks("docker.io/library/postgres")[0].href, "https://hub.docker.com/_/postgres/tags");
  assert.equal(View.imageLinks("docker.io/valkey/valkey")[0].href, "https://hub.docker.com/r/valkey/valkey/tags");
  assert.equal(View.imageLinks("quay.io/org/thing")[0].href, "https://quay.io/repository/org/thing?tab=tags");
  assert.deepEqual(View.imageLinks("registry.k8s.io/pause"), []);
  assert.equal(
    View.gitSearchLink({ imageRepo: "lscr.io/linuxserver/sonarr" }, "image", "owner/repo").href,
    "https://github.com/owner/repo/search?q=%22linuxserver%2Fsonarr%22&type=code",
  );
  assert.equal(View.gitSearchLink({ chart: "podinfo" }, "chart", "not a repo"), null);
});

test("markup escapes report text and opens outside links in a new tab", () => {
  const m = View.buildModel({
    images: { items: [image("<b>x</b>", { detail: "<script>" , status: "unknown" })] },
    charts: { items: [] },
    renovate,
    activity: { events: [] },
  });
  const html = View.bodyMarkup(m, { open: { unchecked: true } });
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /data-updates-disclosure="unchecked" open/);
  for (const anchor of html.match(/<a [^>]*href="https?:[^>]*>/g) || []) {
    assert.match(anchor, /target="_blank" rel="noreferrer"/);
  }
});

test("reports a failed report instead of claiming everything is current", () => {
  const m = View.buildModel({ images: { items: [], error: "registry down" }, charts: { items: [] }, renovate, activity: null });
  const html = View.bodyMarkup(m, {});
  assert.match(html, /Images: registry down/);
  assert.doesNotMatch(html, /All current/);
  assert.match(html, /Loading…/);
});

test("Renovate status is one line with its run, PRs and dashboard", () => {
  const idle = View.renovateMarkup(renovate, NOW);
  assert.match(idle, /Renovate ok 1h ago/);
  assert.match(idle, />#7</);
  assert.match(idle, />1 PR</);
  assert.match(idle, />Dashboard</);
  const running = View.renovateMarkup({ ...renovate, activeRun: { runNumber: 8, createdAt: "2026-11-27T05:58:00Z", url: "https://x/8" } }, NOW);
  assert.match(running, /Renovate running 2m/);
  assert.match(running, /lamp pending/);
  assert.match(View.renovateMarkup({ configured: false }, NOW), /Renovate off/);
});

test("the control panel serves the view after the policy it reads", () => {
  const dir = __dirname;
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.ok(html.indexOf("/assets/updates-view.js") > html.indexOf("/assets/update-policy.js"));
  assert.ok(html.indexOf("/assets/updates-view.js") < html.indexOf("/assets/app.js"));
  assert.match(fs.readFileSync(path.join(dir, "server.js"), "utf8"), /"\/assets\/updates-view\.js"/);
  assert.match(fs.readFileSync(path.join(dir, "kustomization.yaml"), "utf8"), /- updates-view\.js/);
});
