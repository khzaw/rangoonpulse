const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const CONFIGURED_BASE_DOMAIN = String(
  process.env.PUBLIC_DOMAIN || process.env.BASE_DOMAIN || process.env.base_domain || "",
).trim();

function expandBaseDomainTokens(value) {
  const replacement = CONFIGURED_BASE_DOMAIN || "${BASE_DOMAIN}";
  return String(value || "")
    .replace(/\$\{BASE_DOMAIN\}/g, replacement)
    .replace(/\$\{base_domain\}/g, replacement);
}

function expandBaseDomainTokensDeep(value) {
  if (typeof value === "string") return expandBaseDomainTokens(value);
  if (Array.isArray(value)) return value.map((item) => expandBaseDomainTokensDeep(item));
  if (!value || typeof value !== "object") return value;
  const expanded = {};
  for (const [key, item] of Object.entries(value)) {
    expanded[key] = expandBaseDomainTokensDeep(item);
  }
  return expanded;
}

const PORT = Number(process.env.PORT || "8080");
const APP_DIR = process.env.APP_DIR || "/app";
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");
const SERVICES_FILE = process.env.SERVICES_FILE || path.join(APP_DIR, "services.json");
const TRAVEL_CONFIG_FILE =
  process.env.TRAVEL_CONFIG_FILE || path.join(APP_DIR, "travel.json");
const PUBLIC_DOMAIN = expandBaseDomainTokens(
  process.env.PUBLIC_DOMAIN || process.env.BASE_DOMAIN || process.env.base_domain || "${BASE_DOMAIN}",
).toLowerCase();
const SHARE_HOST_PREFIX = (
  process.env.SHARE_HOST_PREFIX || "${SHARE_HOST_PREFIX}"
).toLowerCase();
const CONTROL_PANEL_HOST = expandBaseDomainTokens(
  process.env.CONTROL_PANEL_HOST || "controlpanel.${BASE_DOMAIN}",
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
const TRAVEL_CACHE_TTL_SECONDS = clampInt(
  process.env.TRAVEL_CACHE_TTL_SECONDS,
  30,
  5,
  600,
);
const TRAVEL_HTTP_TIMEOUT_MS = clampInt(
  process.env.TRAVEL_HTTP_TIMEOUT_MS,
  4000,
  1500,
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
const IMAGE_UPDATE_TAG_PAGE_LIMIT = clampInt(
  process.env.IMAGE_UPDATE_TAG_PAGE_LIMIT,
  16,
  1,
  40,
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
const TRANSMISSION_VPN_WEBUI_URL = expandBaseDomainTokens(
  process.env.TRANSMISSION_VPN_WEBUI_URL || "https://torrent-vpn.${BASE_DOMAIN}",
);
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
  travelLastSnapshotTimestampSeconds: 0,
  travelSummaryState: "unknown",
  travelConnectorReady: 0,
  travelConnectorRoutesOk: 0,
};

const rateLimits = new Map();
const kubePodsCache = new Map();
const kubeNodePlatformCache = new Map();
const registryTagCache = new Map();
const registryManifestCache = new Map();
const travelSnapshotCache = {
  promise: null,
  snapshot: null,
  ts: 0,
};
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
        "invalid authMode for service " + svc.id + ": " + svc.authMode,
      );
    }
  }
  return parsed.map((svc) => ({
    ...svc,
    target: expandBaseDomainTokens(svc.target),
  }));
}

function loadTravelConfig() {
  const raw = fs.readFileSync(TRAVEL_CONFIG_FILE, "utf8");
  const parsed = expandBaseDomainTokensDeep(JSON.parse(raw));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("travel.json must be an object");
  }
  if (!Array.isArray(parsed.bundles)) {
    throw new Error("travel.json bundles must be an array");
  }
  if (!Array.isArray(parsed.targets)) {
    throw new Error("travel.json targets must be an array");
  }
  return {
    connector: parsed.connector && typeof parsed.connector === "object" ? parsed.connector : {},
    bundles: parsed.bundles.map((bundle) => ({
      id: String(bundle.id || "").trim(),
      name: String(bundle.name || bundle.id || "").trim(),
      description: String(bundle.description || "").trim(),
    })).filter((bundle) => bundle.id),
    targets: parsed.targets.map((target) => ({
      id: String(target.id || "").trim(),
      name: String(target.name || target.id || "").trim(),
      url: expandBaseDomainTokens(String(target.url || "").trim()),
      access: String(target.access || "tailnet-private").trim(),
      bundle: String(target.bundle || "essentials").trim(),
      priority: Number(target.priority || 0),
      probe: target.probe && typeof target.probe === "object" ? target.probe : {},
    })).filter((target) => target.id && target.url),
  };
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
        console.log('state: pruning stale service entry "' + id + '"');
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
  return SHARE_HOST_PREFIX + service.id + "." + PUBLIC_DOMAIN;
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
  const key = serviceId + ":" + getClientIp(req);
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

function sendBody(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    "content-type": contentType || "application/octet-stream",
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
  const tempPath = filePath + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
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
    repository = "library/" + repository;
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
  return value.length <= 19 ? value : value.slice(0, 19) + "...";
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
        path: u.pathname + u.search,
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
        path: u.pathname + u.search,
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

function normalizeTravelState(value) {
  const state = String(value || "").trim().toLowerCase();
  if (state === "ready" || state === "degraded" || state === "blocked") return state;
  return "unknown";
}

function travelStateRank(value) {
  const state = normalizeTravelState(value);
  if (state === "blocked") return 3;
  if (state === "degraded") return 2;
  if (state === "unknown") return 1;
  return 0;
}

function worstTravelState(values) {
  let worst = "ready";
  for (const value of values || []) {
    if (travelStateRank(value) > travelStateRank(worst)) worst = normalizeTravelState(value);
  }
  return worst;
}

function travelHeadline(state, connector, exposures, transmission) {
  const activeShares = Array.isArray(exposures) ? exposures.length : 0;
  const shareText = activeShares === 0 ? "no active public shares" : String(activeShares) + " active public share" + (activeShares === 1 ? "" : "s");
  const transmissionText =
    transmission && transmission.desiredMode
      ? "Transmission " + transmission.desiredMode
      : "Transmission status unavailable";
  if (state === "ready") {
    return "Private remote path healthy; exit-node capable; " + transmissionText + "; " + shareText + ".";
  }
  if (state === "degraded") {
    return "Travel posture is degraded; review connector, key links, or Transmission routing before relying on it.";
  }
  if (state === "blocked") {
    return "Travel path is blocked; private remote access is not ready.";
  }
  return "Travel readiness is unknown; check the connector and target probes.";
}

async function getTravelConnectorStatus(config) {
  const connectorName = String((config && config.connector && config.connector.name) || "").trim();
  const expectedRoutes = Array.isArray(config && config.connector && config.connector.expectedRoutes)
    ? config.connector.expectedRoutes.map((route) => String(route || "").trim()).filter(Boolean)
    : [];
  const expectsExitNode = Boolean(config && config.connector && config.connector.expectsExitNode);
  if (!connectorName) {
    return {
      name: "",
      ready: false,
      exitNode: false,
      expectedRoutesOk: false,
      advertisedRoutes: [],
      missingRoutes: expectedRoutes,
      state: "unknown",
      detail: "Travel connector is not configured.",
    };
  }
  if (!kubeApiAvailable()) {
    return {
      name: connectorName,
      ready: false,
      exitNode: false,
      expectedRoutesOk: false,
      advertisedRoutes: [],
      missingRoutes: expectedRoutes,
      state: "unknown",
      detail: "Kubernetes API unavailable from control panel.",
    };
  }

  let connector = null;
  try {
    connector = await kubeGetJson(
      "/apis/tailscale.com/v1alpha1/connectors/" + encodeURIComponent(connectorName),
    );
  } catch (err) {
    return {
      name: connectorName,
      ready: false,
      exitNode: false,
      expectedRoutesOk: false,
      advertisedRoutes: [],
      missingRoutes: expectedRoutes,
      state: "unknown",
      detail: "Connector check failed: " + err.message,
    };
  }
  if (!connector) {
    return {
      name: connectorName,
      ready: false,
      exitNode: false,
      expectedRoutesOk: false,
      advertisedRoutes: [],
      missingRoutes: expectedRoutes,
      state: "blocked",
      detail: "Connector " + connectorName + " not found.",
    };
  }

  const spec = connector.spec || {};
  const status = connector.status || {};
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  const readyCondition = conditions.find((condition) =>
    String(condition && condition.type || "").toLowerCase() === "connectorready",
  );
  const ready = String(readyCondition && readyCondition.status || "").toLowerCase() === "true";
  const advertisedRoutes = Array.isArray(spec.subnetRouter && spec.subnetRouter.advertiseRoutes)
    ? spec.subnetRouter.advertiseRoutes.map((route) => String(route || "").trim()).filter(Boolean)
    : [];
  const exitNode = Boolean(spec.exitNode);
  const missingRoutes = expectedRoutes.filter((route) => !advertisedRoutes.includes(route));
  const expectedRoutesOk = missingRoutes.length === 0;
  const state = !ready
    ? "blocked"
    : !expectedRoutesOk || (expectsExitNode && !exitNode)
      ? "degraded"
      : "ready";
  const detailParts = [];
  detailParts.push(ready ? "Connector ready." : "Connector not ready.");
  if (!expectedRoutesOk) detailParts.push("Missing expected routes: " + missingRoutes.join(", "));
  if (expectsExitNode && !exitNode) detailParts.push("Exit-node role missing.");
  if (readyCondition && readyCondition.message) detailParts.push(String(readyCondition.message));

  return {
    name: connectorName,
    ready,
    exitNode,
    expectsExitNode,
    expectedRoutesOk,
    advertisedRoutes,
    missingRoutes,
    state,
    detail: detailParts.join(" ").trim(),
  };
}

async function probeTravelTarget(target) {
  const expectedStatuses = Array.isArray(target && target.probe && target.probe.expectStatus)
    ? target.probe.expectStatus.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [200];
  const timeoutMs = clampInt(target && target.probe && target.probe.timeoutMs, TRAVEL_HTTP_TIMEOUT_MS, 500, 15000);
  try {
    const response = await requestUrl(target.url, {
      method: "GET",
      timeoutMs,
      headers: {
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "user-agent": "exposure-control/1.0",
      },
    });
    const statusCode = Number(response.statusCode || 0);
    const ok = expectedStatuses.includes(statusCode);
    return {
      ...target,
      statusCode,
      state: ok ? "ready" : "degraded",
      detail: ok
        ? "HTTP " + statusCode + " matched expected response."
        : "HTTP " + statusCode + " did not match expected response.",
    };
  } catch (err) {
    return {
      ...target,
      statusCode: 0,
      state: "blocked",
      detail: err.message,
    };
  }
}

function summarizeTravelTargets(targets) {
  const summary = {
    ready: 0,
    degraded: 0,
    blocked: 0,
    unknown: 0,
  };
  for (const target of targets || []) {
    summary[normalizeTravelState(target.state)] += 1;
  }
  return summary;
}

async function getResourceAdvisorUi() {
  const res = await requestUrl(RESOURCE_ADVISOR_UI_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error("resource advisor ui request failed (" + res.statusCode + ")");
  }
  return JSON.parse(res.body || "{}");
}

function resourceAdvisorArtifactUrl(pathname) {
  const target = new URL(RESOURCE_ADVISOR_UI_URL);
  target.pathname = pathname;
  target.search = "";
  return target.toString();
}

async function getResourceAdvisorArtifact(pathname, acceptHeader) {
  const res = await requestUrl(resourceAdvisorArtifactUrl(pathname), {
    headers: {
      accept: acceptHeader || "*/*",
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      "resource advisor artifact request failed (" + res.statusCode + ")",
    );
  }
  return res;
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
      headers.authorization = "Bearer " + tokenState.token;
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
    challenge.params.scope || ("repository:" + repository + ":pull"),
  );
  const res = await requestHttps(tokenUrl.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error("token request failed (" + res.statusCode + ")");
  }
  const parsed = JSON.parse(res.body || "{}");
  const token = parsed.token || parsed.access_token || "";
  if (!token) throw new Error("registry token missing in response");
  return token;
}

async function listRegistryTags(imageRef) {
  const cacheKey = imageRef.registry + "/" + imageRef.repository;
  const cached = registryTagCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return cached.tags;

  const apiHost =
    imageRef.registry === "docker.io"
      ? "registry-1.docker.io"
      : imageRef.registry;
  const base = "https://" + apiHost;
  let nextUrl = base + "/v2/" + imageRef.repository + "/tags/list?n=200";
  const tokenState = { token: "" };
  const tags = [];
  const seen = new Set();
  let pageCount = 0;

  while (nextUrl && pageCount < IMAGE_UPDATE_TAG_PAGE_LIMIT) {
    pageCount += 1;
    const res = await registryRequest(
      nextUrl,
      imageRef.repository,
      tokenState,
      {},
    );
    if (res.statusCode !== 200) {
      throw new Error("tags request failed (" + res.statusCode + ")");
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

  const node = await kubeGetJson("/api/v1/nodes/" + key);
  const labels = (node && node.metadata && node.metadata.labels) || {};
  const platform = {
    os: String(labels["kubernetes.io/os"] || "linux").toLowerCase(),
    architecture: String(labels["kubernetes.io/arch"] || "").toLowerCase(),
  };
  kubeNodePlatformCache.set(key, platform);
  return platform;
}

async function fetchRegistryManifestDigest(imageRef, tag, platform) {
  const cacheKey = imageRef.registry + "/" + imageRef.repository + ":" + tag + ":" + ((platform && platform.os) || "linux") + ":" + ((platform && platform.architecture) || "");
  const cached = registryManifestCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < 6 * 60 * 60 * 1000) return cached.value;

  const apiHost =
    imageRef.registry === "docker.io"
      ? "registry-1.docker.io"
      : imageRef.registry;
  const url = "https://" + apiHost + "/v2/" + imageRef.repository + "/manifests/" + encodeURIComponent(tag);
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
    throw new Error("manifest request failed (" + res.statusCode + ")");
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
    throw new Error("kubernetes api request failed (" + res.statusCode + ")");
  }
  return JSON.parse(res.body || "{}");
}

async function kubeRequest(pathname, options) {
  if (!kubeApiAvailable()) throw new Error("kubernetes api unavailable");
  const auth = kubeAuthContext();
  const opts = options || {};
  const url = "https://" + KUBE_SERVICE_HOST + ":" + KUBE_SERVICE_PORT + pathname;
  const res = await requestHttps(url, {
    ca: auth.ca,
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: {
      accept: "application/json",
      authorization: "Bearer " + auth.token,
      "content-type": opts.contentType || "application/json",
      "user-agent": "exposure-control/1.0",
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function kubeUpsertConfigMap(namespace, name, data, labels) {
  const existing = await kubeGetJson(
    "/api/v1/namespaces/" + namespace + "/configmaps/" + name,
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
    const created = await kubeRequest("/api/v1/namespaces/" + namespace + "/configmaps", {
      method: "POST",
      body: payload,
    });
    if (created.statusCode !== 201) {
      throw new Error("failed to create configmap " + name + " (" + created.statusCode + ")");
    }
    return JSON.parse(created.body || "{}");
  }

  payload.metadata.resourceVersion =
    existing.metadata && existing.metadata.resourceVersion;
  if (existing.metadata && existing.metadata.annotations) {
    payload.metadata.annotations = existing.metadata.annotations;
  }
  const updated = await kubeRequest(
    "/api/v1/namespaces/" + namespace + "/configmaps/" + name,
    {
      method: "PUT",
      body: payload,
    },
  );
  if (updated.statusCode !== 200) {
    throw new Error("failed to update configmap " + name + " (" + updated.statusCode + ")");
  }
  return JSON.parse(updated.body || "{}");
}

async function listNamespacePods(namespace) {
  const key = namespace + "|running";
  if (kubePodsCache.has(key)) return kubePodsCache.get(key);
  const qs = "?fieldSelector=" + encodeURIComponent("status.phase=Running");
  const list = await kubeGetJson("/api/v1/namespaces/" + namespace + "/pods" + qs);
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
      const key = namespace + "/" + workloadId;
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
      imageRepo: imageRef.registry + "/" + imageRef.repository,
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
            ? "New version " + latest.latestTag + " available."
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
              ? "New matching tag " + latest.latestTag + " available."
              : "Running latest known matching tag.";
            return;
          }
        }

        if (!task.currentDigest) {
          task.row.status = "unknown";
          task.row.statusText = "Unknown";
          task.row.detail =
            "Current tag '" +
            task.imageRef.tag +
            "' is not version-sortable and pod image digest is unavailable.";
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
          task.row.detail =
            "Current tag '" +
            task.imageRef.tag +
            "' could not be compared against a registry digest.";
          return;
        }

        task.row.latestVersion = task.imageRef.tag;
        task.row.updateAvailable = remoteDigest !== task.currentDigest;
        task.row.status = task.row.updateAvailable ? "update" : "current";
        task.row.statusText = task.row.updateAvailable
          ? "Update available"
          : "Up to date";
        task.row.detail = task.row.updateAvailable
          ? "Tag '" +
            task.imageRef.tag +
            "' now points to " +
            shortDigest(remoteDigest) +
            "."
          : "Registry digest matches running tag '" +
            task.imageRef.tag +
            "'.";
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
    "/api/v1/namespaces/" + TRANSMISSION_VPN_NAMESPACE + "/configmaps/" + TRANSMISSION_VPN_CONTROL_CONFIGMAP,
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
  const path = "/api/v1/namespaces/" + config.namespace + "/configmaps/" + config.runtimeConfigMap;
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
  kubePodsCache.delete(config.namespace + "|running");
  appendAuditEntry({
    action: "transmission-vpn-set",
    serviceId: "transmission",
    mode: normalizedMode,
  });
  return getTransmissionVpnStatus();
}

const services = loadServices();
const travelConfig = loadTravelConfig();
const serviceById = new Map(services.map((svc) => [svc.id, svc]));
const serviceByHost = new Map(
  services.map((svc) => [servicePublicHost(svc), svc]),
);
const state = loadState(services);

async function buildTravelSnapshot() {
  const connector = await getTravelConnectorStatus(travelConfig);
  const transmission = await getTransmissionVpnStatus().catch((err) => ({
    desiredMode: null,
    effectiveMode: null,
    rolloutPending: true,
    error: err.message,
    placeholderConfig: false,
  }));
  const probedTargets = await Promise.all(
    travelConfig.targets
      .slice()
      .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0))
      .map((target) => probeTravelTarget(target)),
  );
  const bundles = travelConfig.bundles.map((bundle) => {
    const targets = probedTargets.filter((target) => target.bundle === bundle.id);
    return {
      ...bundle,
      state: worstTravelState(targets.map((target) => target.state)),
      targets,
    };
  });
  const activeShares = snapshotServices()
    .filter((item) => item.enabled)
    .map((item) => ({
      id: item.id,
      name: item.name,
      publicUrl: item.publicUrl,
      authMode: item.authMode,
      expiresAt: item.expiresAt,
    }));
  const privateTargets = probedTargets.filter((target) => target.access === "tailnet-private");
  const privateProbeState = worstTravelState(privateTargets.map((target) => target.state));
  const privateAccessState =
    connector.state === "blocked"
      ? "blocked"
      : worstTravelState([connector.state, privateProbeState]);
  const exitNodeState = !connector.ready
    ? "blocked"
    : connector.expectsExitNode && !connector.exitNode
      ? "degraded"
      : "ready";
  const shareState = activeShares.length > 0 ? "degraded" : "ready";
  const transmissionState =
    transmission && transmission.rolloutPending
      ? "degraded"
      : transmission && transmission.placeholderConfig && transmission.desiredMode === "vpn"
        ? "degraded"
        : transmission && transmission.desiredMode
          ? "ready"
          : "unknown";
  const summaryState = worstTravelState([
    privateAccessState,
    exitNodeState,
    shareState,
    transmissionState,
  ]);
  const notes = [
    {
      level: "info",
      code: "client-tailnet-required",
      message: "Private hostnames require a Tailscale-connected client device.",
    },
    {
      level: "info",
      code: "client-exit-node-required",
      message: "Exit-node use is selected on the client device, not by the control panel.",
    },
  ];
  if (transmission && transmission.placeholderConfig) {
    notes.push({
      level: transmission.desiredMode === "vpn" ? "warn" : "info",
      code: "transmission-placeholder-vpn",
      message:
        "Transmission VPN wiring exists, but the current repo still uses placeholder WireGuard values until real provider credentials are added.",
    });
  }
  if (activeShares.length > 0) {
    notes.push({
      level: "warn",
      code: "active-public-shares",
      message:
        String(activeShares.length) +
        " temporary public share" +
        (activeShares.length === 1 ? " is" : "s are") +
        " active.",
    });
  }
  if (connector.state !== "ready") {
    notes.push({
      level: "warn",
      code: "connector-degraded",
      message:
        "If remote access is unstable, verify ConnectorReady and re-check the advertised /32 routes in Tailscale.",
    });
  }

  metrics.travelLastSnapshotTimestampSeconds = Math.floor(Date.now() / 1000);
  metrics.travelSummaryState = summaryState;
  metrics.travelConnectorReady = connector.ready ? 1 : 0;
  metrics.travelConnectorRoutesOk = connector.expectedRoutesOk ? 1 : 0;

  return {
    checkedAt: nowIso(),
    summary: {
      state: summaryState,
      headline: travelHeadline(summaryState, connector, activeShares, transmission),
    },
    connector,
    privateAccess: {
      state: privateAccessState,
      ...summarizeTravelTargets(privateTargets),
    },
    exitNode: {
      state: exitNodeState,
      detail: connector.ready
        ? connector.exitNode
          ? "Connector is configured as an exit node."
          : "Connector is healthy, but exit-node mode is not enabled."
        : "Connector is not ready, so exit-node travel egress is not available.",
    },
    transmission: {
      ...transmission,
      state: transmissionState,
      webUiUrl: TRANSMISSION_VPN_WEBUI_URL,
    },
    exposures: {
      state: shareState,
      activeCount: activeShares.length,
      items: activeShares,
    },
    bundles,
    notes,
  };
}

async function getTravelSnapshot(forceRefresh) {
  const now = Date.now();
  if (
    !forceRefresh &&
    travelSnapshotCache.snapshot &&
    now - travelSnapshotCache.ts < TRAVEL_CACHE_TTL_SECONDS * 1000
  ) {
    return travelSnapshotCache.snapshot;
  }
  if (!travelSnapshotCache.promise) {
    travelSnapshotCache.promise = buildTravelSnapshot()
      .then((snapshot) => {
        travelSnapshotCache.snapshot = snapshot;
        travelSnapshotCache.ts = Date.now();
        return snapshot;
      })
      .finally(() => {
        travelSnapshotCache.promise = null;
      });
  }
  return travelSnapshotCache.promise;
}

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
    "state: recovered " + services.length + " services, " + activeCount + " active, " + expiredCount + " expired on startup",
  );
})();

if (kubeApiAvailable()) {
  getTransmissionVpnStatus()
    .then((status) => {
      console.log(
        "transmission-vpn: desired=" + status.desiredMode + " default=" + status.defaultMode,
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
      publicUrl: "https://" + servicePublicHost(svc),
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
    "exposure_control_active_exposures " + activeExposureCount(),
    "# HELP exposure_control_enable_total Number of manual enable operations.",
    "# TYPE exposure_control_enable_total counter",
    "exposure_control_enable_total " + metrics.enableTotal,
    "# HELP exposure_control_disable_total Number of manual disable operations.",
    "# TYPE exposure_control_disable_total counter",
    "exposure_control_disable_total " + metrics.disableTotal,
    "# HELP exposure_control_emergency_disable_total Number of exposures disabled via emergency shutdown.",
    "# TYPE exposure_control_emergency_disable_total counter",
    "exposure_control_emergency_disable_total " + metrics.emergencyDisableTotal,
    "# HELP exposure_control_expired_disable_total Number of exposures auto-disabled due to expiry.",
    "# TYPE exposure_control_expired_disable_total counter",
    "exposure_control_expired_disable_total " + metrics.expiredDisableTotal,
    "# HELP exposure_control_share_allowed_total Number of share requests forwarded to upstreams.",
    "# TYPE exposure_control_share_allowed_total counter",
    "exposure_control_share_allowed_total " + metrics.shareAllowedTotal,
    "# HELP exposure_control_share_denied_disabled_total Number of share requests denied because exposure was disabled.",
    "# TYPE exposure_control_share_denied_disabled_total counter",
    "exposure_control_share_denied_disabled_total " + metrics.shareDeniedDisabledTotal,
    "# HELP exposure_control_share_denied_auth_total Number of share requests denied due to missing Cloudflare Access token.",
    "# TYPE exposure_control_share_denied_auth_total counter",
    "exposure_control_share_denied_auth_total " + metrics.shareDeniedAuthTotal,
    "# HELP exposure_control_share_denied_rate_limited_total Number of share requests denied by rate limit.",
    "# TYPE exposure_control_share_denied_rate_limited_total counter",
    "exposure_control_share_denied_rate_limited_total " + metrics.shareDeniedRateLimitedTotal,
    "# HELP exposure_control_reconcile_errors_total Number of errors in expiry reconciliation.",
    "# TYPE exposure_control_reconcile_errors_total counter",
    "exposure_control_reconcile_errors_total " + metrics.reconcileErrorsTotal,
    "# HELP exposure_control_last_reconcile_timestamp_seconds Unix timestamp of the last successful reconciliation loop.",
    "# TYPE exposure_control_last_reconcile_timestamp_seconds gauge",
    "exposure_control_last_reconcile_timestamp_seconds " + metrics.lastReconcileTimestampSeconds,
    "# HELP exposure_control_travel_last_snapshot_timestamp_seconds Unix timestamp of the last travel snapshot.",
    "# TYPE exposure_control_travel_last_snapshot_timestamp_seconds gauge",
    "exposure_control_travel_last_snapshot_timestamp_seconds " + metrics.travelLastSnapshotTimestampSeconds,
    "# HELP exposure_control_travel_connector_ready Whether the travel connector is ready in the last snapshot.",
    "# TYPE exposure_control_travel_connector_ready gauge",
    "exposure_control_travel_connector_ready " + metrics.travelConnectorReady,
    "# HELP exposure_control_travel_connector_routes_ok Whether expected travel routes matched in the last snapshot.",
    "# TYPE exposure_control_travel_connector_routes_ok gauge",
    "exposure_control_travel_connector_routes_ok " + metrics.travelConnectorRoutesOk,
    "# HELP exposure_control_travel_summary_state Travel summary state from the last snapshot.",
    "# TYPE exposure_control_travel_summary_state gauge",
    'exposure_control_travel_summary_state{state="ready"} ' + (metrics.travelSummaryState === "ready" ? 1 : 0),
    'exposure_control_travel_summary_state{state="degraded"} ' + (metrics.travelSummaryState === "degraded" ? 1 : 0),
    'exposure_control_travel_summary_state{state="blocked"} ' + (metrics.travelSummaryState === "blocked" ? 1 : 0),
    'exposure_control_travel_summary_state{state="unknown"} ' + (metrics.travelSummaryState === "unknown" ? 1 : 0),
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

  if (req.method === "GET" && pathname === "/api/travel") {
    const force =
      parsedUrl.searchParams.get("force") === "1" ||
      parsedUrl.searchParams.get("refresh") === "1";
    try {
      const payload = await getTravelSnapshot(force);
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

  if (req.method === "GET" && pathname === "/api/tuning/latest.json") {
    try {
      const payload = await getResourceAdvisorArtifact(
        "/latest.json",
        "application/json",
      );
      return sendBody(
        res,
        200,
        payload.body,
        "application/json; charset=utf-8",
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/tuning/latest.md") {
    try {
      const payload = await getResourceAdvisorArtifact(
        "/latest.md",
        "text/markdown, text/plain",
      );
      return sendBody(res, 200, payload.body, "text/markdown; charset=utf-8");
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/tuning/metrics") {
    try {
      const payload = await getResourceAdvisorArtifact(
        "/metrics",
        "text/plain",
      );
      return sendBody(res, 200, payload.body, "text/plain; charset=utf-8");
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
    sendText(res, 502, "upstream error: " + err.message);
  });

  req.pipe(upstream);
}

const CONTROL_PANEL_UI_TEMPLATE = path.join(APP_DIR, "index.html");
const CONTROL_PANEL_ASSETS = new Map([
  ["/assets/styles.css", {
    filePath: path.join(APP_DIR, "styles.css"),
    contentType: "text/css; charset=utf-8",
  }],
  ["/assets/app.js", {
    filePath: path.join(APP_DIR, "app.js"),
    contentType: "application/javascript; charset=utf-8",
  }],
]);

function readControlPanelAsset(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sendControlPanelAsset(res, asset) {
  return sendBody(res, 200, readControlPanelAsset(asset.filePath), asset.contentType);
}

function renderCombinedCockpitHtml() {
  return readControlPanelAsset(CONTROL_PANEL_UI_TEMPLATE)
    .replace(/__SHARE_HOST_PREFIX__/g, escapeHtml(SHARE_HOST_PREFIX))
    .replace(/__PUBLIC_DOMAIN__/g, escapeHtml(PUBLIC_DOMAIN))
    .replace(/__DEFAULT_EXPIRY_HOURS__/g, escapeHtml(String(DEFAULT_EXPIRY_HOURS)))
    .replace(
      /__TRANSMISSION_VPN_WEBUI_URL__/g,
      escapeHtml(TRANSMISSION_VPN_WEBUI_URL),
    );
}

const server = http.createServer(async (req, res) => {
  try {
    disableExpiredExposures();
    const host = getHost(req);
    const parsed = new URL(req.url || "/", "http://" + (host || "localhost"));
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

    if (isControlPanelHost) {
      const asset = CONTROL_PANEL_ASSETS.get(parsed.pathname);
      if (asset) return sendControlPanelAsset(res, asset);
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
  console.log("exposure-control backend listening on :" + PORT);
});
