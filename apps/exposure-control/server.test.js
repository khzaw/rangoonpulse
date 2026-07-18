const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { after, test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "../..");
const SERVER_PATH = path.join(__dirname, "server.js");
const TRAVEL_CONFIG_PATH = path.join(__dirname, "travel.json");

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

async function availablePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("exposure-control startup timed out:\n" + output));
    }, 5000);

    const onOutput = (chunk) => {
      output += chunk.toString();
      if (output.includes("exposure-control backend listening")) {
        clearTimeout(timeout);
        resolve();
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

  const proxyPort = await availablePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(proxyPort),
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
  await waitForStartup(child);

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
