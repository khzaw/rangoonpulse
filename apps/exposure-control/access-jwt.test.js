const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { createAccessVerifier, normalizeTeamDomain, describeError, AccessTokenError } = require("./access-jwt.js");

const TEAM = "https://team.cloudflareaccess.com";
const NOW = Date.parse("2026-11-26T00:00:00Z");

function keyPair(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

const primary = keyPair("primary");
const rotated = keyPair("rotated");
const outsider = keyPair("primary");

function sign(claims, { key = primary, header = {} } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = encode({ alg: "RS256", kid: key.kid, typ: "JWT", ...header }) + "." + encode(claims);
  return body + "." + crypto.sign("RSA-SHA256", Buffer.from(body), key.privateKey).toString("base64url");
}

function claims(overrides = {}) {
  const seconds = Math.floor(NOW / 1000);
  return { aud: ["agent-aud"], iss: TEAM, iat: seconds - 10, nbf: seconds - 10, exp: seconds + 600, type: "app", ...overrides };
}

function verifier({ keys = [primary], clock = { now: NOW }, fail = false, failures = 0 } = {}) {
  const calls = [];
  const state = { fail, failures };
  const instance = createAccessVerifier({
    teamDomain: "team.cloudflareaccess.com",
    now: () => clock.now,
    sleep: async () => {},
    fetchJson: async (url) => {
      calls.push(url);
      if (state.fail) throw new Error("offline");
      if (state.failures > 0) {
        state.failures -= 1;
        throw Object.assign(new AggregateError([{ code: "ETIMEDOUT" }, { code: "ENETUNREACH" }], ""), { code: undefined });
      }
      return { keys: keys.map((key) => key.jwk), public_cert: { kid: "ignored", cert: "-----BEGIN CERTIFICATE-----" } };
    },
  });
  return { instance, calls, clock, state };
}

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AccessTokenError);
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

test("team domains normalize to an issuer origin and an empty value stays unset", () => {
  assert.equal(normalizeTeamDomain("team.cloudflareaccess.com"), TEAM);
  assert.equal(normalizeTeamDomain("https://team.cloudflareaccess.com/"), TEAM);
  assert.equal(normalizeTeamDomain("http://127.0.0.1:9000"), "http://127.0.0.1:9000");
  assert.equal(normalizeTeamDomain("  "), null);
  assert.throws(() => createAccessVerifier({ teamDomain: "", fetchJson: async () => ({}) }));
});

test("a token signed by the team key with the expected issuer and audience verifies", async () => {
  const { instance, calls } = verifier();
  assert.equal(instance.certsUrl, TEAM + "/cdn-cgi/access/certs");
  const verified = await instance.verify(sign(claims({ common_name: "client.access" })), { audience: "agent-aud" });
  assert.equal(verified.common_name, "client.access");
  assert.equal((await instance.verify(sign(claims({ aud: "agent-aud" })), { audience: "agent-aud" })).aud, "agent-aud");
  assert.ok(await instance.verify(sign(claims({ aud: ["another-app"] }))));
  assert.deepEqual(calls, [TEAM + "/cdn-cgi/access/certs"]);
});

test("forged, foreign, expired and misaddressed tokens are rejected", async () => {
  const { instance } = verifier();
  const seconds = Math.floor(NOW / 1000);
  await rejects(instance.verify("test-assertion"), 403, /malformed/);
  await rejects(instance.verify("a.b"), 403, /malformed/);
  await rejects(instance.verify(sign(claims()).replace(/\.[^.]+$/, ".!!")), 403, /malformed token signature/);
  await rejects(instance.verify(sign(claims(), { header: { alg: "none" } })), 403, /algorithm/);
  await rejects(instance.verify(sign(claims(), { header: { alg: "HS256" } })), 403, /algorithm/);
  await rejects(instance.verify(sign(claims(), { header: { kid: "" } })), 403, /key id/);
  await rejects(instance.verify(sign(claims(), { key: outsider })), 403, /signature/);
  const valid = sign(claims());
  const [header, , signature] = valid.split(".");
  const tampered = header + "." + Buffer.from(JSON.stringify(claims({ aud: ["x"] }))).toString("base64url") + "." + signature;
  await rejects(instance.verify(tampered), 403, /signature/);
  await rejects(instance.verify(sign(claims({ iss: "https://attacker.cloudflareaccess.com" }))), 403, /issuer/);
  await rejects(instance.verify(sign(claims({ exp: seconds - 120 }))), 403, /expired/);
  await rejects(instance.verify(sign(claims({ exp: undefined }))), 403, /expired/);
  await rejects(instance.verify(sign(claims({ nbf: seconds + 120 }))), 403, /not yet valid/);
  await rejects(instance.verify(sign(claims({ aud: ["share-app"] })), { audience: "agent-aud" }), 403, /audience/);
  assert.ok(await instance.verify(sign(claims({ exp: seconds - 30 }))), "clock skew tolerance");
});

test("unknown key ids refresh at most once per cooldown", async () => {
  const { instance, calls, clock } = verifier();
  await instance.verify(sign(claims()));
  const forged = () => sign(claims({ exp: Math.floor(clock.now / 1000) + 600 }), { key: keyPair("forged") });
  await rejects(instance.verify(forged()), 403, /unknown/);
  assert.equal(calls.length, 1, "no refetch right after the initial fetch");
  clock.now += 31_000;
  await rejects(instance.verify(forged()), 403, /unknown/);
  assert.equal(calls.length, 2);
  await rejects(instance.verify(forged()), 403, /unknown/);
  assert.equal(calls.length, 2, "cooldown suppresses another fetch");
});

test("rotated keys published since the last fetch verify after the cooldown", async () => {
  const keys = [primary];
  const { instance, calls, clock } = verifier({ keys });
  await instance.verify(sign(claims()));
  keys.splice(0, 1, rotated);
  clock.now += 31_000;
  const fresh = claims({ exp: Math.floor(clock.now / 1000) + 600 });
  assert.ok(await instance.verify(sign(fresh, { key: rotated })));
  await rejects(instance.verify(sign(fresh)), 403, /unknown/);
  assert.equal(calls.length, 2);
});

test("unreachable certs fail closed with 503 and retry after a short backoff", async () => {
  const { instance, calls, clock, state } = verifier({ fail: true });
  await rejects(instance.verify(sign(claims())), 503, /unavailable: offline$/);
  assert.equal(calls.length, 3, "one refresh makes three attempts");
  await rejects(instance.verify(sign(claims())), 503, /unavailable: offline$/);
  assert.equal(calls.length, 3, "requests inside the backoff do not refetch");
  state.fail = false;
  clock.now += 2_001;
  assert.ok(await instance.verify(sign(claims())));
  assert.equal(calls.length, 4);
});

test("a transient fetch failure is retried within the same request", async () => {
  const { instance, calls } = verifier({ failures: 1 });
  assert.ok(await instance.verify(sign(claims())));
  assert.equal(calls.length, 2);
});

test("connection errors without a message are described by their codes", async () => {
  assert.equal(describeError(new AggregateError([{ code: "ETIMEDOUT" }, { code: "ETIMEDOUT" }, { code: "ENETUNREACH" }], "")), "ETIMEDOUT,ENETUNREACH");
  assert.equal(describeError(Object.assign(new Error(""), { code: "ECONNRESET" })), "ECONNRESET");
  const { instance } = verifier({ failures: 3 });
  await rejects(instance.verify(sign(claims())), 503, /unavailable: ETIMEDOUT,ENETUNREACH$/);
});

test("warming loads keys before the first request and reports failures", async () => {
  const { instance, calls } = verifier();
  assert.equal(await instance.warm(), null);
  assert.ok(await instance.verify(sign(claims())));
  assert.equal(calls.length, 1);
  const failing = verifier({ fail: true });
  assert.equal(await failing.instance.warm(), "offline");
});

test("cached keys keep verifying when a scheduled refresh fails", async () => {
  const state = { fail: false };
  const clock = { now: NOW };
  let calls = 0;
  const instance = createAccessVerifier({
    teamDomain: TEAM, now: () => clock.now, sleep: async () => {},
    fetchJson: async () => {
      calls += 1;
      if (state.fail) throw new Error("offline");
      return { keys: [primary.jwk] };
    },
  });
  await instance.verify(sign(claims()));
  state.fail = true;
  clock.now += 2 * 60 * 60 * 1000;
  assert.ok(await instance.verify(sign(claims({ exp: Math.floor(clock.now / 1000) + 600 }))));
  assert.equal(calls, 4, "initial fetch plus three failed refresh attempts");
});

test("a certs response without usable RSA keys is treated as unavailable", async () => {
  const instance = createAccessVerifier({
    teamDomain: TEAM, now: () => NOW, sleep: async () => {},
    fetchJson: async () => ({ keys: [{ kty: "EC", kid: "ec" }, { kty: "RSA", kid: "bad", n: "x", e: "AQAB", use: "enc" }] }),
  });
  await rejects(instance.verify(sign(claims())), 503, /no usable RSA signing keys/);
});
