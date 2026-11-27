const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "../..");
const renovate = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "renovate.json"), "utf8"),
);
const workflow = fs.readFileSync(
  path.join(REPO_ROOT, ".github/workflows/renovate.yaml"),
  "utf8",
);

test("Renovate refills the bounded PR queue every six hours", () => {
  assert.match(workflow, /cron:\s*["']23 \*\/6 \* \* \*["']/);
  assert.doesNotMatch(workflow, /configurationFile:\s*renovate\.json/);
  assert.equal(renovate.dependencyDashboard?.enabled, true);
  assert.equal(renovate.prConcurrentLimit, 7);
  assert.equal(renovate.prHourlyLimit, 7);
});

test("Renovate tracks images in raw Kubernetes workloads", () => {
  assert.ok(renovate.enabledManagers.includes("kubernetes"));
  assert.ok(
    renovate.kubernetes.managerFilePatterns.some((pattern) =>
      pattern.includes("apps|core|infrastructure"),
    ),
  );
});

test("helm-values only scans standalone values files so HelmReleases are not duplicated across flux", () => {
  const patterns = renovate["helm-values"].managerFilePatterns.map(
    (pattern) => new RegExp(pattern.slice(1, -1)),
  );
  assert.ok(patterns.some((re) => re.test("apps/actualbudget/values.yaml")));
  assert.ok(!patterns.some((re) => re.test("apps/adguard/primary/helmrelease.yaml")));
  assert.ok(!patterns.some((re) => re.test("apps/jackett/helmrelease.yaml")));
});

test("AdGuard primary and secondary split rules apply to the flux manager", () => {
  for (const [file, prefix] of [
    ["apps/adguard/primary/helmrelease.yaml", "adguard-primary-"],
    ["apps/adguard/secondary/helmrelease.yaml", "adguard-secondary-"],
  ]) {
    const rule = renovate.packageRules.find(
      (entry) =>
        Array.isArray(entry.matchFileNames) &&
        entry.matchFileNames.includes(file) &&
        entry.additionalBranchPrefix === prefix,
    );
    assert.ok(rule, `expected split rule for ${file}`);
    assert.ok(rule.matchManagers.includes("flux"), `expected ${file} rule to match flux manager`);
  }
});

test("Flux-managed app images stay excluded without hiding sidecars or Helm charts", () => {
  assert.ok(!renovate.ignorePaths.includes("apps/retirement/**"));
  assert.ok(!renovate.ignorePaths.includes("apps/interview-prep/**"));

  const fluxManagedRule = renovate.packageRules.find(
    (rule) =>
      rule.enabled === false &&
      Array.isArray(rule.matchPackageNames) &&
      rule.matchPackageNames.includes("ghcr.io/khzaw/retirement"),
  );
  assert.ok(fluxManagedRule, "expected a package rule disabling Flux-managed app images");
  assert.ok(fluxManagedRule.matchPackageNames.includes("ghcr.io/khzaw/interview-prep"));
  assert.ok(!fluxManagedRule.matchPackageNames.includes("litestream/litestream"));
});
