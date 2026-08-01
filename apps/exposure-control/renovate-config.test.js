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
  assert.equal(renovate.prConcurrentLimit, 5);
  assert.equal(renovate.prHourlyLimit, 5);
});

test("Renovate tracks images in raw Kubernetes workloads", () => {
  assert.ok(renovate.enabledManagers.includes("kubernetes"));
  assert.ok(
    renovate.kubernetes.managerFilePatterns.some((pattern) =>
      pattern.includes("apps|core|infrastructure"),
    ),
  );
});

test("Retirement keeps Flux image automation isolated without hiding Litestream", () => {
  assert.ok(!renovate.ignorePaths.includes("apps/retirement/**"));

  const retirementRule = renovate.packageRules.find(
    (rule) =>
      rule.enabled === false &&
      Array.isArray(rule.matchPackageNames) &&
      rule.matchPackageNames.includes("ghcr.io/khzaw/retirement"),
  );
  assert.ok(retirementRule, "expected a package rule disabling only the Retirement app image");
  assert.ok(!retirementRule.matchPackageNames.includes("litestream/litestream"));
});
