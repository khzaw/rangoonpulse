const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { once } = require("node:events");
const { after, test } = require("node:test");
const { createExposureClient } = require("./exposure-client.js");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SERVER_PATH = path.join(__dirname, "server.js");
const TRAVEL_CONFIG_PATH = path.join(__dirname, "travel.json");
const CLI_PATH = process.env.EXPOSURE_CLI_BIN || path.join(__dirname, "cli/target/debug/exposure" + (process.platform === "win32" ? ".exe" : ""));

const servers = [];
const children = [];
const temporaryDirectories = [];

after(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

// Children bind PORT=0 so the kernel assigns the port atomically; reserving a
// port first and passing it in races with other listeners in the test run.
function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("exposure-control startup timed out:\n" + output));
    }, 5000);

    const onOutput = (chunk) => {
      output += chunk.toString();
      const match = output.match(/exposure-control backend listening on :(\d+)\r?\n/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };

    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error("exposure-control exited with " + code + ":\n" + output));
    });
  });
}

function requestProxy(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/v1/koreader/syncs/progress",
        method: "PUT",
        headers: {
          host: "share-test.example.test",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.once("error", reject);
    req.end(body);
  });
}

test("share proxy forwards request bodies and their content length", async () => {
  let resolveUpstreamRequest;
  const upstreamRequest = new Promise((resolve) => {
    resolveUpstreamRequest = resolve;
  });
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      resolveUpstreamRequest({
        body: Buffer.concat(chunks).toString("utf8"),
        contentLength: req.headers["content-length"],
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  servers.push(upstream);
  const upstreamPort = await listen(upstream);

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "exposure-control-proxy-test-"),
  );
  temporaryDirectories.push(directory);
  const servicesPath = path.join(directory, "services.json");
  fs.writeFileSync(
    servicesPath,
    JSON.stringify([
      {
        id: "test",
        name: "Test upstream",
        target: `http://127.0.0.1:${upstreamPort}`,
      },
    ]),
  );
  fs.writeFileSync(
    path.join(directory, "state.json"),
    JSON.stringify({
      exposures: {
        test: {
          enabled: true,
          expiresAt: null,
          authMode: "none",
          updatedAt: new Date().toISOString(),
        },
      },
    }),
  );

  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: "0",
      DATA_DIR: directory,
      SERVICES_FILE: servicesPath,
      TRAVEL_CONFIG_FILE: TRAVEL_CONFIG_PATH,
      PUBLIC_DOMAIN: "example.test",
      SHARE_HOST_PREFIX: "share-",
      CONTROL_PANEL_HOST: "controlpanel.example.test",
      DEFAULT_AUTH_MODE: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const proxyPort = await waitForStartup(child);

  const body = JSON.stringify({
    document: "crosspoint-book",
    percentage: 0.42,
    progress: "/body/DocFragment[3]",
  });
  const [response, observed] = await Promise.all([
    requestProxy(proxyPort, body),
    upstreamRequest,
  ]);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"ok":true}');
  assert.equal(observed.body, body);
  assert.equal(observed.contentLength, String(Buffer.byteLength(body)));
});

function requestPanel(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body, json: () => JSON.parse(body) });
      });
    });
    req.on("error", reject);
  });
}

function exposureRequest(port, pathname, method = "GET", body, host = "controlpanel.example.test", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method,
      headers: { host, "content-type": "application/json", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("CLI and GUI share persisted state, expiry, auth enforcement and audit through the private API", async () => {
  const upstream = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ upstream: true, path: req.url }));
  });
  servers.push(upstream);
  const upstreamPort = await listen(upstream);
  const signing = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const certs = http.createServer((req, res) => {
    if (req.url !== "/cdn-cgi/access/certs") {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...signing.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256" }] }));
  });
  servers.push(certs);
  const teamDomain = `http://127.0.0.1:${await listen(certs)}`;
  const accessToken = (aud) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = encode({ alg: "RS256", kid: "test" }) + "." +
      encode({ iss: teamDomain, aud: [aud], exp: Math.floor(Date.now() / 1000) + 600 });
    return body + "." + crypto.sign("RSA-SHA256", Buffer.from(body), signing.privateKey).toString("base64url");
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exposure-cli-integration-"));
  temporaryDirectories.push(directory);
  const servicesPath = path.join(directory, "services.json");
  fs.writeFileSync(servicesPath, JSON.stringify([
    { id: "books", name: "Books", target: `http://127.0.0.1:${upstreamPort}`, accessAud: "books-aud" },
    { id: "photos", name: "Photos", target: `http://127.0.0.1:${upstreamPort}`, publicHostOverride: "photos.example.test", kind: "agent" },
  ]));
  let port;
  async function start() {
    const child = spawn(process.execPath, [SERVER_PATH], { cwd: REPO_ROOT, env: {
      ...process.env, PORT: "0", APP_DIR: __dirname, DATA_DIR: directory,
      SERVICES_FILE: servicesPath, TRAVEL_CONFIG_FILE: TRAVEL_CONFIG_PATH,
      PUBLIC_DOMAIN: "example.test", SHARE_HOST_PREFIX: "share-",
      CONTROL_PANEL_HOST: "controlpanel.example.test", DEFAULT_AUTH_MODE: "cloudflare-access",
      DEFAULT_EXPIRY_HOURS: "1", KUBERNETES_SERVICE_HOST: "", CF_ACCESS_TEAM_DOMAIN: teamDomain,
    }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    port = await waitForStartup(child);
    return child;
  }
  async function stop(child) {
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
  }
  const cli = async (...args) => JSON.parse((await promisify(execFile)(CLI_PATH,
    [...args, "--json"],
    { env: { ...process.env, EXPOSURE_CONTROL_URL: `http://127.0.0.1:${port}` } })).stdout);
  const gui = createExposureClient({ request: async (...args) => {
    const response = await exposureRequest(port, ...args);
    assert.equal(response.status, 200);
    return response.json();
  } });
  let child = await start();
  assert.deepEqual((await gui.list()).services.map((service) => service.kind), ["share", "agent"]);
  assert.equal((await exposureRequest(port, "/", "GET", undefined, "share-books.example.test")).status, 403);
  assert.equal((await exposureRequest(port, "/api/services", "GET", undefined, "other.example.test")).status, 403);
  const enabled = await cli("enable", "books", "--for", "15m", "--auth", "none");
  assert.deepEqual((await gui.list()).services.find((service) => service.id === "books"), enabled.service);
  assert.equal((await exposureRequest(port, "/api/services", "GET", undefined, "share-books.example.test")).json().upstream, true);
  await gui.disable("books");
  assert.equal((await cli("show", "books")).service.enabled, false);
  const cliDefault = await cli("enable", "books");
  assert.equal(cliDefault.service.expiresAt, null);
  assert.equal(cliDefault.service.authMode, "none");
  assert.equal(cliDefault.service.enabled, true);
  assert.deepEqual((await gui.list()).services.find((service) => service.id === "books"), cliDefault.service);
  await cli("enable", "books", "--until-disabled", "--auth", "cloudflare-access");
  assert.equal((await cli("show", "books")).service.authMode, "cloudflare-access");
  assert.equal((await exposureRequest(port, "/", "GET", undefined, "share-books.example.test")).status, 403);
  const withToken = (token) => exposureRequest(port, "/", "GET", undefined, "share-books.example.test",
    { "cf-access-jwt-assertion": token });
  const forged = await withToken("test-assertion");
  assert.equal(forged.status, 403);
  assert.equal(forged.text, "cloudflare access token rejected");
  assert.equal((await withToken(accessToken("other-app"))).status, 403);
  assert.equal((await withToken(accessToken("books-aud"))).status, 200);
  await cli("enable", "photos", "--until-disabled", "--auth", "none");
  assert.equal((await exposureRequest(port, "/", "GET", undefined, "photos.example.test")).status, 200);
  assert.equal((await exposureRequest(port, "/api/services/photos/update", "POST", { extendHours: 1 })).status, 409);
  const timed = (await gui.update("photos", { hours: 1 })).service;
  assert.ok(Date.parse(timed.expiresAt) > Date.now());
  const extended = (await gui.update("photos", { extendHours: 0.5, authMode: "cloudflare-access" })).service;
  assert.equal(Date.parse(extended.expiresAt) - Date.parse(timed.expiresAt), 30 * 60 * 1000);
  assert.equal(extended.openedAt, timed.openedAt);
  assert.equal((await gui.update("photos", { authMode: "none" })).service.expiresAt, extended.expiresAt);
  assert.equal((await gui.audit()).entries[0].action, "update");
  assert.equal((await exposureRequest(port, "/api/services/chartsdb/update", "POST", { hours: 1 })).status, 404);
  const beforeRestart = await gui.list();
  await stop(child);
  child = await start();
  assert.deepEqual(await gui.list(), beforeRestart);
  const auditBefore = (await gui.audit()).entries;
  const stateBefore = fs.readFileSync(path.join(directory, "state.json"), "utf8");
  for (const body of [{ hours: 99 }, { authMode: "typo" }, null]) {
    assert.equal((await exposureRequest(port, "/api/services/books/enable", "POST", body)).status, 400);
  }
  assert.equal((await exposureRequest(port, "/api/services/missing/disable", "POST")).status, 404);
  assert.deepEqual((await gui.audit()).entries, auditBefore);
  assert.equal(fs.readFileSync(path.join(directory, "state.json"), "utf8"), stateBefore);

  await cli("enable", "books", "--for", "15m");
  await stop(child);
  const expiredState = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  expiredState.exposures.books.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify(expiredState));
  child = await start();
  assert.equal((await cli("show", "books")).service.enabled, false);
  assert.equal((await cli("show", "photos")).service.enabled, true);
  assert.equal((await cli("audit", "books")).entries[0].trigger, "startup");
  assert.equal((await cli("disable-all", "--yes")).disabled, 1);
  assert.ok((await gui.list()).services.every((service) => !service.enabled));
  assert.equal((await gui.audit()).entries[0].action, "emergency-disable-all");
  assert.equal((await exposureRequest(port, "/", "GET", undefined, "photos.example.test")).status, 403);

  const html = await exposureRequest(port, "/");
  const assetUrl = html.text.match(/src="(\/assets\/exposure-client.js\?v=[^"]+)"/)[1];
  assert.ok(html.text.indexOf(assetUrl) < html.text.indexOf('/assets/app.js'));
  const asset = await exposureRequest(port, assetUrl);
  assert.equal(asset.status, 200);
  assert.match(asset.headers["cache-control"], /immutable/);
  assert.match(asset.text, /createExposureClient/);
  await stop(child);
});

test("activity feed serves the audit log without Git or cluster access and never invents their state", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exposure-control-activity-"));
  temporaryDirectories.push(directory);
  const servicesPath = path.join(directory, "services.json");
  fs.writeFileSync(servicesPath, JSON.stringify([{ id: "books", name: "Books", target: "http://127.0.0.1:9" }]));
  const recent = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(path.join(directory, "audit.json"), [
    { action: "disable", serviceId: "books", ts: new Date(Date.now() - 9 * 86400000).toISOString() },
    { action: "enable", serviceId: "books", authMode: "none", hours: 1, ts: recent },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const child = spawn(process.execPath, [SERVER_PATH], { cwd: REPO_ROOT, env: {
    ...process.env, PORT: "0", APP_DIR: __dirname, DATA_DIR: directory,
    SERVICES_FILE: servicesPath, TRAVEL_CONFIG_FILE: TRAVEL_CONFIG_PATH,
    PUBLIC_DOMAIN: "example.test", CONTROL_PANEL_HOST: "controlpanel.example.test",
    KUBERNETES_SERVICE_HOST: "", GITHUB_TOKEN: "", GITHUB_REPOSITORY: "",
  }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const port = await waitForStartup(child);

  const response = await exposureRequest(port, "/api/activity");
  assert.equal(response.status, 200);
  const feed = response.json();
  assert.equal(feed.state, "unknown");
  assert.deepEqual(feed.sources, { git: "unconfigured", flux: "unavailable", jobs: "unavailable", panel: "live" });
  assert.deepEqual([feed.summary.commits, feed.summary.rollouts, feed.summary.failed], [null, null, null]);
  assert.deepEqual(feed.events.map((event) => [event.text, event.at, event.tone]), [["Shared books", recent, "warning"]]);
  assert.ok(Number.isFinite(Date.parse(feed.checkedAt)));
  assert.deepEqual((await exposureRequest(port, "/api/activity?force=1")).json().events, feed.events);
  assert.equal((await exposureRequest(port, "/api/activity", "POST", {})).status, 404);
  assert.equal((await exposureRequest(port, "/api/activity", "GET", undefined, "other.example.test")).status, 403);

  const html = await exposureRequest(port, "/");
  const assetUrl = html.text.match(/src="(\/assets\/feed.js\?v=[^"]+)"/)[1];
  const asset = await exposureRequest(port, assetUrl);
  assert.equal(asset.status, 200);
  assert.match(asset.headers["cache-control"], /immutable/);
  assert.match(asset.text, /root\.Feed = factory\(\)/);
});

function prometheusPayload(url, result) {
  const range = url.pathname.endsWith("query_range");
  return {
    status: "success",
    data: {
      resultType: range ? "matrix" : "vector",
      result: result || [{ metric: {}, ...(range ? { values: [[1, "42"], [2, "NaN"], [3, "+Inf"]] } : { value: [1, "0.3478"] }) }],
    },
  };
}

async function startMetricsPanel(handler, env = {}) {
  const observations = [];
  let active = 0;
  let maxActive = 0;
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://prometheus.test");
    observations.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    res.once("close", () => { active -= 1; });
    const body = await handler(url, res);
    if (!res.writableEnded && !res.destroyed && body !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    }
  });
  servers.push(upstream);
  const upstreamPort = await listen(upstream);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exposure-control-metrics-"));
  temporaryDirectories.push(directory);
  const servicesPath = path.join(directory, "services.json");
  fs.writeFileSync(servicesPath, "[]");
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      APP_DIR: __dirname,
      PORT: "0",
      DATA_DIR: directory,
      SERVICES_FILE: servicesPath,
      TRAVEL_CONFIG_FILE: TRAVEL_CONFIG_PATH,
      PUBLIC_DOMAIN: "example.test",
      CONTROL_PANEL_HOST: "controlpanel.example.test",
      PROMETHEUS_URL: `http://127.0.0.1:${upstreamPort}`,
      METRICS_HTTP_TIMEOUT_MS: "1000",
      METRICS_MAX_POINTS: "300",
      METRICS_MAX_RANGE_HOURS: "168",
      METRICS_CACHE_TTL_SECONDS: "30",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const panelPort = await waitForStartup(child);
  return {
    request: (query) => requestPanel(panelPort, "/api/metrics?" + query),
    telemetry: () => requestPanel(panelPort, "/metrics"),
    observations,
    maxActive: () => maxActive,
  };
}

test("metrics route rejects arbitrary queries, malformed ranges and duplicate parameters", async () => {
  const panel = await startMetricsPanel((url) => prometheusPayload(url));
  for (const query of ["names=up", "names=__proto__", "names=tariff,&range=24h", "names=tariff&query=up", "names=tariff&step=1", "names=tariff&range=1.5h", "names=tariff&range=24hgarbage", "names=tariff&range=", "names=tariff&range=1h&range=2h", "names=tariff&names=node_info", "range=24h"]) {
    assert.equal((await panel.request(query)).status, 400, query);
  }
  assert.equal(panel.observations.length, 0);
});

test("metrics ranges clamp, fixed history ignores requested range, and endpoints stay within the point cap", async () => {
  const panel = await startMetricsPanel((url) => {
    if (!url.pathname.endsWith("query_range")) return prometheusPayload(url);
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    const step = Number(url.searchParams.get("step"));
    const values = [];
    for (let t = start; t <= end; t += step) values.push([t, "1"]);
    return prometheusPayload(url, [{ metric: {}, values }]);
  });
  for (const [range, hours, expectedStep] of [["24h", 24, 300], ["999d", 168, 2040], ["0h", 1, 300], ["25h", 25, 360]]) {
    const response = await panel.request("names=cluster_watts&range=" + range);
    assert.equal(response.status, 200);
    const snapshot = response.json();
    assert.equal(snapshot.range, hours + "h");
    assert.equal(snapshot.step, expectedStep);
    assert.equal(snapshot.metrics.cluster_watts.state, "live");
    assert.ok(snapshot.metrics.cluster_watts.series[0].values.length <= 300);
    const observed = panel.observations.at(-1).searchParams;
    assert.equal(Number(observed.get("end")) - Number(observed.get("start")), hours * 3600);
  }
  const fixed = (await panel.request("names=pvc_util_7d&range=1h")).json().metrics.pvc_util_7d;
  assert.equal(fixed.rangeSeconds, 168 * 3600);
  assert.equal(fixed.step, 3600);
  assert.equal(fixed.series[0].values.length, 169);
});

test("metrics keep Kubernetes-only and combined homelab power as separate named queries", async () => {
  const panel = await startMetricsPanel((url) => prometheusPayload(url));
  const response = await panel.request("names=cluster_watts,homelab_watts&range=7d");
  assert.equal(response.status, 200);
  assert.equal(response.json().metrics.cluster_watts.state, "live");
  assert.equal(response.json().metrics.homelab_watts.state, "live");
  assert.deepEqual(panel.observations.map((url) => url.searchParams.get("query")).sort(), [
    "homelab:cluster_estimated_power_watts", "homelab:estimated_power_watts",
  ]);
});

test("metrics normalize non-finite values and expose absent data without fake zeros", async () => {
  const panel = await startMetricsPanel((url) => {
    if (url.searchParams.get("query").includes("tariff")) return prometheusPayload(url, []);
    if (url.searchParams.get("query").includes("low_voltage")) return prometheusPayload(url, [{ metric: { node: "pi" }, value: [1, "NaN"] }]);
    return prometheusPayload(url);
  });
  const snapshot = (await panel.request("names=cluster_watts,tariff,rpi_low_voltage")).json();
  assert.deepEqual(snapshot.metrics.cluster_watts.series[0].values, [[1, 42], [2, null], [3, null]]);
  assert.equal(snapshot.metrics.tariff.state, "unavailable");
  assert.deepEqual(snapshot.metrics.tariff.series, []);
  assert.equal(snapshot.metrics.rpi_low_voltage.state, "unavailable");
  assert.equal(snapshot.metrics.rpi_low_voltage.series[0].values[0][1], null);
});

test("metrics share in-flight requests, cache results, and reuse instant metrics across windows", async () => {
  const panel = await startMetricsPanel(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return prometheusPayload(url);
  });
  const responses = await Promise.all(Array.from({ length: 6 }, () => panel.request("names=cluster_watts,tariff&range=24h")));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(panel.observations.length, 2);
  await panel.request("names=cluster_watts,tariff&range=24h");
  await panel.request("names=tariff&range=7d");
  assert.equal(panel.observations.length, 2);
  const telemetry = (await panel.telemetry()).body;
  assert.match(telemetry, /exposure_control_metrics_proxy_requests_total\{result="success"\} 2/);
  assert.match(telemetry, /exposure_control_metrics_proxy_cache_hits_total 3/);
});

test("metrics failures remain isolated and cached while the route stays available", async () => {
  const panel = await startMetricsPanel((url, res) => {
    if (url.searchParams.get("query").includes("tariff")) { res.statusCode = 503; return "unavailable"; }
    if (url.searchParams.get("query").includes("low_voltage")) return { status: "error", error: "bad query" };
    return prometheusPayload(url);
  });
  const response = await panel.request("names=cluster_watts,tariff,rpi_low_voltage");
  assert.equal(response.status, 200);
  assert.equal(response.json().metrics.cluster_watts.state, "live");
  assert.equal(response.json().metrics.tariff.state, "degraded");
  assert.match(response.json().metrics.tariff.detail, /503/);
  assert.equal(response.json().metrics.rpi_low_voltage.state, "degraded");
  await panel.request("names=tariff");
  assert.equal(panel.observations.length, 3);
});

test("metrics enforce a global four-request upstream concurrency limit", async () => {
  const panel = await startMetricsPanel(async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return prometheusPayload(url);
  });
  const groups = ["cluster_watts,node_cpu,node_mem,node_watts", "node_info,node_ready,node_pods,node_req_cpu", "pod_info,pod_phase,pod_mem_request,pvc_class"];
  const responses = await Promise.all(groups.map((names) => panel.request("names=" + names)));
  assert.ok(responses.every((response) => Object.values(response.json().metrics).every((metric) => metric.state === "live")));
  assert.equal(panel.observations.length, 12);
  assert.equal(panel.maxActive(), 4);
});

test("metrics reject excess series points and bound upstream parsing and the complete response", async () => {
  const panel = await startMetricsPanel((url) => {
    const query = url.searchParams.get("query");
    if (query.includes("cluster_estimated")) return prometheusPayload(url, [{ metric: {}, values: Array.from({ length: 301 }, (_, i) => [i, "1"]) }]);
    if (query.includes("tariff")) return "x".repeat(1024 * 1024 + 1);
    const result = Array.from({ length: 200 }, (_, i) => ({ metric: { namespace: "default", pod: "p".repeat(400) + i }, value: [1, "1"] }));
    return prometheusPayload(url, result);
  });
  const invalid = (await panel.request("names=cluster_watts,tariff")).json().metrics;
  assert.match(invalid.cluster_watts.detail, /point limit/);
  assert.match(invalid.tariff.detail, /size limit/);
  const response = await panel.request("names=pod_mem_request,pod_mem_usage");
  assert.ok(Buffer.byteLength(response.body) <= 150_000);
  assert.equal(response.json().metrics.pod_mem_request.state, "live");
  assert.equal(response.json().metrics.pod_mem_usage.state, "degraded");
  assert.match(response.json().metrics.pod_mem_usage.detail, /separately/);
});

function loadServerHelpers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exposure-control-helpers-"));
  temporaryDirectories.push(dir);
  const previousEnv = {
    APP_DIR: process.env.APP_DIR,
    DATA_DIR: process.env.DATA_DIR,
    SERVICES_FILE: process.env.SERVICES_FILE,
    TRAVEL_CONFIG_FILE: process.env.TRAVEL_CONFIG_FILE,
  };
  process.env.APP_DIR = __dirname;
  process.env.DATA_DIR = dir;
  process.env.SERVICES_FILE = path.join(__dirname, "services.json");
  process.env.TRAVEL_CONFIG_FILE = TRAVEL_CONFIG_PATH;
  try {
    return require("./server.js");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("comparable tag tracking preserves leading v version numbers across distroless and ls suffixes", () => {
  const { parseComparableTag, resolveLatestComparableTag } = loadServerHelpers();
  assert.ok(parseComparableTag("v1.13.1-distroless"));
  assert.equal(parseComparableTag("pg16"), null);

  assert.deepEqual(
    resolveLatestComparableTag("v1.13.1-distroless", [
      "v1.12.1-distroless",
      "v1.13.1-distroless",
      "v1.14.0-distroless",
      "v1.15.0-rc.1-distroless",
      "v1.15.0-busybox",
    ]),
    { latestTag: "v1.14.0-distroless", updateAvailable: true },
  );

  assert.deepEqual(
    resolveLatestComparableTag("v1.6.2-ls374", [
      "v1.6.2-ls374",
      "v1.6.3-ls375",
      "v1.7.0-ls1",
    ]),
    { latestTag: "v1.7.0-ls1", updateAvailable: true },
  );
});

test("primary container selection skips alphabetical sidecars in multi-container pods", () => {
  const { pickPrimaryContainer } = loadServerHelpers();
  assert.equal(
    pickPrimaryContainer(
      { spec: { containers: [{ name: "gluetun-webui" }, { name: "main" }] } },
      "transmission",
    ).name,
    "main",
  );
  assert.equal(
    pickPrimaryContainer(
      {
        spec: {
          containers: [
            { name: "grafana-sc-dashboard" },
            { name: "grafana-sc-datasources" },
            { name: "grafana" },
          ],
        },
      },
      "kube-prometheus-stack-grafana",
    ).name,
    "grafana",
  );
  assert.equal(
    pickPrimaryContainer(
      { spec: { containers: [{ name: "litestream" }, { name: "main" }] } },
      "seventyfivesoft",
    ).name,
    "main",
  );
});

test("Helm repo index parsing handles 2-space and 4-space indentation without capturing dependency versions", () => {
  const { findLatestHelmVersion, parseHelmRepoIndex } = loadServerHelpers();
  const index = parseHelmRepoIndex([
    "apiVersion: v2",
    "entries:",
    "    tailscale-operator:",
    "        - apiVersion: v2",
    "          name: tailscale-operator",
    "          version: 1.104.7",
    "        - apiVersion: v2",
    "          name: tailscale-operator",
    "          version: 1.104.4",
  ].join("\n"));
  assert.deepEqual(index["tailscale-operator"], ["1.104.7", "1.104.4"]);
  assert.equal(findLatestHelmVersion("tailscale-operator", index, "1.104.4"), "1.104.7");

  const twoSpace = parseHelmRepoIndex([
    "apiVersion: v1",
    "entries:",
    "  app-template:",
    "  - apiVersion: v2",
    "    dependencies:",
    "    - name: common",
    "      version: 9.9.9",
    "    version: 5.3.0",
  ].join("\n"));
  assert.deepEqual(twoSpace["app-template"], ["5.3.0"]);
  assert.equal(findLatestHelmVersion("app-template", twoSpace, "5.3.0"), "5.3.0");
});

test("Helm tag and index version resolvers never report a downgrade when listings are truncated", () => {
  const { findLatestFromTags, findLatestHelmVersion } = loadServerHelpers();
  assert.equal(findLatestFromTags(["0.50.0", "0.51.0", "0.52.0"], "0.63.1"), "0.63.1");
  assert.equal(findLatestFromTags(["0.63.1", "0.64.0"], "0.63.1"), "0.64.0");
  assert.equal(
    findLatestHelmVersion("demo", { demo: ["1.0.0", "1.1.0"] }, "1.2.0"),
    "1.2.0",
  );
});

test("digest matching accepts both multi-arch index digests and platform manifest digests", () => {
  const { digestMatchesRemote } = loadServerHelpers();
  const indexDigest = "sha256:" + "a".repeat(64);
  const platformDigest = "sha256:" + "b".repeat(64);
  const otherDigest = "sha256:" + "c".repeat(64);
  const remote = { indexDigest, platformDigest, digest: indexDigest };
  assert.equal(digestMatchesRemote(indexDigest, remote), true);
  assert.equal(digestMatchesRemote(platformDigest, remote), true);
  assert.equal(digestMatchesRemote(otherDigest, remote), false);
});

test("metrics impose a total timeout even while an upstream trickles bytes", async () => {
  const panel = await startMetricsPanel((url, res) => {
    res.writeHead(200);
    const interval = setInterval(() => res.write(" "), 20);
    res.once("close", () => clearInterval(interval));
  }, { METRICS_HTTP_TIMEOUT_MS: "150" });
  const started = Date.now();
  const response = await panel.request("names=tariff");
  assert.equal(response.status, 200);
  assert.equal(response.json().metrics.tariff.state, "degraded");
  assert.match(response.json().metrics.tariff.detail, /timeout/);
  assert.ok(Date.now() - started < 1500);
});
