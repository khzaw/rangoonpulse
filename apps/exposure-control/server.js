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
const DEFAULT_EXPIRY_HOURS = Number(process.env.DEFAULT_EXPIRY_HOURS || "2");
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
  if (value < 1) return 1;
  if (value > 24) return 24;
  return value;
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
  if (!fs.existsSync(STATE_FILE)) {
    const fresh = defaultState(services);
    fs.writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
      throw new Error("state root must be object");
    if (!parsed.exposures || typeof parsed.exposures !== "object")
      parsed.exposures = {};
    for (const svc of services) {
      if (!parsed.exposures[svc.id]) {
        parsed.exposures[svc.id] = {
          enabled: false,
          expiresAt: null,
          updatedAt: nowIso(),
        };
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

const services = loadServices();
const serviceById = new Map(services.map((svc) => [svc.id, svc]));
const serviceByHost = new Map(
  services.map((svc) => [servicePublicHost(svc), svc]),
);
const state = loadState(services);

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

async function handleApi(req, res, pathname) {
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
        --text-1: #e8e8e8;
        --text-2: #888;
        --text-3: #555;
        --green: #3fb950;
        --red: #f85149;
        --yellow: #d29922;
        --font-mono: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
      }
      * { box-sizing: border-box; margin: 0; }
      body {
        background: var(--bg);
        color: var(--text-1);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      main {
        max-width: 1040px;
        margin: 0 auto;
        padding: 32px 24px;
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
      .header-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }

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
        transition: color 0.1s linear, border-color 0.1s linear;
        white-space: nowrap;
      }
      button:hover { color: var(--text-1); border-color: var(--text-3); }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      button.danger { color: var(--red); }
      button.danger:hover { color: var(--red); border-color: var(--red); }
      select {
        padding: 4px 8px;
        font-size: 12px;
        font-family: inherit;
        color: var(--text-2);
        background: transparent;
        border: 1px solid var(--border);
        border-radius: 3px;
        outline: none;
        transition: border-color 0.1s linear;
      }
      select:hover, select:focus { border-color: var(--text-3); }

      /* ── Tables ── */
      table { width: 100%; border-collapse: collapse; }
      thead th {
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        text-align: left;
        border-bottom: 1px solid var(--border);
        background: var(--bg);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      tbody td {
        padding: 10px 12px;
        vertical-align: middle;
        border-bottom: 1px solid var(--border);
      }
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
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
      }
      .on { color: var(--green); }
      .off { color: var(--text-3); }

      /* ── Controls cell ── */
      .controls { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

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
      .expiry { font-size: 12px; color: var(--text-2); }

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
        color: var(--text-3);
      }

      /* ── Section dividers ── */
      .section {
        margin-top: 32px;
        padding-top: 24px;
        border-top: 1px solid var(--border);
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

      /* ── Empty state ── */
      .empty-row td {
        text-align: center;
        color: var(--text-3);
        padding: 24px 12px;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <h1>Exposure Control</h1>
          <div class="subtitle">${SHARE_HOST_PREFIX}&lt;id&gt;.${PUBLIC_DOMAIN} &middot; ${DEFAULT_EXPIRY_HOURS}h default &middot; ${DEFAULT_AUTH_MODE}</div>
        </div>
        <div class="header-actions">
          <button id="refreshBtn">Refresh</button>
          <button id="emergencyBtn" class="danger">Disable All</button>
        </div>
      </div>

      <table>
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
    </main>
    <script>
      const rowsEl = document.getElementById("rows");
      const auditRowsEl = document.getElementById("auditRows");
      const msgEl = document.getElementById("msg");
      const refreshBtn = document.getElementById("refreshBtn");
      const emergencyBtn = document.getElementById("emergencyBtn");
      let busy = false;

      function setMsg(text, isError) {
        msgEl.textContent = text;
        msgEl.style.color = isError ? "var(--red)" : "var(--text-3)";
      }

      function fmtExpiry(value) {
        if (!value) return "\\u2014";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "invalid";
        const now = Date.now();
        const diff = d.getTime() - now;
        if (diff <= 0) return "expired";
        const mins = Math.round(diff / 60000);
        if (mins < 60) return mins + "m remaining";
        const hrs = Math.floor(mins / 60);
        const rm = mins % 60;
        return hrs + "h " + rm + "m remaining";
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
        for (const svc of services) {
          const tr = document.createElement("tr");

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
          expirySpan.textContent = fmtExpiry(svc.expiresAt);
          expiryTd.appendChild(expirySpan);

          const controlsTd = document.createElement("td");
          const controls = document.createElement("div");
          controls.className = "controls";
          const expirySelect = document.createElement("select");
          [1, 2, 6, 12, 24].forEach(function(h) {
            const opt = document.createElement("option");
            opt.value = String(h);
            opt.textContent = h + "h";
            if (h === (svc.defaultExpiryHours || ${DEFAULT_EXPIRY_HOURS})) opt.selected = true;
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
          authSelect.value = svc.defaultAuthMode || "cloudflare-access";

          const enableBtn = document.createElement("button");
          enableBtn.textContent = "Enable";
          enableBtn.disabled = busy;
          enableBtn.onclick = async () => {
            try {
              busy = true;
              enableBtn.disabled = true;
              await request("/api/services/" + svc.id + "/enable", "POST", {
                hours: Number(expirySelect.value),
                authMode: authSelect.value,
              });
              setMsg("Enabled " + svc.id);
              await load();
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              busy = false;
            }
          };

          const disableBtn = document.createElement("button");
          disableBtn.textContent = "Disable";
          disableBtn.className = "danger";
          disableBtn.disabled = busy;
          disableBtn.onclick = async () => {
            try {
              busy = true;
              disableBtn.disabled = true;
              await request("/api/services/" + svc.id + "/disable", "POST");
              setMsg("Disabled " + svc.id);
              await load();
            } catch (err) {
              setMsg(err.message, true);
            } finally {
              busy = false;
            }
          };

          controls.append(expirySelect, authSelect, enableBtn, disableBtn);
          controlsTd.appendChild(controls);

          tr.append(serviceTd, statusTd, authTd, urlTd, expiryTd, controlsTd);
          rowsEl.appendChild(tr);
        }
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
        for (const e of entries) {
          const tr = document.createElement("tr");
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

      async function load() {
        setMsg("Refreshing...");
        try {
          const [svcData, auditData] = await Promise.all([
            request("/api/services", "GET"),
            request("/api/audit", "GET"),
          ]);
          renderRows(svcData.services || []);
          renderAudit(auditData.entries || []);
          setMsg("Updated " + new Date().toLocaleTimeString());
        } catch (err) {
          setMsg(err.message, true);
        }
      }

      refreshBtn.onclick = load;

      emergencyBtn.onclick = async () => {
        if (!confirm("Disable ALL temporary exposures?")) return;
        try {
          busy = true;
          emergencyBtn.disabled = true;
          await request("/api/admin/disable-all", "POST");
          setMsg("All exposures disabled");
          await load();
        } catch (err) {
          setMsg(err.message, true);
        } finally {
          busy = false;
          emergencyBtn.disabled = false;
        }
      };

      load();
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
      return handleApi(req, res, parsed.pathname);
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
