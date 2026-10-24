// Native macOS supervision/metrics and an out-of-cluster, dependency-free sentinel.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const configDir = `${homedir()}/.config/rangoonpulse/iris`;
const stateDir = `${homedir()}/.local/state/rangoonpulse/iris`;

export function advance(previous = {}, ok, now, config) {
  const next = { firing: false, failures: 0, successes: 0, deliveries: {}, ...previous };
  next.deliveries = { ...next.deliveries };
  next.failures = ok ? 0 : next.failures + 1;
  next.successes = ok ? next.successes + 1 : 0;
  if (!next.firing && next.failures >= config.failureThreshold) next.firing = true;
  if (next.firing && next.successes >= config.recoveryThreshold) next.firing = false;
  if (next.firing !== Boolean(previous.firing)) next.changedAt = now;
  return next;
}

export function notificationDue(state, destination, now, repeatSeconds) {
  const last = state.deliveries[destination];
  if (state.firing) return last?.status !== 'firing' || now - last.sentAt >= repeatSeconds;
  return last?.status === 'firing';
}

export function readinessHealthy(sample, now) {
  return sample?.ok === true && now - sample.timestamp < 90;
}

export function launchdServiceRunning(listing, service) {
  return listing.split('\n').some(line => {
    const match = line.match(/^\s*([1-9][0-9]*)\s+-?[0-9]+\s+(\S+)\s*$/);
    return match?.[2] === service;
  });
}

export function hermesHealth(gateway, dashboard, status) {
  const gatewayUp = gateway?.status === 'ok' && gateway?.platform === 'hermes-agent';
  const dashboardUp = dashboard?.ok === true;
  const statusUp = typeof status?.gateway_running === 'boolean' &&
    ['ok', 'degraded'].includes(status?.overall) && Boolean(status?.components);
  const components = Object.fromEntries(['gateway', 'dashboard', 'storage', 'platforms']
    .map(name => [name, status?.components?.[name]?.status === 'ok']));
  const count = value => Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    gatewayUp, dashboardUp, statusUp, components,
    ready: gatewayUp && dashboardUp && statusUp && status.gateway_running &&
      status.gateway_heartbeat_stale_s === null && status.overall === 'ok' &&
      Object.values(components).every(Boolean),
    activeAgents: count(status?.active_agents),
    platformsConnected: count(status?.components?.platforms?.connected),
    platformsConfigured: count(status?.components?.platforms?.configured),
  };
}

export async function atomicWrite(path, contents) {
  await writeFile(`${path}.tmp`, contents, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export function independentLookup(servers) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers(servers);
  return (hostname, options, callback) => {
    resolver.resolve4(hostname).then(addresses => {
      if (options?.all) callback(null, addresses.map(address => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
    }, callback);
  };
}

export function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const transport = new URL(url).protocol === 'https:' ? https : http;
    const req = transport.request(url, { ...options, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error('response too large'));
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    // A wall-clock deadline includes DNS, connect, TLS and response time.
    const timer = setTimeout(() => req.destroy(new Error('request deadline')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(options.body);
  });
}

export async function checkEndpoint(check, api) {
  try {
    const options = check.kubernetesAuth ? {
      ca: api.ca, headers: { Authorization: `Bearer ${api.token}` },
    } : {};
    if (check.address) {
      options.lookup = (_host, opts, cb) => opts?.all
        ? cb(null, [{ address: check.address, family: 4 }]) : cb(null, check.address, 4);
    }
    const response = await request(check.url, options);
    if (response.status !== 200) return false;
    if (check.jsonField) return JSON.parse(response.body)[check.jsonField] === check.jsonValue;
    return !check.kubernetesAuth || response.body.trim() === 'ok';
  } catch { return false; }
}

export async function send(destination, credentials, message, lookup) {
  const telegram = destination === 'telegram';
  const url = telegram ? `https://api.telegram.org/bot${credentials.telegramBotToken}/sendMessage`
    : credentials.discordWebhookUrl;
  const body = JSON.stringify(telegram
    ? { chat_id: credentials.telegramChatId, text: message }
    : { content: message, allowed_mentions: { parse: [] } });
  const response = await request(url, {
    method: 'POST', lookup, body, headers: { 'Content-Type': 'application/json' },
  });
  if (response.status < 200 || response.status >= 300 ||
      (telegram && JSON.parse(response.body).ok !== true)) throw new Error('delivery rejected');
}

export async function deliver(state, now, repeatSeconds, sendNotification) {
  for (const destination of ['telegram', 'discord']) {
    if (!notificationDue(state, destination, now, repeatSeconds)) continue;
    try {
      await sendNotification(destination);
      state.deliveries[destination] = { status: state.firing ? 'firing' : 'resolved', sentAt: now };
    } catch {
      // Never log the request URL: it contains the destination credential.
      console.error(`notification failed (${destination}); retry on next cycle`);
    }
  }
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

export async function main() {
  process.umask(0o077);
  const config = await readJson(`${configDir}/config.json`);
  const credentials = await readJson(`${configDir}/notifications.json`);
  const api = await readJson(`${configDir}/kubernetes.json`);
  if (!credentials.telegramBotToken || !credentials.discordWebhookUrl || !api.token || !api.ca) {
    throw new Error('required credentials missing');
  }
  const lookup = independentLookup(config.dnsServers);
  await mkdir(`${stateDir}/textfile`, { recursive: true, mode: 0o700 });
  let states;
  try { states = await readJson(`${stateDir}/alerts.json`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; states = {}; }
  const readiness = {};
  const routes = { '/healthz/openclaw': 'openclaw', '/healthz/hermes': 'hermes',
    '/healthz/hermes-gateway': 'hermesGateway' };
  const server = createServer((req, res) => {
    const name = Object.hasOwn(routes, req.url) ? routes[req.url] : undefined;
    const ok = Boolean(name) && readinessHealthy(readiness[name], Date.now() / 1000);
    res.writeHead(!name ? 404 : ok ? 200 : 503,
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok }));
  });
  server.on('error', error => { console.error(error.code); process.exit(1); });
  server.listen(config.listenPort, config.listenAddress);

  async function cycle() {
    const now = Date.now() / 1000;
    const lines = [];
    const metric = (name, labels, value) => {
      const rendered = Object.entries(labels).map(([key, val]) => `${key}=${JSON.stringify(val)}`).join(',');
      lines.push(`${name}${rendered ? `{${rendered}}` : ''} ${Number(value)}`);
    };
    let ready = false;
    try {
      const response = await request(config.openclawUrl);
      ready = response.status === 200 && JSON.parse(response.body).ready === true;
    } catch { /* an unavailable local gateway is an unhealthy sample */ }
    readiness.openclaw = { ok: ready, timestamp: now };
    metric('iris_openclaw_ready', {}, ready);
    const [gateway, dashboard, status] = await Promise.all([
      config.hermesGatewayUrl, config.hermesDashboardUrl, config.hermesStatusUrl,
    ].map(async url => {
      try {
        const response = await request(url);
        return response.status === 200 ? JSON.parse(response.body) : undefined;
      } catch { return undefined; }
    }));
    const hermes = hermesHealth(gateway, dashboard, status);
    readiness.hermes = { ok: hermes.ready, timestamp: now };
    readiness.hermesGateway = { ok: hermes.gatewayUp, timestamp: now };
    metric('iris_hermes_gateway_up', {}, hermes.gatewayUp);
    metric('iris_hermes_dashboard_up', {}, hermes.dashboardUp);
    metric('iris_hermes_status_up', {}, hermes.statusUp);
    metric('iris_hermes_ready', {}, hermes.ready);
    for (const [component, ok] of Object.entries(hermes.components)) {
      metric('iris_hermes_component_up', { component }, ok);
    }
    for (const [name, value] of [['active_agents', hermes.activeAgents],
      ['platforms_connected', hermes.platformsConnected], ['platforms_configured', hermes.platformsConfigured]]) {
      if (value !== undefined) metric(`iris_hermes_${name}`, {}, value);
    }
    let listing = '';
    try {
      // The caller's launchd list includes both user and GUI jobs. Hermes uses user/501.
      ({ stdout: listing } = await exec('/bin/launchctl', ['list'], { timeout: 5000 }));
    } catch { /* unavailable launchd status fails closed */ }
    for (const service of config.services) {
      metric('iris_launchd_service_up', { launchd_service: service }, launchdServiceRunning(listing, service));
    }
    await Promise.all(config.clusterChecks.map(async check => {
      const ok = await checkEndpoint(check, api);
      metric('iris_cluster_probe_success', { check: check.name }, ok);
      const state = advance(states[check.name], ok, now, config);
      states[check.name] = state;
      await deliver(state, now, config.repeatSeconds, destination => send(destination, credentials,
        `[${state.firing ? 'FIRING' : 'RESOLVED'}] Iris external sentinel: ${check.name}\n` +
        `${check.url}\n${state.firing ? 'Direct LAN check failed 3 consecutive times.' : 'Direct LAN check recovered.'}\n` +
        'Sent by native launchd watchdog; no cluster alerting/DNS dependency.', lookup));
      metric('iris_cluster_alert_firing', { check: check.name }, state.firing);
      for (const destination of ['telegram', 'discord']) {
        metric('iris_notification_pending', { check: check.name, destination },
          notificationDue(state, destination, now, config.repeatSeconds));
      }
    }));
    metric('iris_watchdog_last_cycle_timestamp_seconds', {}, Date.now() / 1000);
    await atomicWrite(`${stateDir}/alerts.json`, JSON.stringify(states));
    await atomicWrite(`${stateDir}/textfile/iris.prom`, `${lines.join('\n')}\n`);
  }
  // No overlap: notification timeouts cannot accumulate concurrent probe cycles.
  for (;;) {
    await cycle();
    await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('watchdog stopped: check config, credentials and state permissions'); process.exit(1); });
}
