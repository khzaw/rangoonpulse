const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const { createExposureClient } = require("./exposure-client.js");

test("the browser global and Node export use the same API contract", async () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve("./exposure-client.js"), "utf8"), context);
  for (const createClient of [createExposureClient, context.ExposureClient.createExposureClient]) {
    const calls = [];
    const client = createClient({ request: async (...args) => { calls.push(args); } });
    await client.list();
    await client.enable("books", { hours: null, authMode: "none" });
    await client.disable("books");
    await client.disableAll();
    await client.audit();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
      ["/api/services", "GET"], ["/api/services/books/enable", "POST", { hours: null, authMode: "none" }],
      ["/api/services/books/disable", "POST"], ["/api/admin/disable-all", "POST"], ["/api/audit", "GET"],
    ]);
    assert.throws(() => client.enable("../bad"), /invalid service id/);
  }
});
