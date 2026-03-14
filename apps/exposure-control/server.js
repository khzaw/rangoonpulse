const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || "8080");
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");
const SERVICES_FILE = process.env.SERVICES_FILE || "/app/services.json";
const PUBLIC_DOMAIN = (process.env.PUBLIC_DOMAIN || "khzaw.dev").toLowerCase();
const SHARE_HOST_PREFIX = (
  process.env.SHARE_HOST_PREFIX || "share-"
).toLowerCase();
const CONTROL_PANEL_HOST = (
  process.env.CONTROL_PANEL_HOST || "controlpanel.khzaw.dev"
).toLowerCase();
const DEFAULT_EXPIRY_HOURS = Number(process.env.DEFAULT_EXPIRY_HOURS || "1");
const RECONCILE_INTERVAL_SECONDS = Number(
  process.env.RECONCILE_INTERVAL_SECONDS || "30",
);
const DEFAULT_AUTH_MODE =
  normalizeAuthMode(process.env.DEFAULT_AUTH_MODE) || "cloudflare-access";
const SHARE_RATE_LIMIT_REQUESTS = clampInt(
  process.env.SHARE_RATE_LIMIT_REQUESTS,
  120,
  30,
  2000,
);
const SHARE_RATE_LIMIT_WINDOW_SECONDS = clampInt(
  process.env.SHARE_RATE_LIMIT_WINDOW_SECONDS,
  60,
  10,
  3600,
);
const IMAGE_UPDATES_CACHE_FILE = path.join(DATA_DIR, "image-updates-cache.json");
const IMAGE_UPDATE_CACHE_TTL_HOURS = clampInt(
  process.env.IMAGE_UPDATE_CACHE_TTL_HOURS,
  168,
  24,
  24 * 30,
);
const IMAGE_UPDATE_HTTP_TIMEOUT_MS = clampInt(
  process.env.IMAGE_UPDATE_HTTP_TIMEOUT_MS,
  6000,
  2000,
  15000,
);
const IMAGE_UPDATE_NAMESPACES = String(
  process.env.IMAGE_UPDATE_NAMESPACES ||
    "default,monitoring,tailscale,public-edge",
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const IMAGE_UPDATE_CONCURRENCY = clampInt(
  process.env.IMAGE_UPDATE_CONCURRENCY,
  6,
  1,
  20,
);
const IMAGE_UPDATE_MAX_WORKLOADS = clampInt(
  process.env.IMAGE_UPDATE_MAX_WORKLOADS,
  120,
  10,
  500,
);
const IMAGE_UPDATE_EXCLUDED_WORKLOADS = new Set(
  String(process.env.IMAGE_UPDATE_EXCLUDED_WORKLOADS || "blog,mmcal")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);
const KUBE_SERVICE_HOST = process.env.KUBERNETES_SERVICE_HOST || "";
const KUBE_SERVICE_PORT = process.env.KUBERNETES_SERVICE_PORT_HTTPS || "443";
const KUBE_TOKEN_FILE =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const KUBE_CA_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const TRANSMISSION_VPN_NAMESPACE =
  process.env.TRANSMISSION_VPN_NAMESPACE || "default";
const TRANSMISSION_VPN_CONTROL_CONFIGMAP =
  process.env.TRANSMISSION_VPN_CONTROL_CONFIGMAP || "transmission-vpn-control";
const TRANSMISSION_VPN_RUNTIME_CONFIGMAP_FALLBACK =
  process.env.TRANSMISSION_VPN_RUNTIME_CONFIGMAP || "transmission-vpn-state";
const TRANSMISSION_VPN_WEBUI_URL =
  process.env.TRANSMISSION_VPN_WEBUI_URL || "https://torrent-vpn.khzaw.dev";
const RESOURCE_ADVISOR_UI_URL =
  process.env.RESOURCE_ADVISOR_UI_URL ||
  "http://resource-advisor-exporter.monitoring.svc.cluster.local:8081/api/ui.json";

const metrics = {
  enableTotal: 0,
  disableTotal: 0,
  emergencyDisableTotal: 0,
  expiredDisableTotal: 0,
  shareAllowedTotal: 0,
  shareDeniedDisabledTotal: 0,
  shareDeniedAuthTotal: 0,
  shareDeniedRateLimitedTotal: 0,
  reconcileErrorsTotal: 0,
  lastReconcileTimestampSeconds: Math.floor(Date.now() / 1000),
};

const rateLimits = new Map();
const kubePodsCache = new Map();
const kubeNodePlatformCache = new Map();
const registryTagCache = new Map();
const registryManifestCache = new Map();
let imageUpdateRefreshPromise = null;
const MOVING_TAG_FAMILY_TOKENS = new Set(["ls", "r", "rev", "build"]);

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

function normalizeAuthMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "none" || mode === "cloudflare-access") return mode;
  return null;
}

function normalizeTransmissionVpnMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "direct" || mode === "vpn") return mode;
  return null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function clampHours(value) {
  if (!Number.isFinite(value)) return DEFAULT_EXPIRY_HOURS;
  if (value < 0.25) return 0.25;
  if (value > 24) return 24;
  return Math.round(value * 4) / 4;
}

function loadServices() {
  const raw = fs.readFileSync(SERVICES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("services.json must be an array");
  for (const svc of parsed) {
    if (!svc.id || !svc.target)
      throw new Error("each service requires id and target");
    const authMode = normalizeAuthMode(svc.authMode);
    if (svc.authMode && !authMode) {
      throw new Error(
        `invalid authMode for service ${svc.id}: ${svc.authMode}`,
      );
    }
  }
  return parsed;
}

function defaultState(services) {
  const exposures = {};
  for (const svc of services) {
    exposures[svc.id] = {
      enabled: false,
      expiresAt: null,
      updatedAt: nowIso(),
    };
  }
  return { exposures };
}

function loadState(services) {
  ensureDataDir();
  const knownIds = new Set(services.map((svc) => svc.id));
  if (!fs.existsSync(STATE_FILE)) {
    const fresh = defaultState(services);
    fs.writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2));
    console.log("state: created fresh (no prior state file)");
    return fresh;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
      throw new Error("state root must be object");
    if (!parsed.exposures || typeof parsed.exposures !== "object")
      parsed.exposures = {};
    // Add missing services
    for (const svc of services) {
      if (!parsed.exposures[svc.id]) {
        parsed.exposures[svc.id] = {
          enabled: false,
          expiresAt: null,
          updatedAt: nowIso(),
        };
      }
    }
    // Remove stale services no longer in services.json
    for (const id of Object.keys(parsed.exposures)) {
      if (!knownIds.has(id)) {
        console.log(`state: pruning stale service entry "${id}"`);
        delete parsed.exposures[id];
      }
    }
    return parsed;
  } catch (err) {
    console.error("failed to read state file, rebuilding:", err.message);
    const fresh = defaultState(services);
    fs.writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendAuditEntry(entry) {
  fs.appendFileSync(
    AUDIT_FILE,
    JSON.stringify({ ...entry, ts: nowIso() }) + "\n",
  );
}

function loadAuditEntries(limit) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs
    .readFileSync(AUDIT_FILE, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {}
  }
  return entries;
}

function isExpired(exposure) {
  if (!exposure || !exposure.enabled) return false;
  if (!exposure.expiresAt) return false;
  const ts = Date.parse(exposure.expiresAt);
  if (Number.isNaN(ts)) return true;
  return ts <= Date.now();
}

function effectiveEnabled(exposure) {
  return Boolean(exposure && exposure.enabled && !isExpired(exposure));
}

function servicePublicHost(service) {
  return `${SHARE_HOST_PREFIX}${service.id}.${PUBLIC_DOMAIN}`;
}

function serviceDefaultAuthMode(service) {
  return normalizeAuthMode(service.authMode) || DEFAULT_AUTH_MODE;
}

function exposureAuthMode(service, exposure) {
  return (
    normalizeAuthMode(exposure && exposure.authMode) ||
    serviceDefaultAuthMode(service)
  );
}

function getHost(req) {
  const raw = req.headers.host || "";
  return String(raw).split(":")[0].toLowerCase();
}

function getClientIp(req) {
  const cfIp = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cfIp) return cfIp;
  const xff = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xff) return xff;
  return String(req.socket.remoteAddress || "unknown");
}

function checkShareRateLimit(req, serviceId) {
  const now = Date.now();
  const key = `${serviceId}:${getClientIp(req)}`;
  const windowMs = SHARE_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const existing = rateLimits.get(key);

  if (!existing || now - existing.startMs >= windowMs) {
    rateLimits.set(key, { startMs: now, count: 1 });
    return true;
  }

  if (existing.count >= SHARE_RATE_LIMIT_REQUESTS) {
    return false;
  }

  existing.count += 1;
  return true;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function parseImageReference(image) {
  const raw = String(image || "").trim();
  if (!raw) return null;
  let withoutDigest = raw;
  const digestIndex = withoutDigest.indexOf("@");
  if (digestIndex >= 0) withoutDigest = withoutDigest.slice(0, digestIndex);
  if (!withoutDigest) return null;

  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  let tag = "latest";
  let imagePath = withoutDigest;
  if (lastColon > lastSlash) {
    tag = withoutDigest.slice(lastColon + 1);
    imagePath = withoutDigest.slice(0, lastColon);
  }

  const first = imagePath.split("/")[0] || "";
  const hasExplicitRegistry =
    first.includes(".") || first.includes(":") || first === "localhost";
  let registry = hasExplicitRegistry ? first : "docker.io";
  let repository = hasExplicitRegistry
    ? imagePath.slice(first.length + 1)
    : imagePath;
  if (!repository) return null;
  if ((registry === "docker.io" || registry === "index.docker.io") && !repository.includes("/")) {
    repository = `library/${repository}`;
  }
  if (registry === "index.docker.io") registry = "docker.io";
  return { raw, registry, repository, tag };
}

function parseSemverTag(tag) {
  const s = String(tag || "").trim();
  const m = s.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!m) return null;
  return {
    raw: s,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || "",
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function isHashLikeTag(tag) {
  const s = String(tag || "").trim().toLowerCase();
  return (
    /^sha[-_][0-9a-f]{7,}$/.test(s) ||
    /^\d{9,}-[0-9a-f]{7,}$/.test(s) ||
    /^[0-9a-f]{12,}$/.test(s)
  );
}

function parseComparableTag(tag) {
  const raw = String(tag || "").trim();
  if (!raw || isHashLikeTag(raw)) return null;
  const parts = raw.match(/[A-Za-z]+|\d+/g);
  if (!parts || parts.length === 0) return null;

  let sawString = false;
  let previousString = "";
  let hasVariableNumber = false;
  const tokens = parts.map((part) => {
    if (/^\d+$/.test(part)) {
      const variable =
        !sawString || MOVING_TAG_FAMILY_TOKENS.has(previousString);
      if (variable) hasVariableNumber = true;
      return {
        type: "num",
        value: Number(part),
        raw: part,
        variable,
      };
    }

    sawString = true;
    previousString = part.toLowerCase();
    return {
      type: "str",
      value: previousString,
      raw: part,
      variable: false,
    };
  });

  if (!hasVariableNumber) return null;
  return { raw, tokens };
}

function sameComparableTagFamily(current, candidate) {
  if (!current || !candidate) return false;
  if (current.tokens.length !== candidate.tokens.length) return false;

  for (let i = 0; i < current.tokens.length; i++) {
    const base = current.tokens[i];
    const next = candidate.tokens[i];
    if (base.type !== next.type) return false;
    if (base.type === "str") {
      if (base.value !== next.value) return false;
      continue;
    }
    if (!base.variable && base.value !== next.value) return false;
  }

  return true;
}

function compareComparableTags(a, b) {
  if (!a || !b) return 0;
  const length = Math.min(a.tokens.length, b.tokens.length);
  for (let i = 0; i < length; i++) {
    const left = a.tokens[i];
    const right = b.tokens[i];
    if (left.type !== right.type) return 0;
    if (left.type === "str") {
      const diff = left.value.localeCompare(right.value);
      if (diff !== 0) return diff;
      continue;
    }
    if (left.value !== right.value) return left.value - right.value;
  }
  return a.raw.localeCompare(b.raw);
}

function extractImageDigest(imageId) {
  const m = String(imageId || "").match(/(sha256:[0-9a-f]{64})/i);
  return m ? m[1].toLowerCase() : "";
}

function shortDigest(digest) {
  const value = String(digest || "");
  if (!value) return "";
  return value.length <= 19 ? value : `${value.slice(0, 19)}...`;
}

function contentTypeBase(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function isManifestListContentType(value) {
  const contentType = contentTypeBase(value);
  return (
    contentType === "application/vnd.oci.image.index.v1+json" ||
    contentType === "application/vnd.docker.distribution.manifest.list.v2+json"
  );
}

function selectManifestForPlatform(manifests, platform) {
  if (!Array.isArray(manifests) || manifests.length === 0) return null;
  const targetOs = String((platform && platform.os) || "linux").toLowerCase();
  const targetArch = String(
    (platform && platform.architecture) || "",
  ).toLowerCase();

  if (targetArch) {
    for (const manifest of manifests) {
      const itemPlatform = manifest && manifest.platform;
      if (!itemPlatform) continue;
      if (
        String(itemPlatform.os || "").toLowerCase() === targetOs &&
        String(itemPlatform.architecture || "").toLowerCase() === targetArch
      ) {
        return manifest;
      }
    }
  }

  return manifests[0];
}

function parseWwwAuthenticate(header) {
  const value = String(header || "");
  const space = value.indexOf(" ");
  if (space <= 0) return null;
  const scheme = value.slice(0, space).toLowerCase();
  const rest = value.slice(space + 1);
  const params = {};
  const re = /([a-zA-Z]+)="([^"]*)"/g;
  let match = null;
  while ((match = re.exec(rest))) {
    params[match[1].toLowerCase()] = match[2];
  }
  return { scheme, params };
}

function nextLinkUrl(linkHeader, baseUrl) {
  const m = String(linkHeader || "").match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function requestHttps(urlString, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: opts.method || "GET",
        headers: opts.headers || {},
        ca: opts.ca,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(opts.timeoutMs || IMAGE_UPDATE_HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function requestUrl(urlString, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const client = u.protocol === "https:" ? https : http;
    const req = client.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: opts.method || "GET",
        headers: opts.headers || {},
        ca: opts.ca,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(opts.timeoutMs || IMAGE_UPDATE_HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getResourceAdvisorUi() {
  const res = await requestUrl(RESOURCE_ADVISOR_UI_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`resource advisor ui request failed (${res.statusCode})`);
  }
  return JSON.parse(res.body || "{}");
}

async function registryRequest(urlString, repository, tokenState, options) {
  const opts = options || {};
  while (true) {
    const headers = {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
      ...(opts.headers || {}),
    };
    if (tokenState && tokenState.token) {
      headers.authorization = `Bearer ${tokenState.token}`;
    }

    const res = await requestHttps(urlString, {
      ...opts,
      headers,
    });

    if (res.statusCode === 401) {
      if (tokenState && tokenState.token) {
        throw new Error("registry authentication failed");
      }
      const challenge = parseWwwAuthenticate(res.headers["www-authenticate"]);
      const token = await fetchRegistryBearerToken(challenge, repository);
      if (!tokenState) {
        throw new Error("registry authentication state unavailable");
      }
      tokenState.token = token;
      continue;
    }

    return res;
  }
}

async function fetchRegistryBearerToken(challenge, repository) {
  if (!challenge || challenge.scheme !== "bearer") {
    throw new Error("unsupported registry auth scheme");
  }
  const realm = challenge.params.realm;
  if (!realm) throw new Error("missing registry auth realm");
  const tokenUrl = new URL(realm);
  if (challenge.params.service) {
    tokenUrl.searchParams.set("service", challenge.params.service);
  }
  tokenUrl.searchParams.set(
    "scope",
    challenge.params.scope || `repository:${repository}:pull`,
  );
  const res = await requestHttps(tokenUrl.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`token request failed (${res.statusCode})`);
  }
  const parsed = JSON.parse(res.body || "{}");
  const token = parsed.token || parsed.access_token || "";
  if (!token) throw new Error("registry token missing in response");
  return token;
}

async function listRegistryTags(imageRef) {
  const cacheKey = `${imageRef.registry}/${imageRef.repository}`;
  const cached = registryTagCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return cached.tags;

  const apiHost =
    imageRef.registry === "docker.io"
      ? "registry-1.docker.io"
      : imageRef.registry;
  const base = `https://${apiHost}`;
  let nextUrl = `${base}/v2/${imageRef.repository}/tags/list?n=200`;
  const tokenState = { token: "" };
  const tags = [];
  const seen = new Set();
  let pageCount = 0;

  while (nextUrl && pageCount < 8) {
    pageCount += 1;
    const res = await registryRequest(
      nextUrl,
      imageRef.repository,
      tokenState,
      {},
    );
    if (res.statusCode !== 200) {
      throw new Error(`tags request failed (${res.statusCode})`);
    }

    const payload = JSON.parse(res.body || "{}");
    if (Array.isArray(payload.tags)) {
      for (const tag of payload.tags) {
        const value = String(tag || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        tags.push(value);
      }
    }
    nextUrl = nextLinkUrl(res.headers.link, nextUrl);
  }

  registryTagCache.set(cacheKey, { ts: now, tags });
  return tags;
}

async function getNodePlatform(nodeName) {
  const key = String(nodeName || "").trim();
  if (!key) return { os: "linux", architecture: "" };
  if (kubeNodePlatformCache.has(key)) return kubeNodePlatformCache.get(key);

  const node = await kubeGetJson(`/api/v1/nodes/${key}`);
  const labels = (node && node.metadata && node.metadata.labels) || {};
  const platform = {
    os: String(labels["kubernetes.io/os"] || "linux").toLowerCase(),
    architecture: String(labels["kubernetes.io/arch"] || "").toLowerCase(),
  };
  kubeNodePlatformCache.set(key, platform);
  return platform;
}

async function fetchRegistryManifestDigest(imageRef, tag, platform) {
  const cacheKey = `${imageRef.registry}/${imageRef.repository}:${tag}:${(platform && platform.os) || "linux"}:${(platform && platform.architecture) || ""}`;
  const cached = registryManifestCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return cached.value;

  const apiHost =
    imageRef.registry === "docker.io"
      ? "registry-1.docker.io"
      : imageRef.registry;
  const url = `https://${apiHost}/v2/${imageRef.repository}/manifests/${encodeURIComponent(tag)}`;
  const tokenState = { token: "" };
  const res = await registryRequest(url, imageRef.repository, tokenState, {
    headers: {
      accept: [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.docker.distribution.manifest.v1+json",
      ].join(", "),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`manifest request failed (${res.statusCode})`);
  }

  const headerDigest = extractImageDigest(
    res.headers["docker-content-digest"] || "",
  );
  let value = headerDigest;
  const contentType = res.headers["content-type"];
  if (isManifestListContentType(contentType)) {
    const payload = JSON.parse(res.body || "{}");
    const selected = selectManifestForPlatform(payload.manifests, platform);
    value = extractImageDigest(selected && selected.digest);
  }

  registryManifestCache.set(cacheKey, { ts: now, value });
  return value;
}

function kubeApiAvailable() {
  return (
    Boolean(KUBE_SERVICE_HOST) &&
    fs.existsSync(KUBE_TOKEN_FILE) &&
    fs.existsSync(KUBE_CA_FILE)
  );
}

function kubeAuthContext() {
  const token = fs.readFileSync(KUBE_TOKEN_FILE, "utf8").trim();
  const ca = fs.readFileSync(KUBE_CA_FILE);
  return { token, ca };
}

async function kubeGetJson(pathname) {
  const res = await kubeRequest(pathname);
  if (res.statusCode === 404) return null;
  if (res.statusCode !== 200) {
    throw new Error(`kubernetes api request failed (${res.statusCode})`);
  }
  return JSON.parse(res.body || "{}");
}

async function kubeRequest(pathname, options) {
  if (!kubeApiAvailable()) throw new Error("kubernetes api unavailable");
  const auth = kubeAuthContext();
  const opts = options || {};
  const url = `https://${KUBE_SERVICE_HOST}:${KUBE_SERVICE_PORT}${pathname}`;
  const res = await requestHttps(url, {
    ca: auth.ca,
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${auth.token}`,
      "content-type": opts.contentType || "application/json",
      "user-agent": "exposure-control/1.0",
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function kubeUpsertConfigMap(namespace, name, data, labels) {
  const existing = await kubeGetJson(
    `/api/v1/namespaces/${namespace}/configmaps/${name}`,
  );
  const mergedLabels = {
    ...((existing && existing.metadata && existing.metadata.labels) || {}),
    ...(labels || {}),
  };
  const payload = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace,
      labels: mergedLabels,
    },
    data,
  };

  if (!existing) {
    const created = await kubeRequest(`/api/v1/namespaces/${namespace}/configmaps`, {
      method: "POST",
      body: payload,
    });
    if (created.statusCode !== 201) {
      throw new Error(`failed to create configmap ${name} (${created.statusCode})`);
    }
    return JSON.parse(created.body || "{}");
  }

  payload.metadata.resourceVersion =
    existing.metadata && existing.metadata.resourceVersion;
  if (existing.metadata && existing.metadata.annotations) {
    payload.metadata.annotations = existing.metadata.annotations;
  }
  const updated = await kubeRequest(
    `/api/v1/namespaces/${namespace}/configmaps/${name}`,
    {
      method: "PUT",
      body: payload,
    },
  );
  if (updated.statusCode !== 200) {
    throw new Error(`failed to update configmap ${name} (${updated.statusCode})`);
  }
  return JSON.parse(updated.body || "{}");
}

async function listNamespacePods(namespace) {
  const key = `${namespace}|running`;
  if (kubePodsCache.has(key)) return kubePodsCache.get(key);
  const qs = `?fieldSelector=${encodeURIComponent("status.phase=Running")}`;
  const list = await kubeGetJson(`/api/v1/namespaces/${namespace}/pods${qs}`);
  const items = Array.isArray(list && list.items) ? list.items : [];
  kubePodsCache.set(key, items);
  return items;
}

function podRank(pod) {
  const phase = pod && pod.status && pod.status.phase;
  if (phase === "Running") return 2;
  if (phase === "Pending") return 1;
  return 0;
}

function podTimestampMs(pod) {
  const ts = Date.parse((pod && pod.metadata && pod.metadata.creationTimestamp) || "");
  return Number.isFinite(ts) ? ts : 0;
}

function isBetterPod(candidate, current) {
  if (!current) return true;
  const rankDiff = podRank(candidate) - podRank(current);
  if (rankDiff !== 0) return rankDiff > 0;
  return podTimestampMs(candidate) > podTimestampMs(current);
}

function inferWorkloadId(pod) {
  const labels = (pod && pod.metadata && pod.metadata.labels) || {};
  const instance = labels["app.kubernetes.io/instance"];
  if (instance) return instance;
  const appName = labels["app.kubernetes.io/name"];
  if (appName) return appName;

  const owner = (pod && pod.metadata && pod.metadata.ownerReferences && pod.metadata.ownerReferences[0]) || null;
  if (owner && owner.kind === "StatefulSet" && owner.name) return owner.name;
  if (owner && owner.kind === "ReplicaSet" && owner.name) {
    return owner.name.replace(/-[a-f0-9]{9,10}$/i, "");
  }
  if (owner && owner.name) return owner.name;

  const name = (pod && pod.metadata && pod.metadata.name) || "";
  if (!name) return "";
  return name.replace(/-[a-z0-9]{5}$/i, "");
}

function pickPrimaryContainer(pod) {
  const containers = (pod && pod.spec && pod.spec.containers) || [];
  if (containers.length === 0) return null;
  return containers[0];
}

function findContainerStatus(pod, containerName) {
  const statuses = (pod && pod.status && pod.status.containerStatuses) || [];
  return (
    statuses.find((status) => status && status.name === containerName) || null
  );
}

async function mapWithConcurrency(items, limit, worker) {
  const maxWorkers = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;
  const runners = [];
  for (let i = 0; i < maxWorkers; i++) {
    runners.push((async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    })());
  }
  await Promise.all(runners);
}

function resolveLatestSemver(currentTag, tags) {
  const current = parseSemverTag(currentTag);
  if (!current || current.prerelease) return null;
  let best = null;
  for (const tag of tags || []) {
    const parsed = parseSemverTag(tag);
    if (!parsed || parsed.prerelease) continue;
    if (!best || compareSemver(parsed, best) > 0) best = parsed;
  }
  if (!best) return null;
  return {
    latestTag: best.raw,
    updateAvailable: compareSemver(best, current) > 0,
  };
}

function resolveLatestComparableTag(currentTag, tags) {
  const current = parseComparableTag(currentTag);
  if (!current) return null;

  let best = current;
  for (const tag of tags || []) {
    const parsed = parseComparableTag(tag);
    if (!parsed || !sameComparableTagFamily(current, parsed)) continue;
    if (compareComparableTags(parsed, best) > 0) best = parsed;
  }

  return {
    latestTag: best.raw,
    updateAvailable: compareComparableTags(best, current) > 0,
  };
}

function loadImageUpdateCache() {
  const cached = readJsonFile(IMAGE_UPDATES_CACHE_FILE);
  if (!cached || !Array.isArray(cached.items)) return null;
  return cached;
}

function imageUpdateNextCheckAt(checkedAt) {
  const ts = Date.parse(checkedAt || "");
  if (!Number.isFinite(ts)) return null;
  return new Date(
    ts + IMAGE_UPDATE_CACHE_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

function isImageUpdateCacheFresh(cached) {
  const nextCheckAt = imageUpdateNextCheckAt(cached && cached.checkedAt);
  if (!nextCheckAt) return false;
  return Date.parse(nextCheckAt) > Date.now();
}

async function buildImageUpdateSnapshot() {
  kubePodsCache.clear();
  kubeNodePlatformCache.clear();
  const selectedPods = new Map();

  for (const namespace of IMAGE_UPDATE_NAMESPACES) {
    const pods = await listNamespacePods(namespace);
    for (const pod of pods) {
      const workloadId = inferWorkloadId(pod);
      if (!workloadId) continue;
      const workloadKey = workloadId.toLowerCase();
      if (IMAGE_UPDATE_EXCLUDED_WORKLOADS.has(workloadKey)) continue;
      const key = `${namespace}/${workloadId}`;
      const existing = selectedPods.get(key);
      if (isBetterPod(pod, existing)) {
        selectedPods.set(key, pod);
      }
    }
  }

  const selectedKeys = Array.from(selectedPods.keys()).slice(
    0,
    IMAGE_UPDATE_MAX_WORKLOADS,
  );

  const items = [];
  const lookupTasks = [];
  let orderIndex = 0;

  for (const key of selectedKeys) {
    const pod = selectedPods.get(key);
    const slash = key.indexOf("/");
    const namespace = slash >= 0 ? key.slice(0, slash) : "default";
    const workloadId = slash >= 0 ? key.slice(slash + 1) : key;
    const podName = String((pod && pod.metadata && pod.metadata.name) || "");
    const container = pickPrimaryContainer(pod);

    const base = {
      id: workloadId,
      namespace,
      name: workloadId,
      pod: podName,
      currentVersion: null,
      latestVersion: null,
      image: null,
      imageRepo: null,
      updateAvailable: false,
      status: "unknown",
      statusText: "Unknown",
      detail: "",
      order: orderIndex++,
    };

    if (!container || !container.image) {
      items.push({
        ...base,
        statusText: "No image",
        detail: "Pod has no primary container image.",
      });
      continue;
    }

    const imageRef = parseImageReference(container.image);
    if (!imageRef) {
      items.push({
        ...base,
        image: container.image,
        statusText: "Invalid image",
        detail: "Could not parse image reference.",
      });
      continue;
    }

    const row = {
      ...base,
      image: container.image,
      imageRepo: `${imageRef.registry}/${imageRef.repository}`,
      currentVersion: imageRef.tag || null,
    };
    items.push(row);

    const containerStatus = findContainerStatus(pod, container.name);
    const currentDigest = extractImageDigest(
      (containerStatus && containerStatus.imageID) || "",
    );
    const semverCurrent = parseSemverTag(imageRef.tag);
    const comparableCurrent =
      !semverCurrent || semverCurrent.prerelease
        ? parseComparableTag(imageRef.tag)
        : null;

    lookupTasks.push({
      row,
      imageRef,
      currentDigest,
      podNodeName: String((pod && pod.spec && pod.spec.nodeName) || ""),
      strategy:
        semverCurrent && !semverCurrent.prerelease
          ? "semver"
          : comparableCurrent
            ? "comparable"
            : "digest",
    });
  }

  await mapWithConcurrency(
    lookupTasks,
    IMAGE_UPDATE_CONCURRENCY,
    async function(task) {
      try {
        if (task.strategy === "semver") {
          const tags = await listRegistryTags(task.imageRef);
          const latest = resolveLatestSemver(task.imageRef.tag, tags);
          if (!latest) {
            task.row.status = "unknown";
            task.row.statusText = "Unknown";
            task.row.detail = "No stable semver tags found in registry.";
            return;
          }
          task.row.latestVersion = latest.latestTag;
          task.row.updateAvailable = latest.updateAvailable;
          task.row.status = latest.updateAvailable ? "update" : "current";
          task.row.statusText = latest.updateAvailable
            ? "Update available"
            : "Up to date";
          task.row.detail = latest.updateAvailable
            ? `New version ${latest.latestTag} available.`
            : "Running latest known stable version.";
          return;
        }

        if (task.strategy === "comparable") {
          const tags = await listRegistryTags(task.imageRef);
          const latest = resolveLatestComparableTag(task.imageRef.tag, tags);
          if (latest) {
            task.row.latestVersion = latest.latestTag;
            task.row.updateAvailable = latest.updateAvailable;
            task.row.status = latest.updateAvailable ? "update" : "current";
            task.row.statusText = latest.updateAvailable
              ? "Update available"
              : "Up to date";
            task.row.detail = latest.updateAvailable
              ? `New matching tag ${latest.latestTag} available.`
              : "Running latest known matching tag.";
            return;
          }
        }

        if (!task.currentDigest) {
          task.row.status = "unknown";
          task.row.statusText = "Unknown";
          task.row.detail = `Current tag '${task.imageRef.tag}' is not version-sortable and pod image digest is unavailable.`;
          return;
        }

        const platform = task.podNodeName
          ? await getNodePlatform(task.podNodeName)
          : { os: "linux", architecture: "" };
        const remoteDigest = await fetchRegistryManifestDigest(
          task.imageRef,
          task.imageRef.tag,
          platform,
        );
        if (!remoteDigest) {
          task.row.status = "unknown";
          task.row.statusText = "Unknown";
          task.row.detail = `Current tag '${task.imageRef.tag}' could not be compared against a registry digest.`;
          return;
        }

        task.row.latestVersion = task.imageRef.tag;
        task.row.updateAvailable = remoteDigest !== task.currentDigest;
        task.row.status = task.row.updateAvailable ? "update" : "current";
        task.row.statusText = task.row.updateAvailable
          ? "Update available"
          : "Up to date";
        task.row.detail = task.row.updateAvailable
          ? `Tag '${task.imageRef.tag}' now points to ${shortDigest(remoteDigest)}.`
          : `Registry digest matches running tag '${task.imageRef.tag}'.`;
      } catch (err) {
        task.row.status = "unknown";
        task.row.statusText = "Registry error";
        task.row.detail = err.message;
      }
    },
  );

  items.sort(function(a, b) {
    const aPriority = a.status === "update" ? 0 : 1;
    const bPriority = b.status === "update" ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return (a.order || 0) - (b.order || 0);
  });
  for (const item of items) delete item.order;

  return {
    checkedAt: nowIso(),
    ttlHours: IMAGE_UPDATE_CACHE_TTL_HOURS,
    items,
  };
}

async function getImageUpdates(forceRefresh) {
  const cached = loadImageUpdateCache();
  const hasFreshCache = cached && isImageUpdateCacheFresh(cached);

  if (!forceRefresh && hasFreshCache) {
    return {
      ...cached,
      source: "cache",
      stale: false,
      refreshInProgress: Boolean(imageUpdateRefreshPromise),
      nextCheckAt: imageUpdateNextCheckAt(cached.checkedAt),
    };
  }

  if (!imageUpdateRefreshPromise) {
    imageUpdateRefreshPromise = (async () => {
      const snapshot = await buildImageUpdateSnapshot();
      writeJsonFile(IMAGE_UPDATES_CACHE_FILE, snapshot);
      return snapshot;
    })().finally(() => {
      imageUpdateRefreshPromise = null;
    });
  }

  if (!forceRefresh && cached) {
    return {
      ...cached,
      source: "cache",
      stale: true,
      refreshInProgress: true,
      nextCheckAt: imageUpdateNextCheckAt(cached.checkedAt),
    };
  }

  try {
    const fresh = await imageUpdateRefreshPromise;
    return {
      ...fresh,
      source: "live",
      stale: false,
      refreshInProgress: false,
      nextCheckAt: imageUpdateNextCheckAt(fresh.checkedAt),
    };
  } catch (err) {
    if (cached) {
      return {
        ...cached,
        source: "cache",
        stale: true,
        refreshInProgress: false,
        error: err.message,
        nextCheckAt: imageUpdateNextCheckAt(cached.checkedAt),
      };
    }
    throw err;
  }
}

async function getTransmissionVpnControlConfig() {
  const cm = await kubeGetJson(
    `/api/v1/namespaces/${TRANSMISSION_VPN_NAMESPACE}/configmaps/${TRANSMISSION_VPN_CONTROL_CONFIGMAP}`,
  );
  if (!cm || !cm.data) {
    throw new Error("transmission vpn control configmap not found");
  }

  const defaultMode =
    normalizeTransmissionVpnMode(cm.data["default-mode"]) || "direct";
  const runtimeConfigMap =
    String(cm.data["runtime-configmap"] || "").trim() ||
    TRANSMISSION_VPN_RUNTIME_CONFIGMAP_FALLBACK;
  const directValues = String(cm.data["direct-values.yaml"] || "").trim();
  const vpnValues = String(cm.data["vpn-values.yaml"] || "").trim();
  if (!directValues || !vpnValues) {
    throw new Error("transmission vpn control configmap is missing mode templates");
  }

  return {
    namespace: TRANSMISSION_VPN_NAMESPACE,
    defaultMode,
    runtimeConfigMap,
    directValues,
    vpnValues,
    provider: String(cm.data.provider || "custom").trim() || "custom",
    vpnType: String(cm.data["vpn-type"] || "wireguard").trim() || "wireguard",
    placeholderConfig:
      String(cm.data["placeholder-config"] || "").toLowerCase() === "true",
  };
}

function transmissionVpnConfigMapLabels() {
  return {
    "reconcile.fluxcd.io/watch": "Enabled",
    "app.kubernetes.io/name": "transmission",
    "app.kubernetes.io/component": "vpn-state",
  };
}

function transmissionVpnValuesForMode(config, mode) {
  return mode === "vpn" ? config.vpnValues : config.directValues;
}

async function ensureTransmissionVpnState() {
  const config = await getTransmissionVpnControlConfig();
  const path = `/api/v1/namespaces/${config.namespace}/configmaps/${config.runtimeConfigMap}`;
  let cm = await kubeGetJson(path);
  if (!cm || !cm.data) {
    cm = await kubeUpsertConfigMap(
      config.namespace,
      config.runtimeConfigMap,
      {
        mode: config.defaultMode,
        "values.yaml": transmissionVpnValuesForMode(config, config.defaultMode),
        updatedAt: nowIso(),
        source: "default-seed",
      },
      transmissionVpnConfigMapLabels(),
    );
  }
  return { config, cm };
}

function selectTransmissionPod(pods) {
  let selected = null;
  for (const pod of pods || []) {
    if (String(inferWorkloadId(pod) || "").toLowerCase() !== "transmission") {
      continue;
    }
    if (isBetterPod(pod, selected)) selected = pod;
  }
  return selected;
}

async function getTransmissionVpnStatus() {
  const { config, cm } = await ensureTransmissionVpnState();
  const data = (cm && cm.data) || {};
  const desiredMode =
    normalizeTransmissionVpnMode(data.mode) || config.defaultMode;
  const updatedAt = data.updatedAt || null;
  let effectiveMode = desiredMode;
  let rolloutPending = false;
  let podName = null;
  let podPhase = null;

  try {
    const pods = await listNamespacePods(config.namespace);
    const pod = selectTransmissionPod(pods);
    if (pod) {
      podName = (pod.metadata && pod.metadata.name) || null;
      podPhase = (pod.status && pod.status.phase) || null;
      const containerNames = ((pod.spec && pod.spec.containers) || [])
        .map((container) => String(container.name || "").toLowerCase());
      effectiveMode = containerNames.includes("gluetun") ? "vpn" : "direct";
      rolloutPending = effectiveMode !== desiredMode || podPhase !== "Running";
    } else {
      rolloutPending = true;
      effectiveMode = null;
    }
  } catch (err) {
    rolloutPending = true;
  }

  return {
    desiredMode,
    effectiveMode,
    enabled: desiredMode === "vpn",
    defaultMode: config.defaultMode,
    provider: config.provider,
    vpnType: config.vpnType,
    placeholderConfig: config.placeholderConfig,
    runtimeConfigMap: config.runtimeConfigMap,
    updatedAt,
    rolloutPending,
    podName,
    podPhase,
  };
}

async function setTransmissionVpnMode(mode) {
  const normalizedMode = normalizeTransmissionVpnMode(mode);
  if (!normalizedMode) throw new Error("invalid transmission vpn mode");

  const { config } = await ensureTransmissionVpnState();
  await kubeUpsertConfigMap(
    config.namespace,
    config.runtimeConfigMap,
    {
      mode: normalizedMode,
      "values.yaml": transmissionVpnValuesForMode(config, normalizedMode),
      updatedAt: nowIso(),
      source: "control-panel",
    },
    transmissionVpnConfigMapLabels(),
  );
  kubePodsCache.delete(`${config.namespace}|running`);
  appendAuditEntry({
    action: "transmission-vpn-set",
    serviceId: "transmission",
    mode: normalizedMode,
  });
  return getTransmissionVpnStatus();
}

const services = loadServices();
const serviceById = new Map(services.map((svc) => [svc.id, svc]));
const serviceByHost = new Map(
  services.map((svc) => [servicePublicHost(svc), svc]),
);
const state = loadState(services);

// Startup reconciliation: expire stale exposures and log recovered state
(function startupReconcile() {
  let activeCount = 0;
  let expiredCount = 0;
  for (const svc of services) {
    const exposure = state.exposures[svc.id];
    if (exposure && exposure.enabled) {
      if (isExpired(exposure)) {
        exposure.enabled = false;
        exposure.expiresAt = null;
        exposure.updatedAt = nowIso();
        appendAuditEntry({
          action: "auto-expire",
          serviceId: svc.id,
          trigger: "startup",
        });
        expiredCount++;
      } else {
        activeCount++;
      }
    }
  }
  if (expiredCount > 0) saveState(state);
  console.log(
    `state: recovered ${services.length} services, ${activeCount} active, ${expiredCount} expired on startup`,
  );
})();

if (kubeApiAvailable()) {
  getTransmissionVpnStatus()
    .then((status) => {
      console.log(
        `transmission-vpn: desired=${status.desiredMode} default=${status.defaultMode}`,
      );
    })
    .catch((err) => {
      console.error("transmission-vpn: bootstrap failed:", err.message);
    });
}

function snapshotServices() {
  return services.map((svc) => {
    const exposure = state.exposures[svc.id];
    const authMode = exposureAuthMode(svc, exposure);
    return {
      id: svc.id,
      name: svc.name,
      description: svc.description || "",
      target: svc.target,
      publicHost: servicePublicHost(svc),
      publicUrl: `https://${servicePublicHost(svc)}`,
      enabled: effectiveEnabled(exposure),
      desiredEnabled: Boolean(exposure && exposure.enabled),
      expiresAt: exposure ? exposure.expiresAt : null,
      updatedAt: exposure ? exposure.updatedAt : null,
      defaultExpiryHours: DEFAULT_EXPIRY_HOURS,
      defaultAuthMode: serviceDefaultAuthMode(svc),
      authMode,
    };
  });
}

function disableExpiredExposures() {
  try {
    let changed = false;
    for (const svc of services) {
      const exposure = state.exposures[svc.id];
      if (isExpired(exposure)) {
        exposure.enabled = false;
        exposure.expiresAt = null;
        exposure.updatedAt = nowIso();
        exposure.authMode = exposureAuthMode(svc, exposure);
        metrics.expiredDisableTotal += 1;
        appendAuditEntry({ action: "auto-expire", serviceId: svc.id });
        changed = true;
      }
    }
    if (changed) saveState(state);
    metrics.lastReconcileTimestampSeconds = Math.floor(Date.now() / 1000);
  } catch (err) {
    metrics.reconcileErrorsTotal += 1;
    console.error("reconcile error:", err.message);
  }
}

setInterval(
  disableExpiredExposures,
  Math.max(RECONCILE_INTERVAL_SECONDS, 15) * 1000,
);
setInterval(
  () => {
    const now = Date.now();
    const windowMs = SHARE_RATE_LIMIT_WINDOW_SECONDS * 1000;
    for (const [key, entry] of rateLimits.entries()) {
      if (now - entry.startMs > windowMs * 2) rateLimits.delete(key);
    }
  },
  Math.max(SHARE_RATE_LIMIT_WINDOW_SECONDS, 15) * 1000,
);

function activeExposureCount() {
  let active = 0;
  for (const svc of services) {
    if (effectiveEnabled(state.exposures[svc.id])) active += 1;
  }
  return active;
}

function renderMetrics() {
  return [
    "# HELP exposure_control_active_exposures Number of currently active temporary public exposures.",
    "# TYPE exposure_control_active_exposures gauge",
    `exposure_control_active_exposures ${activeExposureCount()}`,
    "# HELP exposure_control_enable_total Number of manual enable operations.",
    "# TYPE exposure_control_enable_total counter",
    `exposure_control_enable_total ${metrics.enableTotal}`,
    "# HELP exposure_control_disable_total Number of manual disable operations.",
    "# TYPE exposure_control_disable_total counter",
    `exposure_control_disable_total ${metrics.disableTotal}`,
    "# HELP exposure_control_emergency_disable_total Number of exposures disabled via emergency shutdown.",
    "# TYPE exposure_control_emergency_disable_total counter",
    `exposure_control_emergency_disable_total ${metrics.emergencyDisableTotal}`,
    "# HELP exposure_control_expired_disable_total Number of exposures auto-disabled due to expiry.",
    "# TYPE exposure_control_expired_disable_total counter",
    `exposure_control_expired_disable_total ${metrics.expiredDisableTotal}`,
    "# HELP exposure_control_share_allowed_total Number of share requests forwarded to upstreams.",
    "# TYPE exposure_control_share_allowed_total counter",
    `exposure_control_share_allowed_total ${metrics.shareAllowedTotal}`,
    "# HELP exposure_control_share_denied_disabled_total Number of share requests denied because exposure was disabled.",
    "# TYPE exposure_control_share_denied_disabled_total counter",
    `exposure_control_share_denied_disabled_total ${metrics.shareDeniedDisabledTotal}`,
    "# HELP exposure_control_share_denied_auth_total Number of share requests denied due to missing Cloudflare Access token.",
    "# TYPE exposure_control_share_denied_auth_total counter",
    `exposure_control_share_denied_auth_total ${metrics.shareDeniedAuthTotal}`,
    "# HELP exposure_control_share_denied_rate_limited_total Number of share requests denied by rate limit.",
    "# TYPE exposure_control_share_denied_rate_limited_total counter",
    `exposure_control_share_denied_rate_limited_total ${metrics.shareDeniedRateLimitedTotal}`,
    "# HELP exposure_control_reconcile_errors_total Number of errors in expiry reconciliation.",
    "# TYPE exposure_control_reconcile_errors_total counter",
    `exposure_control_reconcile_errors_total ${metrics.reconcileErrorsTotal}`,
    "# HELP exposure_control_last_reconcile_timestamp_seconds Unix timestamp of the last successful reconciliation loop.",
    "# TYPE exposure_control_last_reconcile_timestamp_seconds gauge",
    `exposure_control_last_reconcile_timestamp_seconds ${metrics.lastReconcileTimestampSeconds}`,
    "",
  ].join("\n");
}

async function handleApi(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  if (req.method === "GET" && pathname === "/api/services") {
    disableExpiredExposures();
    return sendJson(res, 200, { services: snapshotServices() });
  }

  const enableMatch = pathname.match(/^\/api\/services\/([a-z0-9-]+)\/enable$/);
  if (req.method === "POST" && enableMatch) {
    const id = enableMatch[1];
    const svc = serviceById.get(id);
    if (!svc) return sendJson(res, 404, { error: "service not found" });

    let body = {};
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const hours = clampHours(Number(body.hours ?? DEFAULT_EXPIRY_HOURS));
    const authMode =
      normalizeAuthMode(body.authMode) || serviceDefaultAuthMode(svc);
    const expiresAt = new Date(
      Date.now() + hours * 60 * 60 * 1000,
    ).toISOString();
    state.exposures[id] = {
      enabled: true,
      expiresAt,
      updatedAt: nowIso(),
      authMode,
    };
    saveState(state);
    metrics.enableTotal += 1;
    appendAuditEntry({ action: "enable", serviceId: id, hours, authMode });
    return sendJson(res, 200, {
      service: snapshotServices().find((item) => item.id === id),
    });
  }

  const disableMatch = pathname.match(
    /^\/api\/services\/([a-z0-9-]+)\/disable$/,
  );
  if (req.method === "POST" && disableMatch) {
    const id = disableMatch[1];
    const svc = serviceById.get(id);
    if (!svc) return sendJson(res, 404, { error: "service not found" });

    state.exposures[id] = {
      enabled: false,
      expiresAt: null,
      updatedAt: nowIso(),
      authMode: exposureAuthMode(svc, state.exposures[id]),
    };
    saveState(state);
    metrics.disableTotal += 1;
    appendAuditEntry({ action: "disable", serviceId: id });
    return sendJson(res, 200, {
      service: snapshotServices().find((item) => item.id === id),
    });
  }

  if (req.method === "POST" && pathname === "/api/admin/disable-all") {
    let disabled = 0;
    for (const svc of services) {
      const exposure = state.exposures[svc.id];
      if (exposure && exposure.enabled) {
        disabled += 1;
      }
      state.exposures[svc.id] = {
        enabled: false,
        expiresAt: null,
        updatedAt: nowIso(),
        authMode: exposureAuthMode(svc, exposure),
      };
    }
    saveState(state);
    metrics.emergencyDisableTotal += disabled;
    appendAuditEntry({ action: "emergency-disable-all", disabled });
    return sendJson(res, 200, { disabled, services: snapshotServices() });
  }

  if (req.method === "GET" && pathname === "/api/transmission-vpn") {
    try {
      const status = await getTransmissionVpnStatus();
      return sendJson(res, 200, status);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/transmission-vpn") {
    let body = {};
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const mode =
      normalizeTransmissionVpnMode(body.mode) ||
      (typeof body.enabled === "boolean"
        ? body.enabled
          ? "vpn"
          : "direct"
        : null);
    if (!mode) {
      return sendJson(res, 400, { error: "mode must be direct or vpn" });
    }

    try {
      const status = await setTransmissionVpnMode(mode);
      return sendJson(res, 200, status);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/audit") {
    const entries = loadAuditEntries(100);
    return sendJson(res, 200, { entries });
  }

  if (req.method === "GET" && pathname === "/api/image-updates") {
    const force =
      parsedUrl.searchParams.get("force") === "1" ||
      parsedUrl.searchParams.get("refresh") === "1";
    try {
      const payload = await getImageUpdates(force);
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/tuning") {
    try {
      const payload = await getResourceAdvisorUi();
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: "not found" });
}

function proxyRequest(req, res, target) {
  const host = getHost(req);
  const targetUrl = new URL(req.url || "/", target);
  const client = targetUrl.protocol === "https:" ? https : http;
  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  headers["x-forwarded-host"] = host;
  headers["x-forwarded-proto"] = "https";
  delete headers["content-length"];

  const upstream = client.request(
    targetUrl,
    { method: req.method, headers },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders["content-security-policy-report-only"];
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    sendText(res, 502, `upstream error: ${err.message}`);
  });

  req.pipe(upstream);
}

function renderControlPanelHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rangoonpulse control panel</title>
    <style>
      :root {
        --bg: #0c0c0c;
        --bg-subtle: #141414;
        --border: rgba(255, 255, 255, 0.07);
        --border-strong: rgba(255, 255, 255, 0.14);
        --text-1: #e8e8e8;
        --text-2: #888;
        --text-3: #555;
        --text-dim: #6b6b6b;
        --green: #3fb950;
        --red: #f85149;
        --yellow: #d29922;
        --accent: #79b8ff;
        --font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
      }
      * { box-sizing: border-box; margin: 0; }
      html {
        min-height: 100%;
        background-color: #0b0b0b;
      }
      body {
        background-color: #0b0b0b;
        background-image:
          radial-gradient(1200px 600px at 8% -20%, rgba(121, 184, 255, 0.08), transparent 56%),
          radial-gradient(1000px 520px at 92% -30%, rgba(63, 185, 80, 0.07), transparent 62%),
          linear-gradient(180deg, #0b0b0b 0%, var(--bg) 46%, #0b0b0b 100%);
        background-repeat: no-repeat;
        background-size: 100vw 100vh, 100vw 100vh, 100vw 100vh;
        background-attachment: fixed, fixed, fixed;
        color: var(--text-1);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        min-height: 100dvh;
      }
      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 32px 24px;
        animation: fade-up 340ms ease-out both;
      }

      /* ── Header ── */
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 24px;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--border);
        animation: fade-up 420ms ease-out both;
      }
      h1 {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-1);
        letter-spacing: -0.01em;
      }
      .subtitle {
        color: var(--text-3);
        font-size: 12px;
        margin-top: 4px;
        font-family: var(--font-mono);
      }
      .tabs {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 20px;
      }
      .tab-btn {
        padding: 6px 14px;
        border-radius: 999px;
      }
      .tab-btn.active {
        color: var(--text-1);
        border-color: rgba(121, 184, 255, 0.45);
        background: rgba(121, 184, 255, 0.12);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
      }
      .panel { animation: fade-up 400ms ease-out both; }
      [hidden] { display: none !important; }
      .panel-actions,
      .updates-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      .updates-meta {
        color: var(--text-3);
        font-size: 11px;
        font-family: var(--font-mono);
      }
      .vpn-card {
        margin-bottom: 18px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0.008));
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.2);
      }
      .vpn-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
      }
      .vpn-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-1);
        margin-bottom: 4px;
      }
      .vpn-meta {
        color: var(--text-3);
        font-size: 11px;
        font-family: var(--font-mono);
      }

      /* ── Shared form controls ── */
      button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        line-height: 1.4;
        color: var(--text-2);
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 3px;
        cursor: pointer;
        transition:
          color 0.15s linear,
          border-color 0.15s linear,
          transform 0.18s ease,
          background-color 0.18s ease,
          box-shadow 0.18s ease;
        white-space: nowrap;
        position: relative;
        overflow: hidden;
      }
      button:hover {
        color: var(--text-1);
        border-color: var(--border-strong);
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.03);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
      }
      button:active { transform: translateY(0); }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      button.danger { color: var(--red); }
      button.danger:hover { color: var(--red); border-color: var(--red); background: rgba(248, 81, 73, 0.08); }
      button.mode-active {
        color: var(--text-1);
        border-color: rgba(121, 184, 255, 0.45);
        background: rgba(121, 184, 255, 0.12);
      }
      select {
        padding: 4px 8px;
        font-size: 12px;
        font-family: inherit;
        color: var(--text-2);
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 3px;
        outline: none;
        transition: border-color 0.15s linear, background-color 0.15s linear;
      }
      select:hover, select:focus {
        border-color: var(--border-strong);
        background: rgba(255, 255, 255, 0.02);
      }

      /* ── Tables ── */
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0.005));
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
      }
      thead th {
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        text-align: left;
        border-bottom: 1px solid var(--border);
        background: rgba(12, 12, 12, 0.88);
        backdrop-filter: blur(4px);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .exposure-table thead th:nth-child(2),
      .exposure-table tbody td:nth-child(2),
      .exposure-table thead th:nth-child(6),
      .exposure-table tbody td:nth-child(6) {
        white-space: nowrap;
      }
      tbody td {
        padding: 10px 12px;
        vertical-align: middle;
        border-bottom: 1px solid var(--border);
        transition: background-color 0.16s ease;
      }
      tbody tr {
        opacity: 0;
        transform: translateY(8px);
        animation: row-in 360ms cubic-bezier(0.2, 0.75, 0.3, 1) both;
        animation-delay: calc(var(--row-index, 0) * 24ms);
      }
      tbody tr:hover td { background: rgba(255, 255, 255, 0.028); }
      tbody tr:last-child td { border-bottom: none; }

      /* ── Service name cell ── */
      .svc-name {
        font-weight: 500;
        color: var(--text-1);
        font-size: 13px;
      }
      .svc-id {
        font-size: 11px;
        color: var(--text-3);
        font-family: var(--font-mono);
        margin-top: 1px;
      }

      /* ── Badges ── */
      .badge {
        display: inline-flex;
        align-items: center;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .on { color: var(--green); }
      .off { color: var(--text-3); }
      .badge.on::before {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 6px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 rgba(63, 185, 80, 0.45);
        animation: pulse-dot 1.8s ease-out infinite;
      }

      /* ── Controls cell ── */
      .controls { display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; }
      .controls > * { flex: 0 0 auto; }

      /* ── Links ── */
      a {
        color: var(--text-2);
        text-decoration: underline;
        text-decoration-color: var(--border);
        text-underline-offset: 3px;
        font-family: var(--font-mono);
        font-size: 12px;
        transition: color 0.1s linear;
      }
      a:hover { color: var(--text-1); }

      /* ── Expiry text ── */
      .expiry { font-size: 12px; color: var(--text-2); font-family: var(--font-mono); }
      .expiry.urgent { color: var(--yellow); }
      .expiry.expired { color: var(--red); }

      /* ── Auth text ── */
      .auth-mode {
        font-size: 12px;
        color: var(--text-3);
        font-family: var(--font-mono);
      }

      /* ── Status message ── */
      .msg {
        margin-top: 12px;
        min-height: 1.2rem;
        font-size: 12px;
        color: var(--text-dim);
        transition: color 0.2s ease;
      }

      /* ── Section dividers ── */
      .section {
        margin-top: 32px;
        padding-top: 24px;
        border-top: 1px solid var(--border);
        animation: fade-up 500ms ease-out both;
      }
      .section-header {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 12px;
      }

      /* ── Audit log ── */
      .audit-scroll {
        max-height: min(52vh, 480px);
        overflow-y: auto;
        border-radius: 10px;
      }
      .audit-table td { font-size: 12px; padding: 7px 12px; }
      .audit-time {
        color: var(--text-3);
        font-family: var(--font-mono);
        font-size: 11px;
        white-space: nowrap;
      }
      .audit-svc {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-2);
      }
      .audit-detail {
        color: var(--text-3);
        font-size: 11px;
      }
      .action-enable { color: var(--green); }
      .action-disable { color: var(--red); }
      .action-emergency { color: var(--red); font-weight: 500; }
      .action-expire { color: var(--yellow); }

      /* ── Updates ── */
      .updates-scroll {
        overflow-x: auto;
        overflow-y: visible;
        border-radius: 10px;
      }
      .update-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .update-chip::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
      }
      .update-chip.current { color: var(--green); }
      .update-chip.update { color: var(--yellow); }
      .update-chip.update::before {
        box-shadow: 0 0 0 rgba(210, 153, 34, 0.5);
        animation: pulse-update 1.6s ease-out infinite;
      }
      .update-chip.unknown { color: var(--text-2); }
      .update-chip.external { color: var(--text-3); }
      .update-chip.not-installed { color: var(--red); }
      .updates-version {
        font-size: 12px;
        font-family: var(--font-mono);
        color: var(--text-2);
      }
      .updates-sub {
        margin-top: 2px;
        font-size: 11px;
        color: var(--text-3);
        font-family: var(--font-mono);
      }

      /* ── Empty state ── */
      .empty-row td {
        text-align: center;
        color: var(--text-3);
        padding: 24px 12px;
        font-size: 12px;
      }
      .empty-row { animation: none; opacity: 1; transform: none; }

      @keyframes row-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fade-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes pulse-dot {
        0% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
        75% { box-shadow: 0 0 0 8px rgba(63, 185, 80, 0); }
        100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
      }
      @keyframes pulse-update {
        0% { box-shadow: 0 0 0 0 rgba(210, 153, 34, 0.45); }
        75% { box-shadow: 0 0 0 9px rgba(210, 153, 34, 0); }
        100% { box-shadow: 0 0 0 0 rgba(210, 153, 34, 0); }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
        }
      }
      @media (max-width: 820px) {
        main { padding: 22px 14px; }
        .controls { flex-wrap: wrap; }
        .vpn-row,
        .panel-actions,
        .updates-toolbar {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <h1>rangoonpulse control panel</h1>
          <div class="subtitle">transmission vpn + exposure controls + image update tracker · ${SHARE_HOST_PREFIX}&lt;id&gt;.${PUBLIC_DOMAIN} · ${DEFAULT_EXPIRY_HOURS}h default · weekly checks</div>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Control panel sections">
        <button id="tabExposure" class="tab-btn active" type="button" data-tab="exposure">Exposure</button>
        <button id="tabUpdates" class="tab-btn" type="button" data-tab="updates">Image Updates</button>
      </div>

      <section id="panelExposure" class="panel">
        <div class="panel-actions">
          <div class="section-header">Operational Controls</div>
          <div>
            <button id="refreshBtn" type="button">Refresh</button>
            <button id="emergencyBtn" class="danger" type="button">Disable All</button>
          </div>
        </div>
        <div class="vpn-card">
          <div class="vpn-row">
            <div>
              <div class="vpn-title">Transmission Egress</div>
              <div id="vpnMeta" class="vpn-meta">Loading Transmission VPN status...</div>
              <div class="vpn-meta">
                Gluetun WebUI: <a href="${escapeHtml(TRANSMISSION_VPN_WEBUI_URL)}" target="_blank" rel="noreferrer">open dashboard</a>
              </div>
            </div>
            <div class="controls">
              <button id="vpnDirectBtn" type="button">Route Direct</button>
              <button id="vpnEnableBtn" type="button">Route via VPN</button>
            </div>
          </div>
          <div id="vpnMsg" class="msg"></div>
        </div>
        <div class="section-header">Temporary Exposure Control</div>
        <table class="exposure-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Auth</th>
              <th>Public URL</th>
              <th>Expires</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
        <div id="msg" class="msg"></div>

        <div class="section">
          <div class="section-header">Audit Log</div>
          <div class="audit-scroll">
            <table class="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Service</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody id="auditRows"></tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="panelUpdates" class="panel" hidden>
        <div class="updates-toolbar">
          <div>
            <div class="section-header">Installed Service Image Versions</div>
            <div id="updatesMeta" class="updates-meta">No update check yet.</div>
          </div>
          <button id="updatesRefreshBtn" type="button">Check Now</button>
        </div>
        <div class="updates-scroll">
          <table class="updates-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Current</th>
                <th>Latest</th>
                <th>Status</th>
                <th>Image</th>
              </tr>
            </thead>
            <tbody id="updatesRows"></tbody>
          </table>
        </div>
        <div id="updatesMsg" class="msg"></div>
      </section>
    </main>
    <script>
      const panelExposureEl = document.getElementById("panelExposure");
      const panelUpdatesEl = document.getElementById("panelUpdates");
      const tabExposureBtn = document.getElementById("tabExposure");
      const tabUpdatesBtn = document.getElementById("tabUpdates");
      const rowsEl = document.getElementById("rows");
      const auditRowsEl = document.getElementById("auditRows");
      const updatesRowsEl = document.getElementById("updatesRows");
      const vpnMetaEl = document.getElementById("vpnMeta");
      const msgEl = document.getElementById("msg");
      const vpnMsgEl = document.getElementById("vpnMsg");
      const updatesMsgEl = document.getElementById("updatesMsg");
      const updatesMetaEl = document.getElementById("updatesMeta");
      const refreshBtn = document.getElementById("refreshBtn");
      const emergencyBtn = document.getElementById("emergencyBtn");
      const vpnDirectBtn = document.getElementById("vpnDirectBtn");
      const vpnEnableBtn = document.getElementById("vpnEnableBtn");
      const updatesRefreshBtn = document.getElementById("updatesRefreshBtn");
      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let updatesLoaded = false;
      let transmissionVpnState = null;

      function setMessage(target, text, isError) {
        target.textContent = text || "";
        target.style.color = isError ? "var(--red)" : "var(--text-3)";
      }

      function setMsg(text, isError) {
        setMessage(msgEl, text, isError);
      }

      function setVpnMsg(text, isError) {
        setMessage(vpnMsgEl, text, isError);
      }

      function setUpdatesMsg(text, isError) {
        setMessage(updatesMsgEl, text, isError);
      }

      function setActiveTab(tab) {
        const exposure = tab !== "updates";
        panelExposureEl.hidden = !exposure;
        panelUpdatesEl.hidden = exposure;
        tabExposureBtn.classList.toggle("active", exposure);
        tabUpdatesBtn.classList.toggle("active", !exposure);
        if (!exposure && !updatesLoaded) {
          loadUpdates();
        }
      }

      tabExposureBtn.onclick = function() {
        setActiveTab("exposure");
        history.replaceState(null, "", "#exposure");
      };
      tabUpdatesBtn.onclick = function() {
        setActiveTab("updates");
        history.replaceState(null, "", "#updates");
      };

      function fmtExpiry(value) {
        if (!value) return { text: "\\u2014", state: "none" };
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return { text: "invalid", state: "invalid" };
        const now = Date.now();
        const diff = d.getTime() - now;
        if (diff <= 0) return { text: "expired", state: "expired" };
        const totalSeconds = Math.ceil(diff / 1000);
        if (totalSeconds < 60) {
          return { text: totalSeconds + "s remaining", state: "urgent" };
        }
        const mins = Math.ceil(totalSeconds / 60);
        if (mins < 60) {
          return { text: mins + "m remaining", state: mins <= 10 ? "urgent" : "active" };
        }
        const hrs = Math.floor(mins / 60);
        const rm = mins % 60;
        if (rm === 0) return { text: hrs + "h remaining", state: mins <= 120 ? "urgent" : "active" };
        return {
          text: hrs + "h " + rm + "m remaining",
          state: mins <= 120 ? "urgent" : "active",
        };
      }

      function updateExpiryNode(node) {
        const next = fmtExpiry(node.dataset.expiresAt || "");
        node.textContent = next.text;
        node.classList.toggle("urgent", next.state === "urgent");
        node.classList.toggle("expired", next.state === "expired");
        return next.state;
      }

      function tickExpiryCountdowns() {
        const expiryNodes = rowsEl.querySelectorAll(".expiry[data-expires-at]");
        let shouldRefresh = false;
        for (const node of expiryNodes) {
          const state = updateExpiryNode(node);
          const enabled = node.dataset.enabled === "1";
          if (enabled && state === "expired") {
            shouldRefresh = true;
          }
        }
        if (shouldRefresh && mutationInFlight === 0 && !pendingExpiryRefresh) {
          pendingExpiryRefresh = true;
          setTimeout(async () => {
            try {
              await loadExposure({ silent: true });
            } finally {
              pendingExpiryRefresh = false;
            }
          }, 300);
        }
      }

      async function request(path, method, body) {
        const res = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "request failed");
        return data;
      }

      function renderTransmissionVpn(status) {
        transmissionVpnState = status || null;
        if (!status) {
          vpnMetaEl.textContent = "Transmission VPN status unavailable.";
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          vpnDirectBtn.classList.remove("mode-active");
          vpnEnableBtn.classList.remove("mode-active");
          return;
        }

        const desiredMode = status.desiredMode || "direct";
        const effectiveMode = status.effectiveMode || "pending";
        const meta = [
          "desired: " + desiredMode,
          "running: " + effectiveMode,
          "default: " + (status.defaultMode || "direct"),
          "provider: " + (status.provider || "custom") + "/" + (status.vpnType || "wireguard"),
        ];
        if (status.podName) {
          meta.push("pod/" + status.podName);
        }
        if (status.rolloutPending) {
          meta.push("rollout pending");
        }
        if (status.placeholderConfig) {
          meta.push("placeholder credentials scaffolded");
        }
        vpnMetaEl.textContent = meta.join(" | ");

        vpnDirectBtn.disabled = mutationInFlight > 0 || desiredMode === "direct";
        vpnEnableBtn.disabled = mutationInFlight > 0 || desiredMode === "vpn";
        vpnDirectBtn.classList.toggle("mode-active", desiredMode === "direct");
        vpnEnableBtn.classList.toggle("mode-active", desiredMode === "vpn");
      }

      function renderRows(services) {
        rowsEl.innerHTML = "";
        if (services.length === 0) {
          const tr = document.createElement("tr");
          tr.className = "empty-row";
          const td = document.createElement("td");
          td.colSpan = 6;
          td.textContent = "No services configured.";
          tr.appendChild(td);
          rowsEl.appendChild(tr);
          return;
        }
        for (const [index, svc] of services.entries()) {
          const tr = document.createElement("tr");
          tr.style.setProperty("--row-index", String(index));
          if (svc.enabled) tr.classList.add("is-enabled");

          const serviceTd = document.createElement("td");
          const nameEl = document.createElement("div");
          nameEl.className = "svc-name";
          nameEl.textContent = svc.name;
          const idEl = document.createElement("div");
          idEl.className = "svc-id";
          idEl.textContent = svc.id;
          serviceTd.append(nameEl, idEl);

          const statusTd = document.createElement("td");
          const badge = document.createElement("span");
          badge.className = "badge " + (svc.enabled ? "on" : "off");
          badge.textContent = svc.enabled ? "enabled" : "disabled";
          statusTd.appendChild(badge);

          const authTd = document.createElement("td");
          const authSpan = document.createElement("span");
          authSpan.className = "auth-mode";
          authSpan.textContent = svc.authMode === "cloudflare-access" ? "cf-access" : svc.authMode;
          authTd.appendChild(authSpan);

          const urlTd = document.createElement("td");
          const link = document.createElement("a");
          link.href = svc.publicUrl;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = svc.publicHost;
          urlTd.appendChild(link);

          const expiryTd = document.createElement("td");
          const expirySpan = document.createElement("span");
          expirySpan.className = "expiry";
          expirySpan.dataset.expiresAt = svc.expiresAt || "";
          expirySpan.dataset.enabled = svc.enabled ? "1" : "0";
          updateExpiryNode(expirySpan);
          if (svc.expiresAt) {
            const expiresAtDate = new Date(svc.expiresAt);
            if (!Number.isNaN(expiresAtDate.getTime())) {
              expirySpan.title = "at " + expiresAtDate.toLocaleString();
            }
          }
          expiryTd.appendChild(expirySpan);

          const controlsTd = document.createElement("td");
          const controls = document.createElement("div");
          controls.className = "controls";
          const expirySelect = document.createElement("select");
          [
            { value: 0.25, label: "15m" },
            { value: 0.5, label: "30m" },
            { value: 1, label: "1h" },
            { value: 2, label: "2h" },
            { value: 6, label: "6h" },
            { value: 12, label: "12h" },
            { value: 24, label: "24h" },
          ].forEach(function(item) {
            const opt = document.createElement("option");
            opt.value = String(item.value);
            opt.textContent = item.label;
            if (item.value === (svc.defaultExpiryHours || ${DEFAULT_EXPIRY_HOURS})) opt.selected = true;
            expirySelect.appendChild(opt);
          });

          const authSelect = document.createElement("select");
          const optNone = document.createElement("option");
          optNone.value = "none";
          optNone.textContent = "none";
          const optCfAccess = document.createElement("option");
          optCfAccess.value = "cloudflare-access";
          optCfAccess.textContent = "cf-access";
          authSelect.append(optNone, optCfAccess);
          authSelect.value = "none";

          const enableBtn = document.createElement("button");
          enableBtn.textContent = "Enable";
          enableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              enableBtn.disabled = true;
              disableBtn.disabled = true;
              expirySelect.disabled = true;
              authSelect.disabled = true;
              await request("/api/services/" + svc.id + "/enable", "POST", {
                hours: Number(expirySelect.value),
                authMode: authSelect.value,
              });
              setMsg("Enabled " + svc.id);
              await loadExposure({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          const disableBtn = document.createElement("button");
          disableBtn.textContent = "Disable";
          disableBtn.className = "danger";
          disableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              disableBtn.disabled = true;
              enableBtn.disabled = true;
              expirySelect.disabled = true;
              authSelect.disabled = true;
              await request("/api/services/" + svc.id + "/disable", "POST");
              setMsg("Disabled " + svc.id);
              await loadExposure({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          controls.append(expirySelect, authSelect, enableBtn, disableBtn);
          controlsTd.appendChild(controls);

          tr.append(serviceTd, statusTd, authTd, urlTd, expiryTd, controlsTd);
          rowsEl.appendChild(tr);
        }
        tickExpiryCountdowns();
      }

      function fmtAuditTime(ts) {
        if (!ts) return "";
        const d = new Date(ts);
        const pad = function(n) { return n < 10 ? "0" + n : n; };
        return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      }

      function renderAudit(entries) {
        auditRowsEl.innerHTML = "";
        if (entries.length === 0) {
          const tr = document.createElement("tr");
          tr.className = "empty-row";
          const td = document.createElement("td");
          td.colSpan = 4;
          td.textContent = "No audit entries yet.";
          tr.appendChild(td);
          auditRowsEl.appendChild(tr);
          return;
        }
        for (const [index, e] of entries.entries()) {
          const tr = document.createElement("tr");
          tr.style.setProperty("--row-index", String(index));
          const timeTd = document.createElement("td");
          timeTd.className = "audit-time";
          timeTd.textContent = fmtAuditTime(e.ts);
          const actionTd = document.createElement("td");
          actionTd.textContent = e.action || "";
          if (e.action === "enable") actionTd.className = "action-enable";
          else if (e.action === "disable") actionTd.className = "action-disable";
          else if (e.action === "emergency-disable-all") actionTd.className = "action-emergency";
          else if (e.action === "auto-expire") actionTd.className = "action-expire";
          else if (e.action === "transmission-vpn-set") actionTd.className = "action-enable";
          const svcTd = document.createElement("td");
          svcTd.className = "audit-svc";
          svcTd.textContent = e.serviceId || "";
          const detailsTd = document.createElement("td");
          detailsTd.className = "audit-detail";
          const parts = [];
          if (e.hours) parts.push(e.hours + "h");
          if (e.authMode) parts.push(e.authMode);
          if (e.mode) parts.push("mode: " + e.mode);
          if (e.disabled != null) parts.push("disabled: " + e.disabled);
          detailsTd.textContent = parts.join(" \\u00B7 ");
          tr.append(timeTd, actionTd, svcTd, detailsTd);
          auditRowsEl.appendChild(tr);
        }
      }

      function renderUpdates(payload) {
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        updatesRowsEl.innerHTML = "";
        if (items.length === 0) {
          const tr = document.createElement("tr");
          tr.className = "empty-row";
          const td = document.createElement("td");
          td.colSpan = 5;
          td.textContent = "No update rows available.";
          tr.appendChild(td);
          updatesRowsEl.appendChild(tr);
        } else {
          for (const [index, item] of items.entries()) {
            const tr = document.createElement("tr");
            tr.style.setProperty("--row-index", String(index));

            const serviceTd = document.createElement("td");
            const nameEl = document.createElement("div");
            nameEl.className = "svc-name";
            nameEl.textContent = item.name || item.id || "";
            const idEl = document.createElement("div");
            idEl.className = "svc-id";
            const nsPrefix = item.namespace ? item.namespace + "/" : "";
            idEl.textContent = nsPrefix + (item.id || "");
            serviceTd.append(nameEl, idEl);

            const currentTd = document.createElement("td");
            currentTd.className = "updates-version";
            currentTd.textContent = item.currentVersion || "\\u2014";

            const latestTd = document.createElement("td");
            latestTd.className = "updates-version";
            latestTd.textContent = item.latestVersion || "\\u2014";

            const statusTd = document.createElement("td");
            const chip = document.createElement("span");
            chip.className = "update-chip " + (item.status || "unknown");
            chip.textContent = String(item.statusText || "unknown").toLowerCase();
            statusTd.appendChild(chip);

            const imageTd = document.createElement("td");
            const imageEl = document.createElement("div");
            imageEl.className = "updates-version";
            imageEl.textContent = item.imageRepo || item.image || "\\u2014";
            const subEl = document.createElement("div");
            subEl.className = "updates-sub";
            const details = [];
            if (item.detail) details.push(item.detail);
            if (item.pod) details.push("pod/" + item.pod);
            subEl.textContent = details.join(" · ");
            imageTd.append(imageEl, subEl);

            tr.append(serviceTd, currentTd, latestTd, statusTd, imageTd);
            updatesRowsEl.appendChild(tr);
          }
        }

        const checkedAt = payload && payload.checkedAt ? new Date(payload.checkedAt) : null;
        const nextCheckAt = payload && payload.nextCheckAt ? new Date(payload.nextCheckAt) : null;
        const checkedText = checkedAt && !Number.isNaN(checkedAt.getTime())
          ? checkedAt.toLocaleString()
          : "not checked yet";
        const nextText = nextCheckAt && !Number.isNaN(nextCheckAt.getTime())
          ? nextCheckAt.toLocaleString()
          : "unknown";
        const source = payload && payload.source ? payload.source : "unknown";
        const staleText = payload && payload.stale ? " - stale cache" : "";
        const refreshingText = payload && payload.refreshInProgress ? " - background refresh running" : "";
        updatesMetaEl.textContent =
          "Checked: " + checkedText + " | Next check: " + nextText + " | Source: " + source + staleText + refreshingText;
      }

      async function loadTransmissionVpn(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) setVpnMsg("Refreshing Transmission VPN status...");
        try {
          const payload = await request("/api/transmission-vpn", "GET");
          renderTransmissionVpn(payload);
          if (!silent) {
            const verb = payload && payload.desiredMode === "vpn" ? "VPN" : "direct";
            setVpnMsg("Transmission desired route: " + verb);
          }
        } catch (err) {
          renderTransmissionVpn(null);
          setVpnMsg(err.message, true);
        }
      }

      async function loadExposure(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) setMsg("Refreshing...");
        try {
          const [svcData, auditData, vpnData] = await Promise.allSettled([
            request("/api/services", "GET"),
            request("/api/audit", "GET"),
            request("/api/transmission-vpn", "GET"),
          ]);

          if (svcData.status !== "fulfilled" || auditData.status !== "fulfilled") {
            const failure = svcData.status !== "fulfilled" ? svcData.reason : auditData.reason;
            throw failure;
          }

          renderRows(svcData.value.services || []);
          renderAudit(auditData.value.entries || []);
          if (vpnData.status === "fulfilled") {
            renderTransmissionVpn(vpnData.value);
            if (!silent) setVpnMsg("");
          } else {
            renderTransmissionVpn(null);
            setVpnMsg(vpnData.reason.message, true);
          }
          if (!silent) setMsg("Updated " + new Date().toLocaleTimeString());
        } catch (err) {
          setMsg(err.message, true);
        }
      }

      async function loadUpdates(options) {
        const force = Boolean(options && options.force);
        if (force) {
          setUpdatesMsg("Checking registries...");
        } else if (!updatesLoaded) {
          setUpdatesMsg("Loading cached update report...");
        }
        try {
          const path = force ? "/api/image-updates?force=1" : "/api/image-updates";
          const payload = await request(path, "GET");
          renderUpdates(payload);
          updatesLoaded = true;
          if (payload.error) {
            setUpdatesMsg("Showing cached data: " + payload.error, true);
          } else if (payload.stale) {
            setUpdatesMsg("Showing cached data while background refresh runs.");
          } else {
            setUpdatesMsg("Update report loaded.");
          }
        } catch (err) {
          setUpdatesMsg(err.message, true);
        }
      }

      refreshBtn.onclick = () => loadExposure();

      emergencyBtn.onclick = async () => {
        if (!confirm("Disable ALL temporary exposures?")) return;
        try {
          mutationInFlight += 1;
          emergencyBtn.disabled = true;
          await request("/api/admin/disable-all", "POST");
          setMsg("All exposures disabled");
          await loadExposure({ silent: true });
        } catch (err) {
          setMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          emergencyBtn.disabled = false;
        }
      };

      async function setTransmissionVpnMode(mode) {
        const nextMode = mode === "vpn" ? "vpn" : "direct";
        const prompt = nextMode === "vpn"
          ? "Route Transmission through the VPN sidecar?"
          : "Route Transmission directly through the normal network path?";
        if (!confirm(prompt)) return;
        try {
          mutationInFlight += 1;
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          setVpnMsg("Applying " + nextMode + " mode...");
          const payload = await request("/api/transmission-vpn", "POST", {
            mode: nextMode,
          });
          renderTransmissionVpn(payload);
          setVpnMsg(
            "Transmission desired route set to " +
              nextMode +
              ". Flux will roll the pod if needed.",
          );
          await loadExposure({ silent: true });
        } catch (err) {
          setVpnMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          if (transmissionVpnState) renderTransmissionVpn(transmissionVpnState);
        }
      }

      vpnDirectBtn.onclick = function() {
        setTransmissionVpnMode("direct");
      };

      vpnEnableBtn.onclick = function() {
        setTransmissionVpnMode("vpn");
      };

      updatesRefreshBtn.onclick = function() {
        loadUpdates({ force: true });
      };

      setInterval(tickExpiryCountdowns, 1000);
      loadExposure();
      if (window.location.hash === "#updates") {
        setActiveTab("updates");
      } else {
        setActiveTab("exposure");
      }
    </script>
  </body>
</html>`;
}

function renderCombinedCockpitHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>rangoonpulse operator cockpit</title>
    <style>
      :root {
        --bg-base: #060606;
        --bg-panel: rgba(255, 255, 255, 0.018);
        --bg-panel-strong: rgba(255, 255, 255, 0.028);
        --bg-hover: rgba(255, 255, 255, 0.035);
        --text-1: #ededed;
        --text-2: #8e8e8e;
        --text-3: #626262;
        --text-dim: #5f5f5f;
        --border: rgba(255, 255, 255, 0.08);
        --border-strong: rgba(255, 255, 255, 0.16);
        --accent: #1f6feb;
        --green: #34d399;
        --yellow: #fbbf24;
        --red: #fb7185;
        --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      html {
        min-height: 100%;
        background: #050505;
      }
      body {
        min-height: 100vh;
        background:
          linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
          radial-gradient(900px 420px at 50% -15%, rgba(31, 111, 235, 0.08), transparent 62%),
          linear-gradient(180deg, #040404 0%, var(--bg-base) 48%, #050505 100%);
        background-size: 148px 148px, 148px 148px, auto, auto;
        background-position: -1px -1px, -1px -1px, center top, center;
        background-attachment: fixed, fixed, fixed;
        color: var(--text-1);
        font-family: var(--font-sans);
        font-size: 13px;
        line-height: 1.5;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      button,
      input,
      select {
        font: inherit;
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        border-bottom: 1px solid var(--border);
        background: rgba(5, 5, 5, 0.92);
        backdrop-filter: blur(8px);
      }
      .topbar-inner,
      main {
        max-width: 1360px;
        margin: 0 auto;
      }
      .topbar-inner {
        padding: 14px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
      }
      .crumbs {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text-2);
      }
      .brand-mark {
        width: 22px;
        height: 22px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-1);
        font-size: 11px;
      }
      .env-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 999px;
        background: transparent;
        text-transform: lowercase;
        color: var(--text-2);
        font-size: 11px;
      }
      .top-actions,
      .section-nav,
      .toolbar-left,
      .toolbar-right,
      .filter-group,
      .controls,
      .notes-cell,
      .policy-grid {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      button,
      .control-select,
      .search-shell {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.01);
        color: var(--text-1);
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      button {
        min-height: 38px;
        padding: 0 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      button {
        cursor: pointer;
        border-radius: 4px;
      }
      button:hover,
      .control-select:hover,
      .search-shell:hover,
      .search-shell:focus-within {
        border-color: var(--border-strong);
        background: var(--bg-hover);
      }
      .nav-pill {
        display: inline-flex;
        align-items: center;
        min-height: auto;
        padding: 0 0 10px;
        border: none;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        justify-content: flex-start;
        color: var(--text-2);
        position: relative;
        line-height: 1.2;
      }
      .nav-pill:hover {
        color: var(--text-1);
      }
      .nav-pill.active {
        color: var(--text-1);
      }
      .nav-pill::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 1px;
        background: transparent;
      }
      .nav-pill.active::after {
        background: var(--accent);
      }
      button.danger {
        color: #ffd5dc;
        border-color: rgba(251, 113, 133, 0.22);
      }
      button.mode-active,
      button.filter-btn.active {
        border-color: rgba(31, 111, 235, 0.45);
        background: rgba(31, 111, 235, 0.08);
        color: var(--text-1);
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      main {
        padding: 28px 24px 56px;
      }
      .hero {
        display: block;
        margin-bottom: 30px;
      }
      .hero h1 {
        font-size: 38px;
        letter-spacing: -0.04em;
        line-height: 1;
        font-weight: 500;
      }
      .hero-subtitle,
      .section-copy,
      .muted,
      .msg,
      .result-count,
      .overview-meta,
      .workload-meta,
      .updates-meta,
      .support-copy,
      .focus-inline,
      .vpn-meta {
        color: var(--text-2);
      }
      .hero-subtitle {
        margin-top: 10px;
        max-width: 760px;
      }
      .section {
        background: transparent;
        border: none;
        margin-bottom: 40px;
        overflow: visible;
      }
      .section[hidden] {
        display: none;
      }
      .section-bar,
      .overview-meta-row,
      .toolbar,
      .panel-actions,
      .updates-toolbar,
      .vpn-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: center;
        padding: 0 0 16px;
        border-bottom: 1px solid var(--border);
      }
      .section-nav {
        gap: 18px;
        margin-bottom: 34px;
        padding-bottom: 2px;
        border-bottom: 1px solid var(--border);
      }
      .section-heading {
        font-size: 18px;
        font-weight: 500;
        letter-spacing: -0.02em;
        text-transform: lowercase;
      }
      .section-detail {
        color: var(--text-2);
        text-align: right;
      }
      .overview-strip {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-panel);
        overflow: hidden;
      }
      .overview-segment {
        padding: 26px 28px;
        border-right: 1px solid var(--border);
        min-height: 186px;
      }
      .overview-segment:last-child {
        border-right: none;
      }
      .overview-segment-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }
      .overview-label,
      .overview-eyebrow,
      .support-card-title,
      .focus-card-title {
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 11px;
        font-family: var(--font-mono);
      }
      .overview-value {
        margin-top: 18px;
        font-size: 40px;
        line-height: 1;
        letter-spacing: -0.04em;
        font-weight: 300;
      }
      .overview-subtitle {
        margin-top: 12px;
        min-height: 40px;
        color: var(--text-2);
      }
      .overview-meter {
        margin-top: 28px;
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      .overview-meter-fill {
        display: block;
        height: 100%;
        background: var(--accent);
      }
      .overview-meter-fill.ok,
      .overview-meter-fill.status {
        background: var(--green);
      }
      .overview-meter-fill.warning {
        background: var(--yellow);
      }
      .overview-meter-fill.danger {
        background: var(--red);
      }
      .overview-meta-row {
        border-bottom: none;
        align-items: flex-start;
        padding: 16px 0 0;
      }
      .overview-meta-cluster {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        color: var(--text-2);
      }
      .content-block {
        padding: 18px 0 22px;
      }
      .toolbar {
        padding-top: 18px;
      }
      .control-select {
        min-height: 38px;
        padding: 0 12px;
        border-radius: 4px;
      }
      .search-shell {
        min-height: 38px;
        padding: 0 12px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .input-prefix {
        color: var(--text-dim);
        font-family: var(--font-mono);
      }
      .search-shell input {
        min-width: 220px;
        border: none;
        background: transparent;
        color: var(--text-1);
        outline: none;
      }
      .planner-grid,
      .focus-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-panel);
        overflow: hidden;
      }
      .support-card,
      .vpn-card {
        border: none;
        border-radius: 0;
        background: transparent;
      }
      .support-card {
        padding: 20px 24px;
        border-right: 1px solid var(--border);
      }
      .support-card:last-child {
        border-right: none;
      }
      .focus-list {
        list-style: none;
        display: grid;
        gap: 10px;
      }
      .focus-path {
        display: block;
        color: var(--text-1);
        font-family: var(--font-mono);
      }
      .table-shell,
      .updates-scroll,
      .audit-scroll,
      .terminal-shell {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg-panel);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 12px 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        vertical-align: top;
      }
      th {
        position: sticky;
        top: 0;
        background: rgba(8, 8, 8, 0.98);
        color: var(--text-2);
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 11px;
        font-weight: 400;
        font-family: var(--font-mono);
      }
      .badge,
      .status-chip,
      .update-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        border: none;
        background: transparent;
        font-weight: 500;
      }
      .badge::before,
      .status-chip::before,
      .update-chip::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.02);
      }
      .badge.on,
      .status-chip.ok {
        color: var(--green);
      }
      .badge.off,
      .status-chip.danger {
        color: var(--red);
      }
      .status-chip.warning {
        color: var(--yellow);
      }
      .stat-pills {
        display: flex;
        gap: 24px;
        align-items: center;
        flex-wrap: wrap;
      }
      .note-pill,
      .stat-pill {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--text-2);
        text-transform: lowercase;
      }
      .note-pill.guarded,
      .stat-pill.guarded {
        color: var(--yellow);
      }
      .note-pill.excluded,
      .stat-pill.excluded {
        color: var(--red);
      }
      .stat-pill.ok {
        color: var(--green);
      }
      .stat-pill strong {
        color: var(--text-1);
        font-weight: 500;
      }
      .svc-name,
      .vpn-title,
      .workload {
        font-weight: 600;
      }
      .svc-id,
      .updates-version,
      .updates-sub,
      .auth-mode,
      .audit-time,
      .audit-detail {
        font-size: 12px;
      }
      .metric-pair,
      .usage-line,
      .workload-meta,
      .focus-path {
        font-size: 12px;
        font-family: var(--font-sans);
      }
      .svc-id,
      .updates-version,
      .updates-sub,
      .audit-time,
      .audit-detail {
        font-family: var(--font-mono);
      }
      .metric-pair {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .arrow {
        color: var(--text-dim);
      }
      .metric-delta.positive,
      .action.upsize,
      .update-chip.current {
        color: var(--green);
      }
      .metric-delta.negative,
      .action.downsize,
      .update-chip.not-installed {
        color: var(--red);
      }
      .update-chip.update {
        color: var(--yellow);
      }
      .update-chip.unknown,
      .update-chip.external {
        color: var(--text-2);
      }
      .expiry.urgent {
        color: var(--yellow);
      }
      .expiry.expired {
        color: var(--red);
      }
      .vpn-card {
        padding: 20px 0 0;
      }
      .msg {
        min-height: 18px;
      }
      .terminal-shell {
        background: #090909;
      }
      .terminal-content {
        padding: 18px;
        display: grid;
        gap: 10px;
      }
      tr:hover td {
        background: rgba(255, 255, 255, 0.014);
      }
      .log-line {
        display: grid;
        grid-template-columns: 42px 44px 1fr;
        gap: 12px;
        font-family: var(--font-mono);
        color: var(--text-2);
      }
      .log-time,
      .log-level {
        color: var(--text-dim);
      }
      .log-level.log-info {
        color: var(--accent);
      }
      .empty-state {
        padding: 28px;
        text-align: center;
        color: var(--text-2);
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
        }
      }
      @media (max-width: 980px) {
        .topbar-inner,
        .hero,
        .section-bar,
        .overview-meta-row,
        .toolbar,
        .panel-actions,
        .updates-toolbar,
        .vpn-row,
        .toolbar-left,
        .toolbar-right,
        .top-actions {
          flex-direction: column;
          align-items: flex-start;
        }
        .overview-strip,
        .planner-grid,
        .focus-grid {
          grid-template-columns: 1fr;
        }
        .overview-segment {
          border-right: none;
          border-bottom: 1px solid var(--border);
        }
        .overview-segment:last-child {
          border-bottom: none;
        }
        .support-card {
          border-right: none;
          border-bottom: 1px solid var(--border);
        }
        .support-card:last-child {
          border-bottom: none;
        }
      }
      @media (max-width: 820px) {
        .topbar-inner {
          padding: 12px 14px;
        }
        main {
          padding: 22px 14px 44px;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="crumbs">
          <span class="brand-mark">A</span>
          <span>/</span>
          <span>rangoonpulse</span>
          <span class="env-pill">production</span>
        </div>
        <div class="top-actions">
          <button id="refreshAllBtn" type="button">Refresh all</button>
          <button id="emergencyBtn" class="danger" type="button">Disable all exposures</button>
        </div>
      </div>
    </header>
    <main>
      <section class="hero">
        <div>
          <h1>operator cockpit</h1>
          <div class="hero-subtitle">
            One operator surface for exposure controls, transmission routing, image checks, and resource tuning.
            Backends remain separate: exposure-control owns write actions, resource-advisor stays the tuning/report backend.
          </div>
        </div>
      </section>

      <nav class="section-nav" aria-label="Section navigation">
        <a class="nav-pill" data-page-link href="#overview">overview</a>
        <a class="nav-pill" data-page-link href="#tuning">tuning</a>
        <a class="nav-pill" data-page-link href="#exposure">exposure</a>
        <a class="nav-pill" data-page-link href="#transmission">transmission</a>
        <a class="nav-pill" data-page-link href="#updates">image updates</a>
        <a class="nav-pill" data-page-link href="#audit">audit</a>
      </nav>

      <section id="overview" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">overview</h2>
            <p class="section-copy">Current operator posture across both backends.</p>
          </div>
          <div id="loadState" class="result-count">Loading dashboard state...</div>
        </div>
        <div id="overviewStrip" class="overview-strip"></div>
        <div class="overview-meta-row">
          <div id="overviewMeta" class="overview-meta-cluster"></div>
          <div id="overviewDetail" class="result-count"></div>
        </div>
      </section>

      <section id="tuning" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">tuning</h2>
            <p class="section-copy">Resource-advisor recommendations and live apply preflight, inside the shared cockpit.</p>
          </div>
          <div id="tuningSummary" class="section-detail">Waiting for advisor data...</div>
        </div>
        <div class="content-block">
          <div id="tuningStatPills" class="stat-pills"></div>
        </div>
        <div class="content-block" style="padding-top:0">
          <div id="plannerGrid" class="planner-grid"></div>
        </div>
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="filter-group" role="tablist" aria-label="Tuning action filters">
              <button class="filter-btn active" type="button" data-filter-action="all">all</button>
              <button class="filter-btn" type="button" data-filter-action="upsize">upsize</button>
              <button class="filter-btn" type="button" data-filter-action="downsize">downsize</button>
              <button class="filter-btn" type="button" data-filter-action="no-change">no change</button>
            </div>
            <select id="noteFilter" class="control-select" aria-label="Tuning note filter">
              <option value="all">all notes</option>
            </select>
          </div>
          <div class="toolbar-right">
            <label class="search-shell">
              <span class="input-prefix">&gt;</span>
              <input id="searchInput" type="search" placeholder="Filter workloads..." />
            </label>
            <div id="tuningCount" class="result-count">0 visible rows</div>
          </div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>workload</th>
                <th>action</th>
                <th>cpu request</th>
                <th>memory request</th>
                <th>observed usage</th>
                <th>restart signal</th>
                <th>notes</th>
              </tr>
            </thead>
            <tbody id="tuningRows"></tbody>
          </table>
          <div id="tuningEmpty" class="empty-state" hidden>No rows match the current filters.</div>
        </div>
        <div class="content-block">
          <div class="section-bar" style="padding:0 0 14px;border-bottom:none">
            <div>
              <h3 class="section-heading">system output</h3>
              <p class="section-copy">Recent markdown lines from the runtime-owned advisor report.</p>
            </div>
            <div id="tuningRuntimeMeta" class="section-detail"></div>
          </div>
          <div class="terminal-shell">
            <div id="runtimeLines" class="terminal-content"></div>
          </div>
        </div>
      </section>

      <section id="exposure" class="section">
        <div class="panel-actions">
          <div>
            <h2 class="section-heading">exposure</h2>
            <p class="section-copy">Temporary public exposure control on ${SHARE_HOST_PREFIX}&lt;id&gt;.${PUBLIC_DOMAIN} with ${DEFAULT_EXPIRY_HOURS}h default expiry.</p>
          </div>
          <div id="exposureMeta" class="section-detail"></div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>service</th>
                <th>status</th>
                <th>auth</th>
                <th>public url</th>
                <th>expires</th>
                <th>controls</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <div class="content-block">
          <div id="msg" class="msg"></div>
        </div>
      </section>

      <section id="transmission" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">transmission</h2>
            <p class="section-copy">Route Transmission directly or through the Gluetun VPN sidecar.</p>
          </div>
          <div id="vpnSectionMeta" class="section-detail"></div>
        </div>
        <div class="vpn-card">
          <div class="vpn-row">
            <div>
              <div class="vpn-title">Transmission Egress</div>
              <div id="vpnMeta" class="vpn-meta">Loading Transmission VPN status...</div>
              <div class="vpn-meta">
                Gluetun WebUI:
                <a href="${escapeHtml(TRANSMISSION_VPN_WEBUI_URL)}" target="_blank" rel="noreferrer">open dashboard</a>
              </div>
            </div>
            <div class="controls">
              <button id="vpnDirectBtn" type="button">Route Direct</button>
              <button id="vpnEnableBtn" type="button">Route via VPN</button>
            </div>
          </div>
          <div id="vpnMsg" class="msg"></div>
        </div>
      </section>

      <section id="updates" class="section">
        <div class="updates-toolbar">
          <div>
            <h2 class="section-heading">image updates</h2>
            <div id="updatesMeta" class="updates-meta">No update check yet.</div>
          </div>
          <button id="updatesRefreshBtn" type="button">Check Now</button>
        </div>
        <div class="updates-scroll">
          <table>
            <thead>
              <tr>
                <th>service</th>
                <th>current</th>
                <th>latest</th>
                <th>status</th>
                <th>image</th>
              </tr>
            </thead>
            <tbody id="updatesRows"></tbody>
          </table>
        </div>
        <div class="content-block">
          <div id="updatesMsg" class="msg"></div>
        </div>
      </section>

      <section id="audit" class="section">
        <div class="section-bar">
          <div>
            <h2 class="section-heading">audit</h2>
            <p class="section-copy">Recent exposure and transmission control actions.</p>
          </div>
          <div id="auditMeta" class="section-detail"></div>
        </div>
        <div class="audit-scroll">
          <table>
            <thead>
              <tr>
                <th>time</th>
                <th>action</th>
                <th>service</th>
                <th>details</th>
              </tr>
            </thead>
            <tbody id="auditRows"></tbody>
          </table>
        </div>
      </section>
    </main>
    <script>
      const loadStateEl = document.getElementById('loadState');
      const overviewStripEl = document.getElementById('overviewStrip');
      const overviewMetaEl = document.getElementById('overviewMeta');
      const overviewDetailEl = document.getElementById('overviewDetail');
      const tuningSummaryEl = document.getElementById('tuningSummary');
      const tuningStatPillsEl = document.getElementById('tuningStatPills');
      const plannerGridEl = document.getElementById('plannerGrid');
      const noteFilterEl = document.getElementById('noteFilter');
      const searchInputEl = document.getElementById('searchInput');
      const tuningCountEl = document.getElementById('tuningCount');
      const tuningRowsEl = document.getElementById('tuningRows');
      const tuningEmptyEl = document.getElementById('tuningEmpty');
      const runtimeLinesEl = document.getElementById('runtimeLines');
      const tuningRuntimeMetaEl = document.getElementById('tuningRuntimeMeta');
      const exposureMetaEl = document.getElementById('exposureMeta');
      const vpnSectionMetaEl = document.getElementById('vpnSectionMeta');
      const auditMetaEl = document.getElementById('auditMeta');
      const rowsEl = document.getElementById('rows');
      const auditRowsEl = document.getElementById('auditRows');
      const updatesRowsEl = document.getElementById('updatesRows');
      const vpnMetaEl = document.getElementById('vpnMeta');
      const msgEl = document.getElementById('msg');
      const vpnMsgEl = document.getElementById('vpnMsg');
      const updatesMsgEl = document.getElementById('updatesMsg');
      const updatesMetaEl = document.getElementById('updatesMeta');
      const refreshAllBtn = document.getElementById('refreshAllBtn');
      const emergencyBtn = document.getElementById('emergencyBtn');
      const vpnDirectBtn = document.getElementById('vpnDirectBtn');
      const vpnEnableBtn = document.getElementById('vpnEnableBtn');
      const updatesRefreshBtn = document.getElementById('updatesRefreshBtn');
      const pageSections = Array.from(document.querySelectorAll('main > section.section'));
      const pageLinks = Array.from(document.querySelectorAll('[data-page-link]'));

      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let transmissionVpnState = null;
      let tuningFilterAction = 'all';
      let dashboardState = {
        services: [],
        audit: [],
        vpn: null,
        updates: null,
        tuning: null,
      };

      function setMessage(target, text, isError) {
        target.textContent = text || '';
        target.style.color = isError ? 'var(--red)' : 'var(--text-2)';
      }

      function setLoadState(text, isError) {
        setMessage(loadStateEl, text, isError);
      }

      function setMsg(text, isError) {
        setMessage(msgEl, text, isError);
      }

      function setVpnMsg(text, isError) {
        setMessage(vpnMsgEl, text, isError);
      }

      function setUpdatesMsg(text, isError) {
        setMessage(updatesMsgEl, text, isError);
      }

      function normalizePage(value) {
        const candidate = String(value || '').replace(/^#/, '').trim().toLowerCase();
        const knownPages = new Set(['overview', 'tuning', 'exposure', 'transmission', 'updates', 'audit']);
        if (knownPages.has(candidate)) return candidate;
        return 'overview';
      }

      function setActivePage(page, options) {
        const nextPage = normalizePage(page);
        const replace = Boolean(options && options.replace);
        pageSections.forEach((section) => {
          section.hidden = section.id !== nextPage;
        });
        pageLinks.forEach((link) => {
          const target = normalizePage(link.getAttribute('href'));
          link.classList.toggle('active', target === nextPage);
        });
        const nextHash = '#' + nextPage;
        if (replace) {
          history.replaceState(null, '', nextHash);
        } else if (window.location.hash !== nextHash) {
          history.pushState(null, '', nextHash);
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
      }

      function fmtDateTime(value) {
        if (!value) return 'n/a';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return 'n/a';
        return d.toLocaleString();
      }

      function fmtExpiry(value) {
        if (!value) return { text: '\\u2014', state: 'none' };
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return { text: 'invalid', state: 'invalid' };
        const diff = d.getTime() - Date.now();
        if (diff <= 0) return { text: 'expired', state: 'expired' };
        const totalSeconds = Math.ceil(diff / 1000);
        if (totalSeconds < 60) return { text: totalSeconds + 's remaining', state: 'urgent' };
        const mins = Math.ceil(totalSeconds / 60);
        if (mins < 60) return { text: mins + 'm remaining', state: mins <= 10 ? 'urgent' : 'active' };
        const hrs = Math.floor(mins / 60);
        const rm = mins % 60;
        return { text: rm ? hrs + 'h ' + rm + 'm remaining' : hrs + 'h remaining', state: mins <= 120 ? 'urgent' : 'active' };
      }

      function updateExpiryNode(node) {
        const next = fmtExpiry(node.dataset.expiresAt || '');
        node.textContent = next.text;
        node.classList.toggle('urgent', next.state === 'urgent');
        node.classList.toggle('expired', next.state === 'expired');
        return next.state;
      }

      function tickExpiryCountdowns() {
        let shouldRefresh = false;
        rowsEl.querySelectorAll('.expiry[data-expires-at]').forEach((node) => {
          const state = updateExpiryNode(node);
          if (node.dataset.enabled === '1' && state === 'expired') shouldRefresh = true;
        });
        if (shouldRefresh && mutationInFlight === 0 && !pendingExpiryRefresh) {
          pendingExpiryRefresh = true;
          setTimeout(async () => {
            try {
              await loadDashboard({ silent: true });
            } finally {
              pendingExpiryRefresh = false;
            }
          }, 300);
        }
      }

      async function request(path, method, body) {
        const res = await fetch(path, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'request failed');
        return data;
      }

      function withUnitSpace(value) {
        const text = String(value || '');
        const match = text.match(/^([+-]?\\d+(?:\\.\\d+)?)([A-Za-z]+)$/);
        if (!match) return text || '\\u2014';
        return match[1] + ' ' + match[2];
      }

      function fmtSigned(value, suffix, digits) {
        const number = Number(value || 0);
        const fixed = number.toFixed(Number.isFinite(digits) ? digits : 1).replace(/\\.0+$/, '').replace(/(\\.\\d*?)0+$/, '$1');
        return (number > 0 ? '+' : '') + fixed + suffix;
      }

      function noteTone(note) {
        const value = String(note || '').toLowerCase();
        if (value.includes('excluded')) return 'excluded';
        if (value.includes('guard')) return 'guarded';
        return 'neutral';
      }

      function statPill(label, value, tone) {
        return '<span class="stat-pill ' + (tone || 'neutral') + '"><span>' + label + '</span><strong>' + value + '</strong></span>';
      }

      function overviewSegment(label, value, subtitle, options) {
        const eyebrow = options && options.eyebrow ? '<span class="overview-eyebrow">' + options.eyebrow + '</span>' : '';
        const barPct = Math.max(0, Math.min(100, Number(options && options.barPct || 0)));
        const tone = options && options.tone ? options.tone : 'neutral';
        return (
          '<section class="overview-segment">' +
            '<div class="overview-segment-head"><span class="overview-label">' + label + '</span>' + eyebrow + '</div>' +
            '<div class="overview-value">' + value + '</div>' +
            '<div class="overview-subtitle">' + subtitle + '</div>' +
            '<div class="overview-meter"><span class="overview-meter-fill ' + tone + '" style="width:' + barPct.toFixed(1) + '%"></span></div>' +
          '</section>'
        );
      }

      function renderOverview() {
        const services = dashboardState.services || [];
        const updates = dashboardState.updates || null;
        const tuning = dashboardState.tuning || null;
        const vpn = dashboardState.vpn || null;
        const activeExposures = services.filter((svc) => svc.enabled).length;
        const updateItems = updates && Array.isArray(updates.items) ? updates.items : [];
        const updatesAvailable = updateItems.filter((item) => item && item.status === 'update').length;
        const selectedNow = tuning && tuning.applyPreflight ? Number(tuning.applyPreflight.selectedCount || 0) : 0;
        const recommendations = tuning && tuning.report ? Number(tuning.report.recommendationCount || 0) : 0;
        const hardFitOk = tuning && tuning.applyPreflight ? Boolean(tuning.applyPreflight.hardFitOk) : false;
        const fetchState = tuning && tuning.fetch ? tuning.fetch.state : 'degraded';
        const fetchDetail = tuning && tuning.fetch ? tuning.fetch.detail : 'resource-advisor unavailable';
        const desiredMode = vpn && vpn.desiredMode ? vpn.desiredMode : 'unknown';
        const runningMode = vpn && vpn.effectiveMode ? vpn.effectiveMode : 'unknown';

        overviewStripEl.innerHTML =
          overviewSegment('exposures', String(activeExposures), services.length + ' configured share targets', {
            eyebrow: 'temporary public',
            barPct: services.length ? activeExposures / services.length * 100 : 0,
            tone: activeExposures > 0 ? 'warning' : 'status',
          }) +
          overviewSegment('transmission', desiredMode, 'running ' + runningMode, {
            eyebrow: 'desired route',
            barPct: desiredMode === 'vpn' ? 100 : 35,
            tone: desiredMode === 'vpn' ? 'warning' : 'status',
          }) +
          overviewSegment('planner', String(selectedNow), recommendations + ' recommendations in current report', {
            eyebrow: 'selected now',
            barPct: recommendations ? selectedNow / recommendations * 100 : 0,
            tone: hardFitOk ? 'status' : 'warning',
          }) +
          overviewSegment('image updates', String(updatesAvailable), updateItems.length ? updateItems.length + ' tracked workloads' : 'cached report unavailable', {
            eyebrow: 'updates available',
            barPct: updateItems.length ? updatesAvailable / updateItems.length * 100 : 0,
            tone: updatesAvailable > 0 ? 'warning' : 'status',
          }) +
          overviewSegment('advisor fetch', fetchState, fetchDetail, {
            eyebrow: 'resource-advisor',
            barPct: fetchState === 'live' ? 100 : 25,
            tone: fetchState === 'live' ? 'status' : 'danger',
          });

        const meta = [];
        if (tuning && tuning.fetch) {
          meta.push('<span>advisor run ' + fmtDateTime(tuning.fetch.lastRunAt) + '</span>');
          meta.push('<span>advisor mode ' + (tuning.fetch.mode || 'n/a') + '</span>');
        }
        if (updates && updates.checkedAt) meta.push('<span>updates checked ' + fmtDateTime(updates.checkedAt) + '</span>');
        if (vpn) meta.push('<span>transmission desired ' + desiredMode + '</span>');
        overviewMetaEl.innerHTML = meta.join('');
        overviewDetailEl.textContent = fetchDetail;
        exposureMetaEl.textContent = activeExposures + ' active exposure' + (activeExposures === 1 ? '' : 's');
        vpnSectionMetaEl.textContent = vpn ? ('desired ' + desiredMode + ' · running ' + runningMode) : 'status unavailable';
        auditMetaEl.textContent = (dashboardState.audit || []).length + ' recent entries';
      }

      function renderTransmissionVpn(status) {
        transmissionVpnState = status || null;
        if (!status) {
          vpnMetaEl.textContent = 'Transmission VPN status unavailable.';
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          vpnDirectBtn.classList.remove('mode-active');
          vpnEnableBtn.classList.remove('mode-active');
          return;
        }
        const desiredMode = status.desiredMode || 'direct';
        const effectiveMode = status.effectiveMode || 'pending';
        const meta = [
          'desired: ' + desiredMode,
          'running: ' + effectiveMode,
          'default: ' + (status.defaultMode || 'direct'),
          'provider: ' + (status.provider || 'custom') + '/' + (status.vpnType || 'wireguard'),
        ];
        if (status.podName) meta.push('pod/' + status.podName);
        if (status.rolloutPending) meta.push('rollout pending');
        if (status.placeholderConfig) meta.push('placeholder credentials scaffolded');
        vpnMetaEl.textContent = meta.join(' | ');
        vpnDirectBtn.disabled = mutationInFlight > 0 || desiredMode === 'direct';
        vpnEnableBtn.disabled = mutationInFlight > 0 || desiredMode === 'vpn';
        vpnDirectBtn.classList.toggle('mode-active', desiredMode === 'direct');
        vpnEnableBtn.classList.toggle('mode-active', desiredMode === 'vpn');
      }

      function renderPlanner(tuning) {
        if (!tuning || !tuning.applyPreflight || !tuning.report) {
          tuningSummaryEl.textContent = 'Advisor data unavailable';
          tuningStatPillsEl.innerHTML = '';
          plannerGridEl.innerHTML = '<article class="support-card"><div class="support-card-title">apply preflight</div><p class="support-copy">resource-advisor data is unavailable from the exporter.</p></article>';
          tuningRuntimeMetaEl.textContent = 'advisor unavailable';
          runtimeLinesEl.innerHTML = '<div class="log-line"><span class="log-time">[00]</span><span class="log-level">data</span><span>no advisor markdown available.</span></div>';
          noteFilterEl.innerHTML = '<option value="all">all notes</option>';
          tuningRowsEl.innerHTML = '';
          tuningEmptyEl.hidden = false;
          tuningCountEl.textContent = '0 visible rows';
          return;
        }

        const report = tuning.report;
        const apply = tuning.applyPreflight;
        const summary = report.summary || {};
        const selected = Array.isArray(apply.selected) ? apply.selected : [];
        const skipSummary = Array.isArray(apply.skipSummary) ? apply.skipSummary : [];
        const budgets = apply.budgets || {};
        const current = apply.currentRequests || {};
        const projected = apply.projectedRequestsAfterSelected || {};
        const noteOptions = Array.isArray(report.topNotes) ? report.topNotes : [];

        tuningSummaryEl.textContent = String(report.recommendationCount || 0) + ' recommendations · ' + String(apply.selectedCount || 0) + ' selected now';
        tuningStatPillsEl.innerHTML =
          statPill('hard fit', apply.hardFitOk ? 'ok' : 'blocked', apply.hardFitOk ? 'ok' : 'excluded') +
          statPill('cpu pressure', apply.advisoryPressure && apply.advisoryPressure.cpu ? 'on' : 'off', apply.advisoryPressure && apply.advisoryPressure.cpu ? 'guarded' : 'ok') +
          statPill('mem pressure', apply.advisoryPressure && apply.advisoryPressure.memory ? 'on' : 'off', apply.advisoryPressure && apply.advisoryPressure.memory ? 'guarded' : 'ok') +
          statPill('coverage', String(report.metricsCoverageDaysEstimate || 0).replace(/\\.0$/, '') + 'd', 'neutral') +
          statPill('upsize', String(summary.upsize_count || 0), 'ok') +
          statPill('downsize', String(summary.downsize_count || 0), 'neutral');

        const selectedMarkup = selected.slice(0, 5).map((item) => {
          const currentReq = item && item.current && item.current.requests ? item.current.requests : {};
          const recommendedReq = item && item.recommended && item.recommended.requests ? item.recommended.requests : {};
          return '<li><span class="focus-path">' + (item.release || 'unknown') + '/' + (item.container || 'main') + '</span><span class="focus-inline">cpu ' + withUnitSpace(currentReq.cpu || '0m') + ' → ' + withUnitSpace(recommendedReq.cpu || '0m') + ' · mem ' + withUnitSpace(currentReq.memory || '0Mi') + ' → ' + withUnitSpace(recommendedReq.memory || '0Mi') + ' · ' + String(item.selection_reason || 'selected').replace(/_/g, ' ') + '</span></li>';
        }).join('');

        const postureMarkup = [
          '<li><span class="focus-path">current requests</span><span class="focus-inline">cpu ' + withUnitSpace((current.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((current.memory_mi || 0) + 'Mi') + '</span></li>',
          '<li><span class="focus-path">projected after selection</span><span class="focus-inline">cpu ' + withUnitSpace((projected.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((projected.memory_mi || 0) + 'Mi') + '</span></li>',
          '<li><span class="focus-path">advisory ceilings</span><span class="focus-inline">cpu ' + withUnitSpace((budgets.cpu_m || 0) + 'm') + ' · mem ' + withUnitSpace((budgets.memory_mi || 0) + 'Mi') + '</span></li>'
        ].join('');

        const skippedMarkup = skipSummary.slice(0, 5).map((item) => {
          return '<li><span class="focus-path">' + String(item.reason || 'unknown').replace(/_/g, ' ') + '</span><span class="focus-inline">' + String(item.count || 0) + ' row(s)</span></li>';
        }).join('');

        plannerGridEl.innerHTML =
          '<article class="support-card"><div class="support-card-title">if apply ran now</div><ul class="focus-list">' + (selectedMarkup || '<li><span class="muted">no changes would be selected from the current report.</span></li>') + '</ul><p class="support-copy">selection uses per-service signals, hard node-fit blocking, and advisory cluster pressure for ordering only.</p></article>' +
          '<article class="support-card"><div class="support-card-title">planner posture</div><ul class="focus-list">' + postureMarkup + '</ul><p class="support-copy">advisory pressure remains visible, but hard node-fit stays the gate.</p></article>' +
          '<article class="support-card"><div class="support-card-title">skip summary</div><ul class="focus-list">' + (skippedMarkup || '<li><span class="muted">no skipped rows in current snapshot.</span></li>') + '</ul><p class="support-copy">current reasons rows were deferred from the live apply selection order.</p></article>';

        noteFilterEl.innerHTML = '<option value="all">all notes</option>' + noteOptions.map((item) => '<option value="' + item.note + '">' + item.note + ' (' + item.count + ')</option>').join('');
        tuningRuntimeMetaEl.textContent = 'window ' + (report.metricsWindow || 'n/a') + ' · last run ' + fmtDateTime(tuning.fetch && tuning.fetch.lastRunAt);
        const runtimeLines = String(tuning.runtime && tuning.runtime.latestMarkdown || '').split('\\n').map((line) => line.trim()).filter(Boolean).slice(0, 18);
        runtimeLinesEl.innerHTML = runtimeLines.length ? runtimeLines.map((line, index) => '<div class="log-line"><span class="log-time">[' + String(index + 1).padStart(2, '0') + ']</span><span class="log-level ' + (index < 4 ? 'log-info' : '') + '">' + (index < 4 ? 'info' : 'data') + '</span><span>' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></div>').join('') : '<div class="log-line"><span class="log-time">[00]</span><span class="log-level">data</span><span>no advisor markdown available.</span></div>';
      }

      function renderTuningRows() {
        const tuning = dashboardState.tuning;
        const rows = tuning && tuning.report && Array.isArray(tuning.report.recommendations) ? tuning.report.recommendations : [];
        tuningRowsEl.innerHTML = '';
        const query = (searchInputEl.value || '').trim().toLowerCase();
        const noteValue = noteFilterEl.value || 'all';
        let visible = 0;

        rows.forEach((row) => {
          const notes = Array.isArray(row.notes) ? row.notes : [];
          const action = String(row.action || 'unknown');
          const currentReq = row.current && row.current.requests ? row.current.requests : {};
          const recommendedReq = row.recommended && row.recommended.requests ? row.recommended.requests : {};
          const searchBlob = [row.namespace, row.workload, row.container, row.release, action, notes.join(' '), currentReq.cpu, currentReq.memory, recommendedReq.cpu, recommendedReq.memory].join(' ').toLowerCase();
          const actionMatch = tuningFilterAction === 'all' || action === tuningFilterAction;
          const noteMatch = noteValue === 'all' || notes.includes(noteValue);
          const searchMatch = !query || searchBlob.includes(query);
          if (!actionMatch || !noteMatch || !searchMatch) return;
          visible += 1;

          const currentCpu = String(currentReq.cpu || '0m');
          const currentMem = String(currentReq.memory || '0Mi');
          const recommendedCpu = String(recommendedReq.cpu || '0m');
          const recommendedMem = String(recommendedReq.memory || '0Mi');
          const cpuDelta = Number(String(recommendedCpu).replace(/m$/, '')) - Number(String(currentCpu).replace(/m$/, ''));
          const memDelta = Number(String(recommendedMem).replace(/Mi$/, '')) - Number(String(currentMem).replace(/Mi$/, ''));
          const notesMarkup = notes.length ? notes.map((note) => '<span class="note-pill ' + noteTone(note) + '">' + note.replace(/_/g, ' ') + '</span>').join('') : '<span class="muted">—</span>';

          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td><div class="workload">' + (row.workload || 'unknown') + '</div><div class="workload-meta">' + (row.namespace || 'default') + ' · ' + (row.release || 'n/a') + ' · ' + (row.container || 'main') + '</div></td>' +
            '<td><span class="action ' + action + '">' + action + '</span></td>' +
            '<td><div class="metric-pair"><span>' + withUnitSpace(currentCpu) + '</span><span class="arrow">→</span><span>' + withUnitSpace(recommendedCpu) + '</span></div><div class="metric-delta ' + (cpuDelta > 0 ? 'positive' : cpuDelta < 0 ? 'negative' : 'neutral') + '">' + withUnitSpace(fmtSigned(cpuDelta, 'm', 0)) + '</div></td>' +
            '<td><div class="metric-pair"><span>' + withUnitSpace(currentMem) + '</span><span class="arrow">→</span><span>' + withUnitSpace(recommendedMem) + '</span></div><div class="metric-delta ' + (memDelta > 0 ? 'positive' : memDelta < 0 ? 'negative' : 'neutral') + '">' + withUnitSpace(fmtSigned(memDelta, 'Mi', 0)) + '</div></td>' +
            '<td><div class="usage-line">p95 ' + withUnitSpace(String(row.cpu_p95_m || 0) + 'm') + ' · ' + withUnitSpace(String(row.mem_p95_mi || 0) + 'Mi') + '</div><div class="workload-meta">' + String(row.replicas || 0) + ' replica(s)</div></td>' +
            '<td><div class="usage-line">' + String(row.restarts_window || 0) + ' historical / 14d</div><div class="workload-meta">current live restarts: ' + String(row.current_restarts || 0) + ' on ' + String(row.matched_pods || 0) + ' pod(s)</div></td>' +
            '<td><div class="notes-cell">' + notesMarkup + '</div></td>';
          tuningRowsEl.appendChild(tr);
        });

        tuningCountEl.textContent = visible + ' visible row' + (visible === 1 ? '' : 's');
        tuningEmptyEl.hidden = visible !== 0;
      }

      function renderRows(services) {
        rowsEl.innerHTML = '';
        if (!services.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="6" class="empty-state">No services configured.</td>';
          rowsEl.appendChild(tr);
          return;
        }
        services.forEach((svc) => {
          const tr = document.createElement('tr');
          if (svc.enabled) tr.classList.add('is-enabled');
          const expiry = fmtExpiry(svc.expiresAt);
          tr.innerHTML =
            '<td><div class="svc-name">' + svc.name + '</div><div class="svc-id">' + svc.id + '</div></td>' +
            '<td><span class="badge ' + (svc.enabled ? 'on' : 'off') + '">' + (svc.enabled ? 'enabled' : 'disabled') + '</span></td>' +
            '<td><span class="auth-mode">' + (svc.authMode === 'cloudflare-access' ? 'cf-access' : svc.authMode) + '</span></td>' +
            '<td><a href="' + svc.publicUrl + '" target="_blank" rel="noreferrer">' + svc.publicHost + '</a></td>' +
            '<td><span class="expiry ' + expiry.state + '" data-expires-at="' + (svc.expiresAt || '') + '" data-enabled="' + (svc.enabled ? '1' : '0') + '">' + expiry.text + '</span></td>';

          const controlsTd = document.createElement('td');
          const controls = document.createElement('div');
          controls.className = 'controls';

          const expirySelect = document.createElement('select');
          expirySelect.className = 'control-select';
          [0.25, 0.5, 1, 2, 6, 12, 24].forEach((hours) => {
            const opt = document.createElement('option');
            opt.value = String(hours);
            opt.textContent = hours < 1 ? Math.round(hours * 60) + 'm' : String(hours) + 'h';
            if (hours === Number(svc.defaultExpiryHours || 1)) opt.selected = true;
            expirySelect.appendChild(opt);
          });

          const authSelect = document.createElement('select');
          authSelect.className = 'control-select';
          ['none', 'cloudflare-access'].forEach((mode) => {
            const opt = document.createElement('option');
            opt.value = mode;
            opt.textContent = mode === 'cloudflare-access' ? 'cf-access' : mode;
            if (mode === svc.defaultAuthMode) opt.selected = true;
            authSelect.appendChild(opt);
          });

          const enableBtn = document.createElement('button');
          enableBtn.textContent = 'Enable';
          enableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              enableBtn.disabled = true;
              await request('/api/services/' + svc.id + '/enable', 'POST', {
                hours: Number(expirySelect.value),
                authMode: authSelect.value,
              });
              setMsg('Enabled ' + svc.id);
              await loadDashboard({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          const disableBtn = document.createElement('button');
          disableBtn.textContent = 'Disable';
          disableBtn.className = 'danger';
          disableBtn.onclick = async () => {
            try {
              mutationInFlight += 1;
              disableBtn.disabled = true;
              await request('/api/services/' + svc.id + '/disable', 'POST');
              setMsg('Disabled ' + svc.id);
              await loadDashboard({ silent: true });
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              mutationInFlight = Math.max(0, mutationInFlight - 1);
            }
          };

          controls.append(expirySelect, authSelect, enableBtn, disableBtn);
          controlsTd.appendChild(controls);
          tr.appendChild(controlsTd);
          rowsEl.appendChild(tr);
        });
        tickExpiryCountdowns();
      }

      function renderAudit(entries) {
        auditRowsEl.innerHTML = '';
        if (!entries.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="4" class="empty-state">No audit entries yet.</td>';
          auditRowsEl.appendChild(tr);
          return;
        }
        entries.forEach((entry) => {
          const tr = document.createElement('tr');
          const parts = [];
          if (entry.hours) parts.push(entry.hours + 'h');
          if (entry.authMode) parts.push(entry.authMode);
          if (entry.mode) parts.push('mode: ' + entry.mode);
          if (entry.disabled != null) parts.push('disabled: ' + entry.disabled);
          tr.innerHTML =
            '<td class="audit-time">' + fmtDateTime(entry.ts) + '</td>' +
            '<td class="' + (entry.action === 'enable' ? 'action-enable' : entry.action === 'disable' ? 'action-disable' : entry.action === 'transmission-vpn-set' ? 'action-enable' : 'action-emergency') + '">' + (entry.action || '') + '</td>' +
            '<td>' + (entry.serviceId || '') + '</td>' +
            '<td class="audit-detail">' + parts.join(' · ') + '</td>';
          auditRowsEl.appendChild(tr);
        });
      }

      function renderUpdates(payload) {
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        updatesRowsEl.innerHTML = '';
        if (!items.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="5" class="empty-state">No update rows available.</td>';
          updatesRowsEl.appendChild(tr);
        } else {
          items.forEach((item) => {
            const tr = document.createElement('tr');
            const nsPrefix = item.namespace ? item.namespace + '/' : '';
            tr.innerHTML =
              '<td><div class="svc-name">' + (item.name || item.id || '') + '</div><div class="svc-id">' + nsPrefix + (item.id || '') + '</div></td>' +
              '<td class="updates-version">' + (item.currentVersion || '—') + '</td>' +
              '<td class="updates-version">' + (item.latestVersion || '—') + '</td>' +
              '<td><span class="update-chip ' + (item.status || 'unknown') + '">' + String(item.statusText || 'unknown').toLowerCase() + '</span></td>' +
              '<td><div class="updates-version">' + (item.imageRepo || item.image || '—') + '</div><div class="updates-sub">' + [item.detail, item.pod ? 'pod/' + item.pod : ''].filter(Boolean).join(' · ') + '</div></td>';
            updatesRowsEl.appendChild(tr);
          });
        }
        const checkedAt = payload && payload.checkedAt ? fmtDateTime(payload.checkedAt) : 'not checked yet';
        const nextCheckAt = payload && payload.nextCheckAt ? fmtDateTime(payload.nextCheckAt) : 'unknown';
        const source = payload && payload.source ? payload.source : 'unknown';
        const staleText = payload && payload.stale ? ' · stale cache' : '';
        const refreshingText = payload && payload.refreshInProgress ? ' · background refresh running' : '';
        updatesMetaEl.textContent = 'Checked: ' + checkedAt + ' | Next check: ' + nextCheckAt + ' | Source: ' + source + staleText + refreshingText;
      }

      async function loadUpdates(options) {
        const force = Boolean(options && options.force);
        if (force) setUpdatesMsg('Checking registries...');
        try {
          const path = force ? '/api/image-updates?force=1' : '/api/image-updates';
          const payload = await request(path, 'GET');
          dashboardState.updates = payload;
          renderUpdates(payload);
          renderOverview();
          setUpdatesMsg(payload.stale ? 'Showing cached data while background refresh runs.' : 'Update report loaded.');
        } catch (err) {
          setUpdatesMsg(err.message, true);
        }
      }

      async function loadDashboard(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) {
          setLoadState('Refreshing dashboard...');
          setMsg('Refreshing...');
          setVpnMsg('Refreshing Transmission VPN status...');
          setUpdatesMsg('Loading cached update report...');
        }

        try {
          const [svcData, auditData, vpnData, tuningData, updatesData] = await Promise.allSettled([
            request('/api/services', 'GET'),
            request('/api/audit', 'GET'),
            request('/api/transmission-vpn', 'GET'),
            request('/api/tuning', 'GET'),
            request('/api/image-updates', 'GET'),
          ]);

          if (svcData.status !== 'fulfilled') throw svcData.reason;
          dashboardState.services = svcData.value.services || [];
          renderRows(dashboardState.services);
          if (auditData.status === 'fulfilled') {
            dashboardState.audit = auditData.value.entries || [];
            renderAudit(dashboardState.audit);
          }
          if (vpnData.status === 'fulfilled') {
            dashboardState.vpn = vpnData.value;
            renderTransmissionVpn(dashboardState.vpn);
            if (!silent) setVpnMsg('');
          } else {
            dashboardState.vpn = null;
            renderTransmissionVpn(null);
            setVpnMsg(vpnData.reason.message, true);
          }
          if (tuningData.status === 'fulfilled') {
            dashboardState.tuning = tuningData.value;
            renderPlanner(dashboardState.tuning);
            renderTuningRows();
          } else {
            dashboardState.tuning = null;
            renderPlanner(null);
          }
          if (updatesData.status === 'fulfilled') {
            dashboardState.updates = updatesData.value;
            renderUpdates(dashboardState.updates);
            if (!silent) setUpdatesMsg('Update report loaded.');
          } else {
            dashboardState.updates = null;
            renderUpdates({ items: [] });
            setUpdatesMsg(updatesData.reason.message, true);
          }

          renderOverview();
          setLoadState((silent ? 'Last refresh ' : 'Updated ') + new Date().toLocaleTimeString());
          if (!silent) setMsg('Exposure state updated.');
        } catch (err) {
          setLoadState(err.message, true);
          if (!silent) setMsg(err.message, true);
        }
      }

      refreshAllBtn.onclick = () => loadDashboard();
      updatesRefreshBtn.onclick = () => loadUpdates({ force: true });

      emergencyBtn.onclick = async () => {
        if (!confirm('Disable ALL temporary exposures?')) return;
        try {
          mutationInFlight += 1;
          emergencyBtn.disabled = true;
          await request('/api/admin/disable-all', 'POST');
          setMsg('All exposures disabled');
          await loadDashboard({ silent: true });
        } catch (err) {
          setMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          emergencyBtn.disabled = false;
        }
      };

      async function setTransmissionVpnMode(mode) {
        const nextMode = mode === 'vpn' ? 'vpn' : 'direct';
        const prompt = nextMode === 'vpn'
          ? 'Route Transmission through the VPN sidecar?'
          : 'Route Transmission directly through the normal network path?';
        if (!confirm(prompt)) return;
        try {
          mutationInFlight += 1;
          vpnDirectBtn.disabled = true;
          vpnEnableBtn.disabled = true;
          setVpnMsg('Applying ' + nextMode + ' mode...');
          const payload = await request('/api/transmission-vpn', 'POST', { mode: nextMode });
          renderTransmissionVpn(payload);
          setVpnMsg('Transmission desired route set to ' + nextMode + '. Flux will roll the pod if needed.');
          await loadDashboard({ silent: true });
        } catch (err) {
          setVpnMsg(err.message, true);
        } finally {
          mutationInFlight = Math.max(0, mutationInFlight - 1);
          if (transmissionVpnState) renderTransmissionVpn(transmissionVpnState);
        }
      }

      vpnDirectBtn.onclick = () => setTransmissionVpnMode('direct');
      vpnEnableBtn.onclick = () => setTransmissionVpnMode('vpn');

      pageLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
          const target = normalizePage(link.getAttribute('href'));
          if (!target) return;
          event.preventDefault();
          setActivePage(target);
        });
      });

      document.querySelectorAll('[data-filter-action]').forEach((button) => {
        button.addEventListener('click', () => {
          tuningFilterAction = button.dataset.filterAction || 'all';
          document.querySelectorAll('[data-filter-action]').forEach((peer) => {
            peer.classList.toggle('active', peer === button);
          });
          renderTuningRows();
        });
      });
      noteFilterEl.addEventListener('change', renderTuningRows);
      searchInputEl.addEventListener('input', renderTuningRows);
      window.addEventListener('hashchange', () => {
        setActivePage(window.location.hash, { replace: true });
      });

      setInterval(tickExpiryCountdowns, 1000);
      setActivePage(window.location.hash || '#overview', { replace: true });
      loadDashboard();
    </script>
  </body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    disableExpiredExposures();
    const host = getHost(req);
    const parsed = new URL(req.url || "/", `http://${host || "localhost"}`);
    const isControlPanelHost =
      host === CONTROL_PANEL_HOST ||
      host === "localhost" ||
      host === "127.0.0.1";
    const svc = serviceByHost.get(host);

    if (parsed.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, time: nowIso() });
    }

    if (parsed.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end(renderMetrics());
    }

    if (parsed.pathname.startsWith("/api/")) {
      if (!isControlPanelHost) {
        return sendJson(res, 403, {
          error: "api access is restricted to control panel host",
        });
      }
      return handleApi(req, res, parsed);
    }

    if (svc) {
      const exposure = state.exposures[svc.id];
      if (!effectiveEnabled(exposure)) {
        metrics.shareDeniedDisabledTotal += 1;
        return sendText(res, 403, "exposure is disabled or expired");
      }
      if (!checkShareRateLimit(req, svc.id)) {
        metrics.shareDeniedRateLimitedTotal += 1;
        return sendText(res, 429, "rate limited");
      }
      const authMode = exposureAuthMode(svc, exposure);
      if (authMode === "cloudflare-access") {
        const cfJwt = req.headers["cf-access-jwt-assertion"];
        if (!cfJwt) {
          metrics.shareDeniedAuthTotal += 1;
          return sendText(res, 403, "cloudflare access token required");
        }
      }
      metrics.shareAllowedTotal += 1;
      return proxyRequest(req, res, svc.target);
    }

    if (isControlPanelHost && parsed.pathname === "/") {
      return sendHtml(res, 200, renderCombinedCockpitHtml());
    }

    if (isControlPanelHost && parsed.pathname === "/status") {
      return sendJson(res, 200, {
        app: "exposure-control",
        mode: "control-panel",
        defaultExpiryHours: DEFAULT_EXPIRY_HOURS,
        services: snapshotServices(),
      });
    }
    return sendText(res, 404, "not found");
  } catch (err) {
    console.error("request handling error:", err);
    return sendJson(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`exposure-control backend listening on :${PORT}`);
});
