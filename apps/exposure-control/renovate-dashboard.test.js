const assert = require("node:assert/strict");
const { test } = require("node:test");

const { parseDependencyDashboard } = require("./renovate-dashboard");

test("dependency dashboard parser separates rate-limited updates from detected dependencies", () => {
  const body = `## Rate-Limited

 - [ ] <!-- unlimit-branch=renovate/immich-monorepo -->Update immich monorepo to v3.1.0
 - [ ] <!-- unlimit-branch=renovate/timescale-timescaledb-2.x -->Update timescale/timescaledb Docker tag to v2.29.0
 - [ ] <!-- create-all-rate-limited-prs -->Create all rate-limited PRs at once

## Open

 - [ ] <!-- rebase-branch=renovate/old -->Old PR

## Detected Dependencies

 - \`ghcr.io/immich-app/immich-machine-learning v3.0.3\` → [Updates: \`v3.1.0\`]
 - \`ghcr.io/immich-app/immich-server v3.0.3\` → [Updates: \`v3.1.0\`]
 - \`node 24-alpine\`
 - \`ghcr.io/immich-app/immich-server v3.0.3\` → [Updates: \`v3.1.0\`]
`;

  assert.deepEqual(parseDependencyDashboard(body), {
    rateLimitedUpdates: [
      {
        branchName: "renovate/immich-monorepo",
        title: "Update immich monorepo to v3.1.0",
      },
      {
        branchName: "renovate/timescale-timescaledb-2.x",
        title: "Update timescale/timescaledb Docker tag to v2.29.0",
      },
    ],
    detectedDependencies: [
      {
        name: "ghcr.io/immich-app/immich-machine-learning",
        currentValue: "v3.0.3",
        updates: ["v3.1.0"],
      },
      {
        name: "ghcr.io/immich-app/immich-server",
        currentValue: "v3.0.3",
        updates: ["v3.1.0"],
      },
      { name: "node", currentValue: "24-alpine", updates: [] },
    ],
  });
});
