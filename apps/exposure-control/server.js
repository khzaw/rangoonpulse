const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || "8080");
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SERVICES_FILE = process.env.SERVICES_FILE || "/app/services.json";
const PUBLIC_DOMAIN = (process.env.PUBLIC_DOMAIN || "khzaw.dev").toLowerCase();
const SHARE_HOST_PREFIX = (process.env.SHARE_HOST_PREFIX || "share-").toLowerCase();
const CONTROL_PANEL_HOST = (process.env.CONTROL_PANEL_HOST || "controlpanel.khzaw.dev").toLowerCase();
const DEFAULT_EXPIRY_HOURS = Number(process.env.DEFAULT_EXPIRY_HOURS || "2");
const RECONCILE_INTERVAL_SECONDS = Number(process.env.RECONCILE_INTERVAL_SECONDS || "30");

function nowIso() {
  return new Date().toISOString();
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
    if (!svc.id || !svc.target) throw new Error("each service requires id and target");
  }
  return parsed;
}

function defaultState(services) {
  const exposures = {};
  for (const svc of services) {
    exposures[svc.id] = { enabled: false, expiresAt: null, updatedAt: nowIso() };
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
    if (!parsed || typeof parsed !== "object") throw new Error("state root must be object");
    if (!parsed.exposures || typeof parsed.exposures !== "object") parsed.exposures = {};
    for (const svc of services) {
      if (!parsed.exposures[svc.id]) {
        parsed.exposures[svc.id] = { enabled: false, expiresAt: null, updatedAt: nowIso() };
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

function getHost(req) {
  const raw = req.headers.host || "";
  return String(raw).split(":")[0].toLowerCase();
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
const serviceByHost = new Map(services.map((svc) => [servicePublicHost(svc), svc]));
const state = loadState(services);

function snapshotServices() {
  return services.map((svc) => {
    const exposure = state.exposures[svc.id];
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
    };
  });
}

function disableExpiredExposures() {
  let changed = false;
  for (const svc of services) {
    const exposure = state.exposures[svc.id];
    if (isExpired(exposure)) {
      exposure.enabled = false;
      exposure.updatedAt = nowIso();
      changed = true;
    }
  }
  if (changed) saveState(state);
}

setInterval(disableExpiredExposures, Math.max(RECONCILE_INTERVAL_SECONDS, 15) * 1000);

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
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    state.exposures[id] = { enabled: true, expiresAt, updatedAt: nowIso() };
    saveState(state);
    return sendJson(res, 200, { service: snapshotServices().find((item) => item.id === id) });
  }

  const disableMatch = pathname.match(/^\/api\/services\/([a-z0-9-]+)\/disable$/);
  if (req.method === "POST" && disableMatch) {
    const id = disableMatch[1];
    const svc = serviceById.get(id);
    if (!svc) return sendJson(res, 404, { error: "service not found" });

    state.exposures[id] = { enabled: false, expiresAt: null, updatedAt: nowIso() };
    saveState(state);
    return sendJson(res, 200, { service: snapshotServices().find((item) => item.id === id) });
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
    }
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
        --bg: #0a0f1f;
        --panel: #11192f;
        --text: #f1f5ff;
        --muted: #93a1bf;
        --line: #24314f;
        --ok: #0ea45e;
        --off: #dc3545;
        --btn: #2f4aa7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iosevka", "JetBrains Mono", "Menlo", monospace;
        background: radial-gradient(circle at 20% 0%, #1f305d 0%, var(--bg) 52%);
        color: var(--text);
      }
      main {
        max-width: 980px;
        margin: 2rem auto;
        padding: 1rem;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      h1 {
        margin: 0;
        font-size: 1.3rem;
        letter-spacing: 0.04em;
      }
      .muted { color: var(--muted); font-size: 0.9rem; }
      table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(17, 25, 47, 0.9);
        border: 1px solid var(--line);
      }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 0.7rem;
        text-align: left;
        vertical-align: middle;
      }
      th { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
      .badge {
        display: inline-block;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      .on { background: color-mix(in srgb, var(--ok), transparent 82%); color: #7cf0b0; border: 1px solid #1d7f4f; }
      .off { background: color-mix(in srgb, var(--off), transparent 82%); color: #f5a8b1; border: 1px solid #8b2d3c; }
      .controls { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
      input[type="number"] {
        width: 5.2rem;
        background: #0c1326;
        color: var(--text);
        border: 1px solid var(--line);
        padding: 0.35rem 0.45rem;
      }
      button {
        border: 1px solid #4967d6;
        background: var(--btn);
        color: #fff;
        padding: 0.36rem 0.58rem;
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
      }
      button.danger {
        background: #7e2231;
        border-color: #a13a4d;
      }
      button:disabled { opacity: 0.55; cursor: wait; }
      a { color: #8db0ff; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .msg { margin-top: 0.75rem; min-height: 1.2rem; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <h1>Exposure Control Panel</h1>
          <div class="muted">Default expiry: ${DEFAULT_EXPIRY_HOURS}h | Host pattern: ${SHARE_HOST_PREFIX}&lt;service&gt;.${PUBLIC_DOMAIN}</div>
        </div>
        <button id="refreshBtn">Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Status</th>
            <th>Public URL</th>
            <th>Expires</th>
            <th>Controls</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="msg" class="msg muted"></div>
    </main>
    <script>
      const rowsEl = document.getElementById("rows");
      const msgEl = document.getElementById("msg");
      const refreshBtn = document.getElementById("refreshBtn");
      let busy = false;

      function setMsg(text, isError = false) {
        msgEl.textContent = text;
        msgEl.style.color = isError ? "#f5a8b1" : "#93a1bf";
      }

      function fmtExpiry(value) {
        if (!value) return "n/a";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "invalid";
        return d.toLocaleString();
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
        for (const svc of services) {
          const tr = document.createElement("tr");

          const serviceTd = document.createElement("td");
          serviceTd.innerHTML = "<strong>" + svc.name + "</strong><div class=\\"muted\\">" + svc.id + "</div>";

          const statusTd = document.createElement("td");
          const badge = document.createElement("span");
          badge.className = "badge " + (svc.enabled ? "on" : "off");
          badge.textContent = svc.enabled ? "ENABLED" : "DISABLED";
          statusTd.appendChild(badge);

          const urlTd = document.createElement("td");
          urlTd.innerHTML = "<a href=\\"" + svc.publicUrl + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + svc.publicHost + "</a>";

          const expiryTd = document.createElement("td");
          expiryTd.textContent = fmtExpiry(svc.expiresAt);

          const controlsTd = document.createElement("td");
          const controls = document.createElement("div");
          controls.className = "controls";
          const hoursInput = document.createElement("input");
          hoursInput.type = "number";
          hoursInput.min = "1";
          hoursInput.max = "24";
          hoursInput.value = String(svc.defaultExpiryHours || ${DEFAULT_EXPIRY_HOURS});

          const enableBtn = document.createElement("button");
          enableBtn.textContent = "Enable";
          enableBtn.disabled = busy;
          enableBtn.onclick = async () => {
            try {
              busy = true;
              enableBtn.disabled = true;
              await request("/api/services/" + svc.id + "/enable", "POST", {
                hours: Number(hoursInput.value || ${DEFAULT_EXPIRY_HOURS}),
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

          controls.append(hoursInput, enableBtn, disableBtn);
          controlsTd.appendChild(controls);

          tr.append(serviceTd, statusTd, urlTd, expiryTd, controlsTd);
          rowsEl.appendChild(tr);
        }
      }

      async function load() {
        setMsg("Refreshing...");
        try {
          const data = await request("/api/services", "GET");
          renderRows(data.services || []);
          setMsg("Updated " + new Date().toLocaleTimeString());
        } catch (err) {
          setMsg(err.message, true);
        }
      }

      refreshBtn.onclick = load;
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
      host === CONTROL_PANEL_HOST || host === "localhost" || host === "127.0.0.1";
    const svc = serviceByHost.get(host);

    if (parsed.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, time: nowIso() });
    }

    if (parsed.pathname.startsWith("/api/")) {
      if (!isControlPanelHost) {
        return sendJson(res, 403, { error: "api access is restricted to control panel host" });
      }
      return handleApi(req, res, parsed.pathname);
    }

    if (svc) {
      const exposure = state.exposures[svc.id];
      if (!effectiveEnabled(exposure)) {
        return sendText(res, 403, "exposure is disabled or expired");
      }
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
