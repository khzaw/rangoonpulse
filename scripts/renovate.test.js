const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const config = JSON.parse(readFileSync(path.join(__dirname, "../renovate.json"), "utf8"));
const rule = config.packageRules.find((entry) =>
  entry.matchPackageNames?.includes("lscr.io/linuxserver/jellyfin"),
);
const versionPattern = new RegExp(rule.versioning.replace(/^regex:/, ""));

test("Jellyfin 12 tags expose numeric app, Ubuntu, and LinuxServer versions", () => {
  const match = versionPattern.exec("12.0ubu2604-ls48");
  assert.ok(match, "two-part Jellyfin versions must be accepted");
  assert.deepEqual({ ...match.groups }, {
    major: "12",
    minor: "0",
    patch: undefined,
    build: "2604",
    revision: "48",
  });
});

for (const [tag, expected] of [
  ["10.11.11ubu2404-ls42", { major: "10", minor: "11", patch: "11", build: "2404", revision: "42" }],
  ["10.11.11ubu2604-ls47", { major: "10", minor: "11", patch: "11", build: "2604", revision: "47" }],
  ["12.0.1ubu2604-ls49", { major: "12", minor: "0", patch: "1", build: "2604", revision: "49" }],
]) {
  test(`Jellyfin version fields remain comparable across app and base changes: ${tag}`, () => {
    const match = versionPattern.exec(tag);
    assert.ok(match);
    assert.deepEqual({ ...match.groups }, expected);
  });
}

for (const tag of [
  "latest",
  "nightly",
  "nightly-2026090709ubu2604-ls100",
  "12.0-rc1ubu2604-ls48",
  "version-12.0ubu2604",
  "amd64-12.0ubu2604-ls48",
  "12.0ubu2604",
  "12.0.1.2ubu2604-ls48",
  "12.0ubu2604-ls48-extra",
]) {
  test(`Jellyfin ignores non-release image tags: ${tag}`, () => {
    assert.equal(versionPattern.test(tag), false);
  });
}

const jackettManifestPath = "apps/jackett/helmrelease.yaml";
const jackettManifest = readFileSync(path.join(__dirname, "..", jackettManifestPath), "utf8");
const jackettManager = config.customManagers.find((entry) =>
  entry.customType === "regex" && entry.managerFilePatterns.some((pattern) =>
    new RegExp(pattern.slice(1, -1)).test(jackettManifestPath),
  ),
);

test("Jackett image updates use LinuxServer build releases and preserve the app-version image tag", () => {
  assert.ok(config.enabledManagers.includes("custom.regex"));
  assert.ok(jackettManager, "the Jackett manifest must have a custom update manager");
  const dependencies = jackettManager.matchStrings.flatMap((pattern) =>
    [...jackettManifest.matchAll(new RegExp(pattern, "g"))].map((match) => ({ ...match.groups })),
  );
  assert.equal(dependencies.length, 1, "exactly one Jackett image tag should be managed");
  const imageTag = jackettManifest.match(
    /repository: lscr\.io\/linuxserver\/jackett\s+#[^\n]+\n\s+tag:\s*(\S+)/,
  )?.[1];
  assert.ok(imageTag, "the update hint must annotate the LinuxServer Jackett image");
  assert.match(imageTag, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(dependencies[0], {
    datasource: "github-releases",
    depName: "linuxserver/docker-jackett",
    currentValue: imageTag,
  });
  assert.equal(jackettManager.versioningTemplate, "semver");
});

for (const release of ["v0.24.2605-ls31", "0.24.2605-ls31"]) {
  test(`Jackett published build maps to the app-version image tag: ${release}`, () => {
    const match = new RegExp(jackettManager.extractVersionTemplate).exec(release);
    assert.ok(match);
    assert.equal(match.groups.version, "0.24.2605");
  });
}

for (const release of [
  "v0.24.2605",
  "0.24.2605",
  "v0.24.2605-rc1-ls31",
  "v0.24.2605-ls31-rc1",
  "amd64-0.24.2605-ls31",
  "arm64v8-0.24.2605-ls31",
  "latest",
  "nightly",
  "v0.24-ls31",
  "v0.24.2605.1-ls31",
  "v0.24.2605-ls",
]) {
  test(`Jackett ignores upstream-only or non-release tags: ${release}`, () => {
    assert.equal(new RegExp(jackettManager.extractVersionTemplate).test(release), false);
  });
}
