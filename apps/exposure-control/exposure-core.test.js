const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createExposureCore } = require("./exposure-core.js");

function fixture(overrides = {}) {
  let clock = Date.parse("2026-11-02T00:00:00Z");
  const saved = [];
  const audit = [];
  const core = createExposureCore({
    services: [{ id: "books", name: "Books", target: "http://books" },
      { id: "photos", target: "http://photos", authMode: "none" }],
    initialState: { extra: "preserved", exposures: {} },
    saveState: (state) => saved.push(structuredClone(state)),
    appendAuditEntry: (entry) => audit.push(entry),
    publicHost: (service) => "share-" + service.id + ".example.test",
    now: () => clock,
    ...overrides,
  });
  return { core, saved, audit, advance: (ms) => { clock += ms; } };
}

test("defaults, overrides, snapshots and persisted state use one auth and expiry policy", () => {
  const { core, saved, audit } = fixture();
  assert.equal(core.get("books").enabled, false);
  assert.equal(core.get("books").authMode, "cloudflare-access");
  assert.equal(core.get("photos").defaultAuthMode, "none");
  const book = core.enable("books");
  assert.equal(book.expiresAt, "2026-11-02T01:00:00.000Z");
  assert.equal(book.publicUrl, "https://share-books.example.test");
  assert.equal(book.authMode, "cloudflare-access");
  core.enable("photos", { hours: null, authMode: "cloudflare-access" });
  assert.equal(core.get("photos").expiresAt, null);
  assert.equal(core.activeCount(), 2);
  assert.equal(saved.at(-1).extra, "preserved");
  assert.deepEqual(audit, [
    { action: "enable", serviceId: "books", hours: 1, authMode: "cloudflare-access" },
    { action: "enable", serviceId: "photos", expiryMode: "until-disabled", authMode: "cloudflare-access" },
  ]);
  core.disable("photos");
  assert.equal(core.get("photos").authMode, "cloudflare-access");
  assert.equal(core.get("photos").enabled, false);
  assert.equal(core.get("photos").expiresAt, null);
});

test("snapshots mark agent hosts and default everything else to shares", () => {
  const { core } = fixture({
    services: [{ id: "books", target: "http://books" },
      { id: "budget", target: "http://budget", kind: "agent" },
      { id: "odd", target: "http://odd", kind: "typo" }],
  });
  assert.deepEqual(core.list().map((service) => [service.id, service.kind]),
    [["books", "share"], ["budget", "agent"], ["odd", "share"]]);
});

test("expiry denies immediately, reconciles once, and preserves unbounded shares", () => {
  const { core, advance, audit } = fixture();
  core.enable("books", { hours: 0.25 });
  core.enable("photos", { hours: null });
  advance(15 * 60 * 1000);
  assert.equal(core.get("books").enabled, false);
  assert.equal(core.get("books").desiredEnabled, true);
  assert.equal(core.activeCount(), 1);
  assert.equal(core.expire(), 1);
  assert.equal(core.expire(), 0);
  assert.equal(core.get("books").expiresAt, null);
  assert.equal(core.get("books").desiredEnabled, false);
  assert.equal(core.get("photos").enabled, true);
  assert.deepEqual(audit.at(-1), { action: "auto-expire", serviceId: "books" });
});

test("startup expiry fails closed for malformed dates and retains unrelated state", () => {
  const { core, audit, saved } = fixture({ initialState: { extra: 42, exposures: {
    books: { enabled: true, expiresAt: "broken", authMode: "none" },
    photos: { enabled: true, expiresAt: null, authMode: "cloudflare-access" },
  } } });
  assert.equal(core.get("books").enabled, false);
  assert.equal(core.expire("startup"), 1);
  assert.deepEqual(audit, [{ action: "auto-expire", serviceId: "books", trigger: "startup" }]);
  assert.equal(core.get("books").authMode, "none");
  assert.equal(core.get("photos").enabled, true);
  assert.equal(saved[0].extra, 42);
});

test("invalid enables and unknown ids cannot mutate or audit state", () => {
  const { core, saved, audit } = fixture();
  for (const options of [null, [], { hours: 0 }, { hours: 25 }, { hours: 0.3 },
    { hours: "1" }, { hours: NaN }, { authMode: "typo" }, { authMode: null }]) {
    assert.throws(() => core.enable("books", options), { status: 400 });
  }
  for (const action of [() => core.get("missing"), () => core.enable("missing"), () => core.disable("missing")]) {
    assert.throws(action, { status: 404 });
  }
  assert.deepEqual(saved, []);
  assert.deepEqual(audit, []);
});

test("a failed persistence operation never publishes an enabled share", () => {
  const { core, audit } = fixture({ saveState: () => { throw new Error("disk full"); } });
  assert.throws(() => core.enable("books"), /disk full/);
  assert.equal(core.get("books").enabled, false);
  assert.deepEqual(audit, []);
});

test("disable all counts desired shares and preserves per-share auth", () => {
  const { core, advance, audit } = fixture();
  core.enable("books", { hours: 0.25, authMode: "none" });
  core.enable("photos", { hours: null });
  advance(3600000);
  const result = core.disableAll();
  assert.equal(result.disabled, 2);
  assert.ok(result.services.every((service) => !service.enabled && !service.desiredEnabled && service.expiresAt === null));
  assert.equal(core.get("books").authMode, "none");
  assert.deepEqual(audit.at(-1), { action: "emergency-disable-all", disabled: 2 });
  assert.equal(core.disableAll().disabled, 0);
});

test("updates extend, reset, or re-auth a live share and keep its opening time", () => {
  const { core, audit, advance } = fixture();
  const opened = core.enable("books", { hours: 1, authMode: "none" });
  assert.equal(opened.openedAt, "2026-11-02T00:00:00.000Z");
  advance(40 * 60 * 1000);
  const extended = core.update("books", { extendHours: 1 });
  assert.equal(extended.expiresAt, "2026-11-02T02:00:00.000Z");
  assert.equal(extended.authMode, "none");
  assert.equal(extended.openedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(extended.updatedAt, "2026-11-02T00:40:00.000Z");
  const reauthed = core.update("books", { authMode: "cloudflare-access" });
  assert.equal(reauthed.expiresAt, "2026-11-02T02:00:00.000Z");
  assert.equal(reauthed.authMode, "cloudflare-access");
  assert.equal(core.update("books", { hours: null }).expiresAt, null);
  assert.equal(core.update("books", { hours: 0.25 }).expiresAt, "2026-11-02T00:55:00.000Z");
  assert.deepEqual(audit.slice(1), [
    { action: "update", serviceId: "books", extendHours: 1, expiresAt: "2026-11-02T02:00:00.000Z" },
    { action: "update", serviceId: "books", authMode: "cloudflare-access", expiresAt: "2026-11-02T02:00:00.000Z" },
    { action: "update", serviceId: "books", expiryMode: "until-disabled", expiresAt: null },
    { action: "update", serviceId: "books", hours: 0.25, expiresAt: "2026-11-02T00:55:00.000Z" },
  ]);
  advance(15 * 60 * 1000);
  assert.equal(core.get("books").enabled, false);
  assert.equal(core.get("books").openedAt, null);
});

test("updates never reopen a closed or expired share and reject unclear requests", () => {
  const { core, audit, saved, advance } = fixture();
  assert.throws(() => core.update("books", { extendHours: 1 }), { status: 409 });
  core.enable("books", { hours: 0.25 });
  core.enable("photos", { hours: null });
  for (const options of [null, [], {}, { hours: 1, extendHours: 1 }, { extendHours: 0.1 }, { extendHours: 25 },
    { extendHours: null }, { hours: 0 }, { authMode: "open" }]) {
    assert.throws(() => core.update("books", options), { status: 400 });
  }
  assert.throws(() => core.update("photos", { extendHours: 1 }), { status: 409 });
  assert.throws(() => core.update("missing", { extendHours: 1 }), { status: 404 });
  advance(15 * 60 * 1000);
  assert.throws(() => core.update("books", { extendHours: 1 }), { status: 409 });
  assert.equal(core.get("books").enabled, false);
  core.disable("photos");
  assert.throws(() => core.update("photos", { hours: 1 }), { status: 409 });
  assert.equal(audit.filter((entry) => entry.action === "update").length, 0);
  assert.equal(saved.length, 3);
});
