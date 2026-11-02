const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const { runCli } = require("./cli.js");
const { createExposureClient, createHttpRequest } = require("./exposure-client.js");

async function run(args, handler = () => ({}), env = {}) {
  let stdout = "";
  let stderr = "";
  const requests = [];
  const code = await runCli(args, {
    env,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), ...options });
      const payload = await handler(url, options);
      return Response.json(payload);
    },
  });
  return { code, stdout, stderr, requests };
}

test("help and invalid commands never send requests", async () => {
  for (const args of [[], ["--help"], ["enable", "--help"]]) {
    const result = await run(args);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: exposure/);
    assert.equal(result.requests.length, 0);
  }
  for (const args of [["unknown"], ["enable"], ["enable", "books", "--for", "5m"],
    ["enable", "books", "--for", "25h"], ["enable", "books", "--for", "16m"],
    ["enable", "books", "--for", "1h", "--until-disabled"],
    ["enable", "books", "--auth", "typo"], ["disable", "../books"],
    ["disable", "books", "extra"], ["list", "--for", "1h"], ["list", "books"],
    ["disable-all"], ["audit", "--limit", "101"], ["audit", "--limit", "1.5"],
    ["list", "--unknown"]]) {
    const result = await run(args);
    assert.equal(result.code, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /exposure:/);
    assert.equal(result.requests.length, 0);
  }
});

test("enable honors explicit flags and lets the server supply omitted defaults", async () => {
  for (const [flags, expected] of [[[], {}], [["--for", "90m", "--auth", "none"], { hours: 1.5, authMode: "none" }],
    [["--until-disabled", "--auth", "cloudflare-access"], { hours: null, authMode: "cloudflare-access" }]]) {
    const result = await run(["enable", "books", ...flags, "--json"], () => ({ service: { id: "books", enabled: true } }));
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].method, "POST");
    assert.equal(result.requests[0].url, "https://controlpanel.khzaw.dev/api/services/books/enable");
    assert.deepEqual(JSON.parse(result.requests[0].body), expected);
    assert.deepEqual(JSON.parse(result.stdout), { service: { id: "books", enabled: true } });
  }
});

test("JSON filtering, detail, audit order and endpoint overrides compose", async () => {
  const services = [{ id: "books", enabled: true }, { id: "photos", enabled: false }];
  const active = await run(["--json", "list", "--active"], () => ({ services }), { EXPOSURE_CONTROL_URL: "http://127.0.0.1:9090" });
  assert.deepEqual(JSON.parse(active.stdout), { services: [services[0]] });
  assert.equal(active.requests[0].url, "http://127.0.0.1:9090/api/services");
  const detail = await run(["show", "photos", "--json", "--url", "http://localhost:8080"], () => ({ services }), { EXPOSURE_CONTROL_URL: "https://ignored.example" });
  assert.deepEqual(JSON.parse(detail.stdout), { service: services[1] });
  assert.equal(detail.requests[0].url, "http://localhost:8080/api/services");
  const missing = await run(["show", "absent"], () => ({ services }));
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /service not found/);
  const entries = [{ serviceId: "books", action: "disable" }, { serviceId: "photos" }, { serviceId: "books", action: "enable" }];
  const audit = await run(["audit", "books", "--limit", "1", "--json"], () => ({ entries }));
  assert.deepEqual(JSON.parse(audit.stdout), { entries: [entries[0]] });
});

test("human output handles empty lists and marks unbounded public shares", async () => {
  const empty = await run(["list"], () => ({ services: [] }));
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /SERVICE\s+STATE/);
  const result = await run(["list"], () => ({ services: [{ id: "books", enabled: true, authMode: "none", publicUrl: "https://books.example" }] }));
  assert.match(result.stdout, /books\s+public\s+none\s+until disabled/);
});

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

test("HTTP transport bounds requests and reports API, HTML, and network errors", async () => {
  for (const baseUrl of ["file:///tmp/api", "https://user:pass@example.test", "https://example.test/api", "https://example.test/?a=1"]) {
    assert.throws(() => createHttpRequest({ baseUrl }), /URL must/);
  }
  for (const [response, expected] of [
    [Response.json({ error: "service not found" }, { status: 404 }), /service not found/],
    [new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }), /private Control Panel API/],
  ]) {
    const request = createHttpRequest({ baseUrl: "https://example.test", fetchImpl: async (_, options) => {
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return response;
    } });
    await assert.rejects(() => request("/api/services", "GET"), expected);
  }
  const failed = await run(["list"], () => { throw new Error("offline"); });
  assert.equal(failed.code, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /offline/);
});
