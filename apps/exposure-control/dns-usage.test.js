const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createDnsUsage } = require("./dns-usage.js");

const NOW = Date.parse("2026-11-27T00:00:00Z");

function cloudflare({ usage = 132, quota = 200, zones } = {}) {
  const calls = [];
  const state = { fail: false, usage, quota };
  const fetchJson = async (url, headers) => {
    calls.push({ url, headers });
    if (state.fail) throw new Error("offline");
    if (url.includes("/zones?name=")) {
      return { success: true, result: zones || [{ id: "zone-1", name: "example.dev", account: { id: "acct-1" } }] };
    }
    if (url.endsWith("/zones/zone-1/dns_records/usage")) {
      return { success: true, result: { record_usage: state.usage, record_quota: state.quota } };
    }
    return { success: false, errors: [{ code: 7003, message: "No route" }] };
  };
  return { calls, state, fetchJson };
}

function usage(api, clock = { now: NOW }, extra = {}) {
  return createDnsUsage({ token: "t", zoneName: "Example.dev", fetchJson: api.fetchJson, now: () => clock.now, ...extra });
}

test("reports record usage, quota, and the zone's dashboard link", async () => {
  const api = cloudflare();
  const result = await usage(api).get();
  assert.deepEqual(result, {
    zone: "example.dev", records: 132, quota: 200,
    dashboardUrl: "https://dash.cloudflare.com/acct-1/example.dev/dns/records",
    state: "live", checkedAt: "2026-11-27T00:00:00.000Z", detail: null,
  });
  assert.equal(api.calls[0].headers.authorization, "Bearer t");
  assert.match(api.calls[0].url, /\/zones\?name=example\.dev$/);
});

test("caches within the TTL and looks the zone up once", async () => {
  const api = cloudflare();
  const clock = { now: NOW };
  const reader = usage(api, clock);
  await reader.get();
  clock.now += 5 * 60 * 1000;
  await reader.get();
  assert.equal(api.calls.length, 2);
  clock.now += 6 * 60 * 1000;
  api.state.usage = 133;
  assert.equal((await reader.get()).records, 133);
  assert.equal(api.calls.length, 3);
});

test("shares one request between concurrent callers", async () => {
  const api = cloudflare();
  const reader = usage(api);
  const [a, b] = await Promise.all([reader.get(), reader.get()]);
  assert.equal(a.records, 132);
  assert.equal(b.records, 132);
  assert.equal(api.calls.length, 2);
});

test("keeps the last reading as stale when a refresh fails, then backs off", async () => {
  const api = cloudflare();
  const clock = { now: NOW };
  const reader = usage(api, clock);
  await reader.get();
  clock.now += 11 * 60 * 1000;
  api.state.fail = true;
  const stale = await reader.get();
  assert.equal(stale.state, "stale");
  assert.equal(stale.records, 132);
  assert.equal(stale.detail, "offline");
  const before = api.calls.length;
  clock.now += 30 * 1000;
  await reader.get();
  assert.equal(api.calls.length, before, "no retry inside the back-off window");
  api.state.fail = false;
  clock.now += 31 * 1000;
  assert.equal((await reader.get()).state, "live");
});

test("is unavailable when the first read fails", async () => {
  const api = cloudflare();
  api.state.fail = true;
  const result = await usage(api).get();
  assert.equal(result.state, "unavailable");
  assert.equal(result.records, null);
  assert.equal(result.detail, "offline");
});

test("reports Cloudflare API errors and an invisible zone", async () => {
  const hidden = await usage(cloudflare({ zones: [] })).get();
  assert.equal(hidden.state, "unavailable");
  assert.match(hidden.detail, /zone example\.dev not visible/);

  const api = cloudflare({ zones: [{ id: "other", name: "example.dev" }] });
  const failed = await usage(api).get();
  assert.equal(failed.state, "unavailable");
  assert.match(failed.detail, /cloudflare 7003 No route/);
});

test("rejects a malformed usage payload and tolerates a missing quota", async () => {
  const broken = await usage(cloudflare({ usage: "lots" })).get();
  assert.equal(broken.state, "unavailable");
  assert.match(broken.detail, /record_usage/);

  const noQuota = await usage(cloudflare({ quota: 0 })).get();
  assert.equal(noQuota.state, "live");
  assert.equal(noQuota.quota, null);
});

test("is unconfigured without a token and never calls Cloudflare", async () => {
  const api = cloudflare();
  const reader = createDnsUsage({ token: " ", zoneName: "example.dev", fetchJson: api.fetchJson });
  assert.equal(reader.configured, false);
  assert.equal((await reader.get(true)).state, "unconfigured");
  assert.equal(api.calls.length, 0);
});
