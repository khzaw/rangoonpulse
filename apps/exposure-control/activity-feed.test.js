const assert = require("node:assert/strict");
const { test } = require("node:test");
const feed = require("./activity-feed.js");

const NOW = Date.parse("2026-11-21T16:00:00Z");
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();
const sha = (char) => char.repeat(40);

function kustomization(name, path, appliedSha, ready) {
  return {
    metadata: { name, namespace: "flux-system" },
    spec: { path },
    status: {
      lastAppliedRevision: appliedSha ? "master@sha1:" + appliedSha : undefined,
      conditions: [ready || { type: "Ready", status: "True", reason: "ReconciliationSucceeded", lastTransitionTime: at(5) }],
    },
  };
}

function commit(id, minutesAgo, message, author = "Kaung Htet", login = "khzaw") {
  return {
    sha: sha(id),
    commit: { author: { name: author, date: at(minutesAgo + 90) }, committer: { name: "GitHub", date: at(minutesAgo) }, message },
    author: login ? { login, type: "User" } : null,
  };
}

function release(name, history, options = {}) {
  return {
    metadata: { name, namespace: options.namespace || "default", labels: options.owner ? { "kustomize.toolkit.fluxcd.io/name": options.owner } : {} },
    spec: { suspend: Boolean(options.suspend) },
    status: {
      conditions: [options.ready || { type: "Ready", status: "True", reason: "UpgradeSucceeded", lastTransitionTime: at(5) }],
      history,
    },
  };
}

const deployed = (version, minutesAgo, extra = {}) => ({ version, status: "deployed", chartName: "app-template", chartVersion: "5.3.0", lastDeployed: at(minutesAgo), ...extra });
const byId = (result, id) => result.events.find((event) => event.id === id);
const tag = (event, key) => (event.tags.find(([name]) => name === key) || [])[1];

test("files belong to the Kustomization with the longest matching path, with a path fallback", () => {
  const areas = feed.kustomizationAreas([
    kustomization("cert-manager", "./infrastructure/cert-manager"),
    kustomization("cert-manager-config", "./infrastructure/cert-manager/config/"),
    kustomization("adguard-primary", "./apps/adguard/primary"),
    { metadata: { name: "pathless" }, spec: {} },
  ]);
  assert.equal(feed.areaForFile("infrastructure/cert-manager/config/issuer.yaml", areas), "cert-manager-config");
  assert.equal(feed.areaForFile("infrastructure/cert-manager/helmrelease.yaml", areas), "cert-manager");
  assert.equal(feed.areaForFile("apps/adguard/primary/helmrelease.yaml", areas), "adguard-primary");
  // A sibling whose name merely starts the same is not inside the path.
  assert.equal(feed.areaForFile("infrastructure/cert-manager-extra/x.yaml", areas), "cert-manager-extra");
  assert.equal(feed.areaForFile("apps/jackett/helmrelease.yaml", areas), "jackett");
  assert.equal(feed.areaForFile("docs/README.md", areas), "docs");
  assert.equal(feed.areaForFile(".github/workflows/renovate.yaml", areas), "ci");
  assert.equal(feed.areaForFile("README.md", areas), "repo");
  assert.deepEqual(feed.areasForFiles(["docs/a.md", "apps/jackett/a.yaml", "apps/jackett/b.yaml"], areas), ["jackett", "docs"]);
  assert.deepEqual(feed.areasForFiles(undefined, areas), []);
});

test("commit authors are recognised as automation or people without trusting the message", () => {
  assert.equal(feed.commitActor(commit("a", 1, "x", "fluxcdbot", null)), feed.ACTORS.flux);
  assert.equal(feed.commitActor(commit("a", 1, "image-automation(blog): update a -> b", "Someone", null)), feed.ACTORS.flux);
  assert.equal(feed.commitActor(commit("a", 1, "x", "Renovate", null)), feed.ACTORS.renovate);
  assert.equal(feed.commitActor(commit("a", 1, "x", "panel bot", null), { panelAuthor: "panel bot" }), feed.ACTORS.panel);
  assert.deepEqual(feed.commitActor({ commit: { author: { name: "dependabot[bot]" } }, author: { login: "dependabot[bot]", type: "Bot" } }), { name: "dependabot", kind: "bot", icon: "commit" });
  assert.deepEqual(feed.commitActor(commit("a", 1, "renovate: tidy config")), { name: "khzaw", kind: "person" });
  assert.deepEqual(feed.commitActor(commit("a", 1, "x", "Kaung Htet", null)), { name: "Kaung Htet", kind: "person" });
  assert.deepEqual(feed.commitActor({}), { name: "unknown", kind: "person" });
});

test("commits keep human subjects verbatim, trim automation noise and link only a valid repository", () => {
  const result = feed.buildFeed({
    now: NOW,
    fluxAvailable: true,
    repository: "khzaw/rangoonpulse",
    kustomizations: [kustomization("flux-system", "./flux", sha("a")), kustomization("blog", "./apps/blog", sha("a"))],
    commits: [
      commit("a", 10, "image-automation(blog): update 1795175152-5eed42690a443133a9fada7375b9a3c8a85194c4 -> 1795259441-5eed42690a443133a9fada7375b9a3c8a85194c4", "fluxcdbot", null),
      commit("b", 20, "chore(deps): update adguard/adguardhome docker tag to v1 (#962)\n\nbody is ignored"),
      commit("c", 30, "chore(deps): update dependency linuxserver/docker-jackett to v0.25.8", "Renovate", null),
      { sha: "not-a-sha", commit: { message: "ignored" } },
    ],
    commitFiles: new Map([[sha("a"), ["apps/blog/helmrelease.yaml"]]]),
  });
  const image = byId(result, "commit:" + sha("a"));
  assert.equal(image.text, "Update blog image");
  assert.equal(image.detail, "1795175152-5eed426 → 1795259441-5eed426");
  assert.equal(image.area, "blog");
  assert.equal(image.at, at(10), "the committer date is when the commit landed");
  assert.deepEqual(image.links, [{ label: "aaaaaaa", href: "https://github.com/khzaw/rangoonpulse/commit/" + sha("a") }]);
  assert.equal(image.sha, undefined);

  const merged = byId(result, "commit:" + sha("b"));
  assert.equal(merged.text, "chore(deps): update adguard/adguardhome docker tag to v1");
  assert.deepEqual(merged.links.map((link) => link.label), ["bbbbbbb", "#962"]);
  assert.equal(merged.links[1].href, "https://github.com/khzaw/rangoonpulse/pull/962");
  assert.equal(merged.area, null, "a commit whose files are unknown claims no area");

  assert.equal(byId(result, "commit:" + sha("c")).text, "Update dependency linuxserver/docker-jackett to v0.25.8");
  assert.equal(result.events.filter((event) => event.kind === "commit").length, 3);

  const unlinked = feed.buildFeed({ now: NOW, repository: "https://evil.test/x y", commits: [commit("a", 1, "x")] });
  assert.deepEqual(unlinked.events[0].links, []);
});

test("a commit is applied only when every Kustomization that owns its files has reached it", () => {
  const commits = [commit("a", 5, "radarr: newest"), commit("b", 15, "jackett and docs"), commit("c", 25, "docs: only"), commit("d", 35, "sonarr: unknown revision")];
  const result = feed.buildFeed({
    now: NOW,
    fluxAvailable: true,
    commits,
    commitFiles: {
      [sha("a")]: ["apps/radarr/helmrelease.yaml"],
      [sha("b")]: ["apps/jackett/helmrelease.yaml", "docs/jackett.md"],
      [sha("c")]: ["docs/README.md"],
      [sha("d")]: ["apps/sonarr/helmrelease.yaml"],
    },
    kustomizations: [
      kustomization("flux-system", "./flux", sha("b")),
      kustomization("radarr", "./apps/radarr", sha("b")),
      kustomization("jackett", "./apps/jackett", sha("b")),
      // A revision outside the listing is unknown, not assumed older or newer.
      kustomization("sonarr", "./apps/sonarr", sha("9")),
    ],
  });
  assert.equal(tag(byId(result, "commit:" + sha("a")), "state"), "pending");
  assert.equal(tag(byId(result, "commit:" + sha("b")), "state"), "applied");
  assert.equal(tag(byId(result, "commit:" + sha("c")), "state"), "applied", "unowned files follow the root Kustomization");
  assert.equal(tag(byId(result, "commit:" + sha("d")), "state"), undefined);
  assert.equal(result.summary.pending, 1);
  assert.equal(result.state, "syncing");
});

test("a rollout quotes the commit that landed for its area after the previous rollout", () => {
  const result = feed.buildFeed({
    now: NOW,
    fluxAvailable: true,
    kustomizations: [kustomization("jackett", "./apps/jackett", sha("a")), kustomization("monitoring", "./infrastructure/monitoring", sha("a")), kustomization("blog", "./apps/blog", sha("a"))],
    commits: [
      commit("a", 31, "chore(deps): update jackett to v2", "Renovate", null),
      commit("b", 32, "jackett: tune probes"),
      commit("c", 200, "jackett: an older change"),
      commit("d", 62, "monitoring: bump the stack"),
      commit("e", 400, "blog: long before the rollout"),
    ],
    commitFiles: new Map([
      [sha("a"), ["apps/jackett/helmrelease.yaml"]],
      [sha("b"), ["apps/jackett/helmrelease.yaml"]],
      [sha("c"), ["apps/jackett/helmrelease.yaml"]],
      [sha("d"), ["infrastructure/monitoring/helmrelease.yaml"]],
      [sha("e"), ["apps/blog/helmrelease.yaml"]],
    ]),
    helmReleases: [
      release("jackett", [deployed(137, 30), { ...deployed(136, 190), status: "superseded" }]),
      release("kube-prometheus-stack", [
        deployed(177, 60, { chartName: "kube-prometheus-stack", chartVersion: "93.4.1" }),
        { ...deployed(176, 1500, { chartName: "kube-prometheus-stack", chartVersion: "93.4.0" }), status: "superseded" },
      ], { owner: "monitoring", namespace: "monitoring" }),
      release("blog", [deployed(1, 20)]),
      release("retry", [deployed(4, 28), { ...deployed(3, 29), status: "superseded" }], { owner: "jackett" }),
    ],
  });
  const current = byId(result, "rollout:default/jackett:137");
  assert.equal(current.text, "Rolled out jackett");
  assert.equal(current.quote.text, "Update jackett to v2");
  assert.equal(current.quote.actor, feed.ACTORS.renovate);
  assert.equal(current.quote.more, 1, "two commits landed for this rollout");
  assert.equal(current.detail, null);
  assert.deepEqual(current.tags, [["rev", "137"], ["status", "deployed"]]);

  const previous = byId(result, "rollout:default/jackett:136");
  assert.deepEqual(previous.tags, [["rev", "136"]]);
  assert.equal(previous.quote.text, "jackett: an older change", "commits that landed after a rollout cannot have caused it");
  assert.equal(previous.quote.more, 0);

  const stack = byId(result, "rollout:monitoring/kube-prometheus-stack:177");
  assert.equal(stack.area, "monitoring");
  assert.equal(stack.detail, "kube-prometheus-stack 93.4.0 → 93.4.1");
  assert.equal(stack.quote.text, "monitoring: bump the stack");

  const installed = byId(result, "rollout:default/blog:1");
  assert.equal(installed.text, "Installed blog");
  assert.equal(installed.detail, "app-template 5.3.0");
  assert.equal(installed.quote, null, "a commit hours earlier is not attributed");

  // A second rollout moments later has no commit of its own.
  assert.equal(byId(result, "rollout:default/retry:4").quote, null);
  assert.equal(result.state, "in-sync");
});

test("failed rollouts and objects that are not Ready are counted, pinned and never hidden by age", () => {
  const result = feed.buildFeed({
    now: NOW,
    fluxAvailable: true,
    helmReleases: [
      release("jackett", [{ ...deployed(138, 40), status: "failed" }, { ...deployed(137, 60 * 24 * 9), status: "superseded" }], {
        ready: { type: "Ready", status: "False", reason: "UpgradeFailed", lastTransitionTime: at(60 * 24 * 12), message: "Helm upgrade failed:\n  context   deadline exceeded" },
      }),
      release("radarr", [], { ready: { type: "Ready", status: "Unknown", reason: "Progressing", lastTransitionTime: at(2), message: "Running 'upgrade' action" } }),
      release("waiting", [], { ready: { type: "Ready", status: "False", reason: "DependencyNotReady", lastTransitionTime: at(3) } }),
      release("parked", [], { suspend: true, ready: { type: "Ready", status: "False", reason: "UpgradeFailed", lastTransitionTime: at(3) } }),
    ],
    kustomizations: [kustomization("secrets", "./infrastructure/secrets", null, { type: "Ready", status: "False", reason: "BuildFailed", lastTransitionTime: at(8), message: "x".repeat(400) })],
  });
  assert.deepEqual(result.events.slice(0, 4).map((event) => [event.id, event.pinned, event.failed]), [
    ["flux:kustomize:flux-system/secrets", true, true],
    ["flux:helm:default/jackett", true, true],
    ["flux:helm:default/radarr", true, false],
    ["flux:helm:default/waiting", true, false],
  ]);
  const stalled = byId(result, "flux:helm:default/jackett");
  assert.equal(stalled.text, "jackett is not ready");
  assert.equal(stalled.detail, "Helm upgrade failed: context deadline exceeded");
  assert.equal(stalled.tone, "danger");
  assert.deepEqual(stalled.tags, [["reason", "UpgradeFailed"]]);
  assert.equal(stalled.progress, null);
  const progressing = byId(result, "flux:helm:default/radarr");
  assert.equal(progressing.text, "Reconciling radarr");
  assert.deepEqual(progressing.progress, { ratio: null, label: "in progress" });
  assert.equal(byId(result, "flux:kustomize:flux-system/secrets").detail.length, 240);
  assert.ok(!result.events.some((event) => event.id.includes("parked")));

  const failed = byId(result, "rollout:default/jackett:138");
  assert.equal(failed.text, "Rollout of jackett failed");
  assert.equal(failed.quote, null);
  assert.equal(tag(failed, "status"), "failed");
  assert.ok(!byId(result, "rollout:default/jackett:137"), "events older than the window are dropped");

  assert.deepEqual(result.summary, { hours: 24, commits: 0, rollouts: 0, failed: 3, pending: 0, stalled: 2, reconciling: 2 });
  assert.equal(result.state, "stalled");
});

test("state is unknown without Flux and unread sources yield no counts", () => {
  const blind = feed.buildFeed({ now: NOW, gitAvailable: false, fluxAvailable: false, audit: [{ action: "disable", serviceId: "books", ts: at(5) }] });
  assert.equal(blind.state, "unknown");
  assert.equal(blind.summary.commits, null);
  assert.equal(blind.summary.rollouts, null);
  assert.equal(blind.summary.failed, null);
  assert.equal(blind.events.length, 1);

  const quiet = feed.buildFeed({ now: NOW, fluxAvailable: true });
  assert.equal(quiet.state, "in-sync");
  assert.deepEqual([quiet.summary.commits, quiet.summary.rollouts, quiet.summary.failed], [0, 0, 0]);
  assert.deepEqual(feed.buildFeed().events, []);
});

test("the operator audit log reads as plain actions and ignores malformed entries", () => {
  const jobs = [{ id: "report", namespace: "monitoring", cronJob: "advisor-report", fluxKustomization: "resource-advisor" }];
  const result = feed.buildFeed({
    now: NOW,
    jobs,
    audit: [
      { action: "enable", serviceId: "jellyfin", authMode: "none", hours: 0.5, ts: at(1) },
      { action: "enable", serviceId: "books", authMode: "cloudflare-access", expiryMode: "until-disabled", ts: at(2) },
      { action: "disable", serviceId: "books", ts: at(3) },
      { action: "auto-expire", serviceId: "books", trigger: "startup", ts: at(4) },
      { action: "emergency-disable-all", disabled: 3, ts: at(5) },
      { action: "site-deploy", serviceId: "blog", ts: at(6) },
      { action: "site-deploy-all", serviceId: "static-sites", ts: at(7) },
      { action: "managed-job-run", serviceId: "monitoring/advisor-report", ts: at(8) },
      { action: "managed-job-config", serviceId: "monitoring/advisor-report", ts: at(9) },
      { action: "transmission-vpn-set", serviceId: "transmission", mode: "vpn", ts: at(10) },
      { action: "secret-upsert", serviceId: "default/example", ts: at(11) },
      { action: "something-new", serviceId: "x", ts: at(12) },
      { action: "disable", serviceId: "undated" },
      { serviceId: "no-action", ts: at(1) },
      null,
    ],
  });
  assert.deepEqual(result.events.map((event) => [event.text, event.via, event.actor.name, event.area]), [
    ["Shared jellyfin", "shares", "operator", "jellyfin"],
    ["Shared books", "shares", "operator", "books"],
    ["Unshared books", "shares", "operator", "books"],
    ["Share of books expired", "shares", "panel", "books"],
    ["Disabled all shares", "shares", "operator", null],
    ["Requested a deploy of blog", "deploy", "operator", "blog"],
    ["Requested a deploy of every site", "deploy", "operator", null],
    ["Started advisor-report", "jobs", "operator", "resource-advisor"],
    ["Rescheduled advisor-report", "jobs", "operator", "resource-advisor"],
    ["Routed Transmission through the VPN", "route", "operator", "transmission"],
    ["Saved secret default/example", "secrets", "operator", "secrets"],
    ["something-new x", "panel", "operator", null],
  ]);
  assert.deepEqual(result.events[0].tags, [["ttl", "0.5h"], ["auth", "none"]]);
  assert.equal(result.events[0].tone, "warning", "an unauthenticated share is flagged");
  assert.deepEqual(result.events[1].tags, [["ttl", "none"], ["auth", "cf-access"]]);
  assert.equal(result.events[1].tone, "neutral");
  assert.deepEqual(result.events[4].tags, [["closed", "3"]]);
});

test("edits to a live share say what changed", () => {
  const result = feed.buildFeed({
    now: NOW,
    audit: [
      { action: "update", serviceId: "jellyfin", extendHours: 1, expiresAt: at(-90), ts: at(1) },
      { action: "update", serviceId: "books", expiryMode: "until-disabled", expiresAt: null, ts: at(2) },
      { action: "update", serviceId: "books", hours: 0.25, authMode: "cloudflare-access", expiresAt: at(-15), ts: at(3) },
      { action: "update", serviceId: "seerr", authMode: "none", expiresAt: at(-30), ts: at(4) },
    ],
  });
  assert.deepEqual(result.events.map((event) => [event.text, event.via, event.area, event.tone, event.tags]), [
    ["Extended jellyfin", "shares", "jellyfin", "neutral", [["extend", "+1h"]]],
    ["Changed expiry of books", "shares", "books", "warning", [["ttl", "none"]]],
    ["Changed expiry of books", "shares", "books", "neutral", [["ttl", "0.25h"], ["auth", "cf-access"]]],
    ["Changed auth on seerr", "shares", "seerr", "warning", [["auth", "none"]]],
  ]);
});

test("a CronJob contributes its latest run plus retained failures and work in progress", () => {
  const job = { id: "report", title: "Resource advisor report", namespace: "monitoring", cronJob: "report", fluxKustomization: "resource-advisor" };
  const run = (name, minutesAgo, status, seconds, extra = {}) => ({
    name, status, startedAt: at(minutesAgo), completedAt: seconds == null ? null : new Date(Date.parse(at(minutesAgo)) + seconds * 1000).toISOString(), durationSeconds: seconds, ...extra,
  });
  const result = feed.buildFeed({
    now: NOW,
    fluxAvailable: true,
    jobRuns: [
      { job, runs: [run("report-3", 30, "succeeded", 95), run("report-manual-x", 1, "running", null), run("report-2", 90, "failed", 12), run("report-1", 150, "succeeded", 80), { name: "undated", status: "succeeded" }] },
      { job: { id: "refresh", title: "TrueNAS management refresh", namespace: "democratic-csi", cronJob: "refresh" }, runs: [run("refresh-1", 2, "pending", null)] },
      { job: null, runs: [run("orphan", 1, "succeeded", 1)] },
    ],
  });
  const jobs = result.events.filter((event) => event.kind === "job");
  assert.deepEqual(jobs.map((event) => event.id), ["job:monitoring/report-manual-x", "job:democratic-csi/refresh-1", "job:monitoring/report-3", "job:monitoring/report-2"]);
  const running = jobs[0];
  assert.equal(running.text, "Running resource advisor report");
  assert.equal(running.via, "panel", "a hand-started run is attributed to the panel");
  assert.equal(running.pinned, true);
  assert.equal(running.progress.label, "60 s of ~2 min");
  assert.ok(Math.abs(running.progress.ratio - 60 / 95) < 1e-9);
  assert.deepEqual(jobs[1].progress, { ratio: null, label: "2 min" }, "no previous success means no estimate");
  assert.equal(jobs[1].text, "Running TrueNAS management refresh");
  assert.equal(jobs[2].text, "Ran resource advisor report");
  assert.equal(jobs[2].detail, "2 min");
  assert.equal(jobs[2].via, "cron");
  assert.equal(jobs[3].text, "Resource advisor report failed");
  assert.equal(jobs[3].failed, true);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.state, "in-sync", "job runs do not change the Git and Flux state");

  const overdue = feed.buildFeed({ now: NOW, jobRuns: [{ job, runs: [run("a", 600, "running", null), run("b", 700, "succeeded", 60)] }] });
  assert.equal(overdue.events[0].progress.ratio, 0.96, "an overrun never reads as finished");
});

test("the feed is newest first, bounded to its window and size, and serialises instants as ISO", () => {
  const commits = Array.from({ length: 300 }, (_, index) => ({
    sha: index.toString(16).padStart(40, "0"),
    commit: { author: { name: "Kaung Htet" }, committer: { date: new Date(NOW - index * 60000).toISOString().replace("Z", "+00:00") }, message: "commit " + index },
  })).concat([commit("f", 60 * 24 * 8, "too old"), { sha: sha("e"), commit: { message: "undated" } }]);
  const result = feed.buildFeed({ now: NOW, commits, fluxAvailable: true });
  assert.equal(result.events.length, feed.MAX_EVENTS);
  assert.equal(result.windowHours, 168);
  assert.equal(result.events[0].text, "commit 0");
  assert.equal(result.events[0].at, new Date(NOW).toISOString());
  assert.ok(result.events.every((event, index, list) => index === 0 || Date.parse(list[index - 1].at) >= Date.parse(event.at)));
  assert.ok(!result.events.some((event) => /too old|undated/.test(event.text)));
  assert.equal(result.summary.commits, feed.MAX_EVENTS);
  assert.equal(feed.shortTag("sha256:0123456789abcdef0123"), "sha256:0123456");
  assert.equal(feed.shortTag("v1.2.3"), "v1.2.3");
  assert.deepEqual([feed.duration(0), feed.duration(89), feed.duration(90), feed.duration(7200), feed.duration(-1), feed.duration(NaN)], ["0 s", "89 s", "2 min", "2 h", "", ""]);
});
