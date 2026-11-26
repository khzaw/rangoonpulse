// Verifies Cloudflare Access application tokens (Cf-Access-Jwt-Assertion).
// Keys come from the team's published certs endpoint; nothing in the token
// chooses the issuer or the key source.
const crypto = require("node:crypto");

class AccessTokenError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

// Accepts "team.cloudflareaccess.com" or a full origin URL. A non-https
// origin is accepted only so tests can serve certs locally.
function normalizeTeamDomain(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  const origin = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : "https://" + raw).origin;
  if (origin === "null") throw new Error("invalid Cloudflare Access team domain: " + raw);
  return origin;
}

function decodeSegment(segment, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new AccessTokenError("malformed token " + label);
  return Buffer.from(segment, "base64url");
}

function parseJsonSegment(segment, label) {
  try {
    const value = JSON.parse(decodeSegment(segment, label).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
  }
  throw new AccessTokenError("malformed token " + label);
}

// Node's connection errors can carry an empty message (AggregateError from
// address fallback), so fall back to codes for logs and 503 reasons.
function describeError(error) {
  if (!error) return "unknown error";
  const inner = Array.isArray(error.errors)
    ? [...new Set(error.errors.map((item) => item?.code || item?.message).filter(Boolean))].join(",")
    : "";
  return error.message || error.code || inner || error.name || String(error);
}

function createAccessVerifier({
  teamDomain, fetchJson, now = Date.now,
  clockSkewSeconds = 60, refreshCooldownMs = 30_000, failureBackoffMs = 2_000,
  maxKeyAgeMs = 60 * 60 * 1000, fetchAttempts = 3, retryDelayMs = 300,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const issuer = normalizeTeamDomain(teamDomain);
  if (!issuer) throw new Error("Cloudflare Access team domain is required");
  const certsUrl = issuer + "/cdn-cgi/access/certs";
  let keys = new Map();
  let fetchedAt = 0;
  let attemptedAt = 0;
  let inflight = null;
  let lastFailure = null;

  function importKeys(body) {
    const next = new Map();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (jwk?.kty !== "RSA" || typeof jwk.kid !== "string" || !jwk.kid) continue;
      if (jwk.use && jwk.use !== "sig") continue;
      try {
        next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
      } catch {}
    }
    if (!next.size) throw new Error("no usable RSA signing keys at " + certsUrl);
    return next;
  }

  async function fetchKeys() {
    let lastError = null;
    for (let attempt = 1; attempt <= fetchAttempts; attempt += 1) {
      try {
        return importKeys(await fetchJson(certsUrl));
      } catch (error) {
        lastError = error;
        if (attempt < fetchAttempts) await sleep(retryDelayMs * attempt);
      }
    }
    throw lastError;
  }

  function refresh() {
    if (!inflight) {
      attemptedAt = now();
      inflight = fetchKeys()
        .then((next) => {
          keys = next;
          fetchedAt = now();
          lastFailure = null;
        })
        .catch((error) => {
          lastFailure = error;
          throw error;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  async function keyFor(kid) {
    const needsRefresh = !keys.size || !keys.has(kid) || now() - fetchedAt > maxKeyAgeMs;
    // Refreshes are rate limited so forged key ids or an unreachable certs
    // endpoint cannot turn every request into a fetch. Without any keys the
    // wait is short: every request fails until a fetch succeeds.
    const wait = keys.size ? refreshCooldownMs : failureBackoffMs;
    if (needsRefresh && (inflight || now() - attemptedAt >= wait)) {
      try {
        await refresh();
      } catch {}
    }
    if (!keys.size) {
      const reason = lastFailure ? ": " + describeError(lastFailure) : "";
      throw new AccessTokenError("cloudflare access keys unavailable" + reason, 503);
    }
    const key = keys.get(kid);
    if (!key) throw new AccessTokenError("unknown token signing key");
    return key;
  }

  async function verify(token, { audience } = {}) {
    const parts = String(token || "").trim().split(".");
    if (parts.length !== 3) throw new AccessTokenError("malformed token");
    const [headerSegment, payloadSegment, signatureSegment] = parts;
    const header = parseJsonSegment(headerSegment, "header");
    if (header.alg !== "RS256") throw new AccessTokenError("unsupported token algorithm");
    if (typeof header.kid !== "string" || !header.kid) throw new AccessTokenError("token key id missing");
    const claims = parseJsonSegment(payloadSegment, "payload");
    const signature = decodeSegment(signatureSegment, "signature");
    const key = await keyFor(header.kid);
    const signed = Buffer.from(headerSegment + "." + payloadSegment, "ascii");
    if (!crypto.verify("RSA-SHA256", signed, key, signature)) {
      throw new AccessTokenError("invalid token signature");
    }
    if (claims.iss !== issuer) throw new AccessTokenError("unexpected token issuer");
    const nowSeconds = now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp + clockSkewSeconds <= nowSeconds) {
      throw new AccessTokenError("token expired");
    }
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - clockSkewSeconds > nowSeconds)) {
      throw new AccessTokenError("token not yet valid");
    }
    if (audience) {
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(audience)) throw new AccessTokenError("unexpected token audience");
    }
    return claims;
  }

  // Loads keys ahead of the first request; failures are left for the
  // request path to retry.
  async function warm() {
    try {
      await refresh();
      return null;
    } catch (error) {
      return describeError(error);
    }
  }

  return { issuer, certsUrl, verify, warm };
}

module.exports = { createAccessVerifier, normalizeTeamDomain, describeError, AccessTokenError };
