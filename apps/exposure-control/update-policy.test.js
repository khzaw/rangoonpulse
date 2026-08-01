const assert = require("node:assert/strict");
const { test } = require("node:test");

const { classifyImageUpdate } = require("./update-policy");

const lastRun = { updatedAt: "2026-08-01T00:00:00.000Z" };

test("classifies a dashboard rate-limited dependency as queued", () => {
  const result = classifyImageUpdate(
    {
      name: "media-postgres",
      imageRepo: "docker.io/timescale/timescaledb",
      currentVersion: "2.28.3-pg16",
      latestVersion: "2.29.0-pg16",
      status: "update",
    },
    {
      lastRun,
      rateLimitedUpdates: [
        {
          branchName: "renovate/timescale-timescaledb-2.x",
          title: "Update timescale/timescaledb Docker tag to v2.29.0",
        },
      ],
      detectedDependencies: [
        {
          name: "timescale/timescaledb",
          currentValue: "2.28.3-pg16",
          updates: ["2.29.0-pg16"],
        },
      ],
    },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "queued");
  assert.equal(result.label, "queued");
  assert.equal(result.canRun, false);
});

test("matches monorepo queue entries to component images", () => {
  const result = classifyImageUpdate(
    {
      name: "immich-server",
      imageRepo: "ghcr.io/immich-app/immich-server",
      currentVersion: "v3.0.2",
      latestVersion: "v3.1.0",
      status: "update",
    },
    {
      lastRun,
      rateLimitedUpdates: [
        {
          branchName: "renovate/immich-monorepo",
          title: "Update immich monorepo to v3.1.0",
        },
      ],
      detectedDependencies: [
        {
          name: "ghcr.io/immich-app/immich-server",
          currentValue: "v3.0.3",
          updates: ["v3.1.0"],
        },
      ],
    },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "queued");
  assert.equal(result.label, "queued");
});

test("classifies a live image behind the Renovate-declared Git version", () => {
  const result = classifyImageUpdate(
    {
      name: "immich-machine-learning",
      imageRepo: "ghcr.io/immich-app/immich-machine-learning",
      currentVersion: "v3.0.2",
      latestVersion: "v3.0.3",
      status: "update",
    },
    {
      lastRun,
      rateLimitedUpdates: [
        {
          branchName: "renovate/immich-monorepo",
          title: "Update immich monorepo to v3.1.0",
        },
      ],
      detectedDependencies: [
        {
          name: "immich",
          currentValue: "0.12.0",
          updates: [],
        },
        {
          name: "ghcr.io/immich-app/immich-machine-learning",
          currentValue: "v3.0.3",
          updates: ["v3.1.0"],
        },
      ],
    },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "git-ahead");
  assert.equal(result.label, "Git at v3.0.3");
  assert.equal(result.canRun, false);
});

test("classifies floating Node major tags as an intentional version policy", () => {
  const result = classifyImageUpdate(
    {
      name: "exposure-control",
      imageRepo: "docker.io/library/node",
      currentVersion: "24-alpine",
      latestVersion: "26-alpine",
      status: "update",
    },
    { lastRun, detectedDependencies: [] },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "version-policy");
  assert.equal(result.label, "Node 24 line");
  assert.equal(result.canRun, false);
});

test("classifies operator-generated images as chart managed", () => {
  for (const imageRepo of [
    "quay.io/prometheus-operator/prometheus-operator",
    "docker.io/tailscale/tailscale",
  ]) {
    const result = classifyImageUpdate(
      {
        name: "generated-workload",
        imageRepo,
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update",
      },
      {
        lastRun,
        detectedDependencies: [],
        rateLimitedUpdates: [
          {
            branchName: "renovate/prometheus-blackbox-exporter-11.x",
            title: "Update Helm release prometheus-blackbox-exporter to 11.16.x",
          },
        ],
      },
      "2026-08-01T01:00:00.000Z",
    );

    assert.equal(result.kind, "chart-managed");
    assert.equal(result.label, "chart managed");
    assert.equal(result.canRun, false);
  }
});

test("classifies an update discovered after Renovate ran even when the dependency was already known", () => {
  const result = classifyImageUpdate(
    {
      name: "jackett",
      imageRepo: "lscr.io/linuxserver/jackett",
      currentVersion: "0.24.2304",
      latestVersion: "0.24.2307",
      status: "update",
    },
    {
      lastRun,
      rateLimitedUpdates: [
        {
          branchName: "renovate/lscr.io-linuxserver-sabnzbd-5.x",
          title: "Update lscr.io/linuxserver/sabnzbd Docker tag to v5.0.4-ls264",
        },
      ],
      detectedDependencies: [
        {
          name: "lscr.io/linuxserver/jackett",
          currentValue: "0.24.2304",
          updates: [],
        },
      ],
    },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "new-since-run");
  assert.equal(result.label, "new since run");
  assert.equal(result.canRun, true);
});

test("classifies an update published after Renovate ran as new since run", () => {
  const result = classifyImageUpdate(
    {
      name: "uptime-kuma",
      imageRepo: "docker.io/louislam/uptime-kuma",
      currentVersion: "2.4.0",
      latestVersion: "2.5.0",
      status: "update",
    },
    { lastRun, detectedDependencies: [] },
    "2026-08-01T01:00:00.000Z",
  );

  assert.equal(result.kind, "new-since-run");
  assert.equal(result.label, "new since run");
  assert.equal(result.canRun, true);
});
