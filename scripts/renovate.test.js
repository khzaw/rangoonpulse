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
