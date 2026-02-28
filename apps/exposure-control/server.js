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
const KUBE_SERVICE_HOST = process.env.KUBERNETES_SERVICE_HOST || "";
const KUBE_SERVICE_PORT = process.env.KUBERNETES_SERVICE_PORT_HTTPS || "443";
const KUBE_TOKEN_FILE =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const KUBE_CA_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

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
const kubeServicesCache = new Map();
const kubePodsCache = new Map();
const registryTagCache = new Map();
let imageUpdateRefreshPromise = null;

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

function parseClusterServiceTarget(target) {
  try {
    const u = new URL(target);
    const host = String(u.hostname || "").toLowerCase();
    const m = host.match(
      /^([a-z0-9-]+)\.([a-z0-9-]+)\.svc(?:\.cluster\.local)?$/,
    );
    if (!m) return null;
    return { service: m[1], namespace: m[2] };
  } catch {
    return null;
  }
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
  let token = "";
  const tags = [];
  const seen = new Set();
  let pageCount = 0;

  while (nextUrl && pageCount < 8) {
    pageCount += 1;
    const headers = {
      accept: "application/json",
      "user-agent": "exposure-control/1.0",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await requestHttps(nextUrl, { headers });

    if (res.statusCode === 401) {
      if (token) throw new Error("registry authentication failed");
      const challenge = parseWwwAuthenticate(res.headers["www-authenticate"]);
      token = await fetchRegistryBearerToken(challenge, imageRef.repository);
      continue;
    }
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
  if (!kubeApiAvailable()) throw new Error("kubernetes api unavailable");
  const auth = kubeAuthContext();
  const url = `https://${KUBE_SERVICE_HOST}:${KUBE_SERVICE_PORT}${pathname}`;
  const res = await requestHttps(url, {
    ca: auth.ca,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${auth.token}`,
      "user-agent": "exposure-control/1.0",
    },
  });
  if (res.statusCode === 404) return null;
  if (res.statusCode !== 200) {
    throw new Error(`kubernetes api request failed (${res.statusCode})`);
  }
  return JSON.parse(res.body || "{}");
}

function buildLabelSelector(selectorObj) {
  const keys = Object.keys(selectorObj || {}).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}=${selectorObj[k]}`).join(",");
}

async function getKubeService(namespace, name) {
  const key = `${namespace}/${name}`;
  if (kubeServicesCache.has(key)) return kubeServicesCache.get(key);
  const value = await kubeGetJson(
    `/api/v1/namespaces/${namespace}/services/${name}`,
  );
  kubeServicesCache.set(key, value);
  return value;
}

async function listKubePods(namespace, selector) {
  const key = `${namespace}|${selector}`;
  if (kubePodsCache.has(key)) return kubePodsCache.get(key);
  const qs = selector ? `?labelSelector=${encodeURIComponent(selector)}` : "";
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

function newestPod(a, b) {
  const aTs = Date.parse(
    (a && a.metadata && a.metadata.creationTimestamp) || "",
  );
  const bTs = Date.parse(
    (b && b.metadata && b.metadata.creationTimestamp) || "",
  );
  return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
}

function pickPrimaryContainer(pod) {
  const containers = (pod && pod.spec && pod.spec.containers) || [];
  if (containers.length === 0) return null;
  return containers[0];
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
  kubeServicesCache.clear();
  kubePodsCache.clear();

  const items = [];
  for (const svc of services) {
    const base = {
      id: svc.id,
      name: svc.name,
      currentVersion: null,
      latestVersion: null,
      image: null,
      imageRepo: null,
      updateAvailable: false,
      status: "unknown",
      statusText: "Unknown",
      detail: "",
    };
    const target = parseClusterServiceTarget(svc.target);
    if (!target) {
      items.push({
        ...base,
        status: "external",
        statusText: "External target",
        detail: "Not a cluster service target.",
      });
      continue;
    }
    try {
      const k8sService = await getKubeService(target.namespace, target.service);
      if (!k8sService) {
        items.push({
          ...base,
          status: "not-installed",
          statusText: "Not installed",
          detail: "Service object not found.",
        });
        continue;
      }
      const selector = buildLabelSelector(k8sService.spec && k8sService.spec.selector);
      if (!selector) {
        items.push({
          ...base,
          status: "unknown",
          statusText: "No selector",
          detail: "Service does not define pod selector labels.",
        });
        continue;
      }
      const pods = await listKubePods(target.namespace, selector);
      if (!pods.length) {
        items.push({
          ...base,
          status: "not-installed",
          statusText: "No pods",
          detail: "No matching pods currently exist.",
        });
        continue;
      }
      const rankedPods = pods.slice().sort((a, b) => {
        const rankDiff = podRank(b) - podRank(a);
        if (rankDiff !== 0) return rankDiff;
        return newestPod(a, b);
      });
      const pod = rankedPods[0];
      const container = pickPrimaryContainer(pod);
      if (!container || !container.image) {
        items.push({
          ...base,
          status: "unknown",
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
          status: "unknown",
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

      const semverCurrent = parseSemverTag(imageRef.tag);
      if (!semverCurrent || semverCurrent.prerelease) {
        items.push({
          ...row,
          status: "unknown",
          statusText: "Unknown",
          detail: "Current tag is not stable semver.",
        });
        continue;
      }

      try {
        const tags = await listRegistryTags(imageRef);
        const latest = resolveLatestSemver(imageRef.tag, tags);
        if (!latest) {
          items.push({
            ...row,
            status: "unknown",
            statusText: "Unknown",
            detail: "No stable semver tags found in registry.",
          });
          continue;
        }
        items.push({
          ...row,
          latestVersion: latest.latestTag,
          updateAvailable: latest.updateAvailable,
          status: latest.updateAvailable ? "update" : "current",
          statusText: latest.updateAvailable ? "Update available" : "Up to date",
          detail: latest.updateAvailable
            ? `New version ${latest.latestTag} available.`
            : "Running latest known stable version.",
        });
      } catch (err) {
        items.push({
          ...row,
          status: "unknown",
          statusText: "Registry error",
          detail: err.message,
        });
      }
    } catch (err) {
      items.push({
        ...base,
        status: "unknown",
        statusText: "Cluster error",
        detail: err.message,
      });
    }
  }

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
    <title>Exposure Control</title>
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
      body {
        background:
          radial-gradient(1200px 600px at 8% -20%, rgba(121, 184, 255, 0.08), transparent 56%),
          radial-gradient(1000px 520px at 92% -30%, rgba(63, 185, 80, 0.07), transparent 62%),
          linear-gradient(180deg, #0b0b0b 0%, var(--bg) 46%, #0b0b0b 100%);
        color: var(--text-1);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
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
        max-height: min(62vh, 620px);
        overflow-y: auto;
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
          <h1>Exposure Control</h1>
          <div class="subtitle">${SHARE_HOST_PREFIX}&lt;id&gt;.${PUBLIC_DOMAIN} - ${DEFAULT_EXPIRY_HOURS}h default - weekly image update checks</div>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Control panel sections">
        <button id="tabExposure" class="tab-btn active" type="button" data-tab="exposure">Exposure</button>
        <button id="tabUpdates" class="tab-btn" type="button" data-tab="updates">Image Updates</button>
      </div>

      <section id="panelExposure" class="panel">
        <div class="panel-actions">
          <div class="section-header">Temporary Exposure Control</div>
          <div>
            <button id="refreshBtn" type="button">Refresh</button>
            <button id="emergencyBtn" class="danger" type="button">Disable All</button>
          </div>
        </div>
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
      const msgEl = document.getElementById("msg");
      const updatesMsgEl = document.getElementById("updatesMsg");
      const updatesMetaEl = document.getElementById("updatesMeta");
      const refreshBtn = document.getElementById("refreshBtn");
      const emergencyBtn = document.getElementById("emergencyBtn");
      const updatesRefreshBtn = document.getElementById("updatesRefreshBtn");
      let mutationInFlight = 0;
      let pendingExpiryRefresh = false;
      let updatesLoaded = false;

      function setMessage(target, text, isError) {
        target.textContent = text || "";
        target.style.color = isError ? "var(--red)" : "var(--text-3)";
      }

      function setMsg(text, isError) {
        setMessage(msgEl, text, isError);
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
          badge.textContent = svc.enabled ? "Enabled" : "Disabled";
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
          const svcTd = document.createElement("td");
          svcTd.className = "audit-svc";
          svcTd.textContent = e.serviceId || "";
          const detailsTd = document.createElement("td");
          detailsTd.className = "audit-detail";
          const parts = [];
          if (e.hours) parts.push(e.hours + "h");
          if (e.authMode) parts.push(e.authMode);
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
            idEl.textContent = item.id || "";
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
            chip.textContent = item.statusText || "Unknown";
            statusTd.appendChild(chip);

            const imageTd = document.createElement("td");
            const imageEl = document.createElement("div");
            imageEl.className = "updates-version";
            imageEl.textContent = item.imageRepo || item.image || "\\u2014";
            const subEl = document.createElement("div");
            subEl.className = "updates-sub";
            subEl.textContent = item.detail || "";
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

      async function loadExposure(options) {
        const silent = Boolean(options && options.silent);
        if (!silent) setMsg("Refreshing...");
        try {
          const [svcData, auditData] = await Promise.all([
            request("/api/services", "GET"),
            request("/api/audit", "GET"),
          ]);
          renderRows(svcData.services || []);
          renderAudit(auditData.entries || []);
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
      return sendHtml(res, 200, renderControlPanelHtml());
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
