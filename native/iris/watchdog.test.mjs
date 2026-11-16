import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { advance, deliver, notificationDue, readinessHealthy, checkEndpoint, probeEndpoint, launchdServiceRunning, hermesHealth } from './watchdog.mjs';

const config = { failureThreshold: 3, recoveryThreshold: 2 };
test('launchd list recognizes running jobs across user and GUI domains, regardless of previous exit', () => {
  const listing = 'PID\tStatus\tLabel\n59798\t75\tai.hermes.gateway\n57118\t0\tai.openclaw.gateway\n-\t1\tstopped.job\n';
  assert.equal(launchdServiceRunning(listing, 'ai.hermes.gateway'), true);
  assert.equal(launchdServiceRunning(listing, 'ai.openclaw.gateway'), true);
  assert.equal(launchdServiceRunning(listing, 'stopped.job'), false);
  assert.equal(launchdServiceRunning(listing, 'missing.job'), false);
});
test('debounces failures, requires two recoveries, preserves state across restarts', () => {
  let state = advance({}, false, 1, config);
  assert.equal(state.firing, false);
  state = advance(state, false, 2, config);
  state = advance(JSON.parse(JSON.stringify(state)), false, 3, config);
  assert.equal(state.firing, true);
  state = advance(state, true, 4, config);
  assert.equal(state.firing, true);
  assert.equal(advance(state, true, 5, config).firing, false);
  assert.equal(advance(advance({}, false, 1, config), true, 2, config).failures, 0);
});
test('delivery retries each destination independently, repeats, and resolves only notified destinations', async () => {
  const state = { firing: true, deliveries: {} };
  const delivered = [];
  await deliver(state, 10, 100, async destination => {
    if (destination === 'discord') throw new Error('offline');
    delivered.push(destination);
  });
  assert.deepEqual(delivered, ['telegram']);
  assert.equal(notificationDue(state, 'telegram', 11, 100), false);
  assert.equal(notificationDue(state, 'discord', 11, 100), true);
  assert.equal(notificationDue(state, 'telegram', 110, 100), true);
  state.firing = false;
  assert.equal(notificationDue(state, 'telegram', 12, 100), true);
  assert.equal(notificationDue(state, 'discord', 12, 100), false);
  await deliver(state, 12, 100, async destination => delivered.push(destination));
  assert.equal(notificationDue(state, 'telegram', 13, 100), false);
});
test('stale, missing or failed local readiness fails closed', () => {
  assert.equal(readinessHealthy(undefined, 100), false);
  assert.equal(readinessHealthy({ ok: true, timestamp: 10 }, 100), false);
  assert.equal(readinessHealthy({ ok: false, timestamp: 99 }, 100), false);
  assert.equal(readinessHealthy({ ok: true, timestamp: 99 }, 100), true);
});
test('Hermes readiness requires real APIs and healthy components, not just running processes', () => {
  const gateway = { status: 'ok', platform: 'hermes-agent' };
  const dashboard = { ok: true };
  const status = { gateway_running: true, gateway_heartbeat_stale_s: null, overall: 'ok', active_agents: 2,
    components: { gateway: { status: 'ok' }, dashboard: { status: 'ok' }, storage: { status: 'ok' },
      platforms: { status: 'ok', connected: 2, configured: 2 } } };
  assert.equal(hermesHealth(gateway, dashboard, status).ready, true);
  assert.equal(hermesHealth(gateway, dashboard, status).activeAgents, 2);
  for (const args of [[undefined, dashboard, status], [gateway, undefined, status], [gateway, dashboard, undefined],
    [{ status: 'ok', platform: 'other' }, dashboard, status], [gateway, dashboard, { ...status, gateway_running: false }],
    [gateway, dashboard, { ...status, gateway_heartbeat_stale_s: 120 }],
    [gateway, dashboard, { ...status, overall: 'degraded' }], [gateway, dashboard, {}]]) {
    assert.equal(hermesHealth(...args).ready, false);
  }
  const degraded = structuredClone(status);
  degraded.components.platforms = { status: 'degraded', connected: 1, configured: 2 };
  assert.equal(hermesHealth(gateway, dashboard, degraded).ready, false);
  assert.equal(hermesHealth(gateway, dashboard, degraded).components.platforms, false);
  assert.equal(hermesHealth(gateway, dashboard, degraded).platformsConnected, 1);
  assert.equal(hermesHealth(gateway, dashboard, { ...status, components: {} }).ready, false);
});
test('checks reject login HTML, incorrect JSON, and 401 as Kubernetes readiness', async () => {
  let status = 200;
  let body = 'ok';
  const server = createServer((_req, res) => { res.writeHead(status); res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await checkEndpoint({ url, kubernetesAuth: true }, { token: 'test' }), true);
    status = 401;
    assert.equal(await checkEndpoint({ url, kubernetesAuth: true }, { token: 'test' }), false);
    status = 200; body = '<html>sign in</html>';
    assert.equal(await checkEndpoint({ url, jsonField: 'database', jsonValue: 'ok' }, {}), false);
    body = '{"database":"ok"}';
    assert.equal(await checkEndpoint({ url, jsonField: 'database', jsonValue: 'ok' }, {}), true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('probe diagnostics distinguish HTTP, JSON and readiness failures without response contents', async () => {
  let status = 200;
  let body = 'ok';
  const server = createServer((_req, res) => { res.writeHead(status); res.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await probeEndpoint({ url, kubernetesAuth: true }, { token: 'test' }), { ok: true });
    body = 'private diagnostic';
    assert.deepEqual(await probeEndpoint({ url, kubernetesAuth: true }, { token: 'test' }),
      { ok: false, reason: 'unexpected readiness response' });
    status = 401;
    assert.deepEqual(await probeEndpoint({ url }, {}), { ok: false, reason: 'HTTP 401' });
    status = 200;
    const check = { url, jsonField: 'database', jsonValue: 'ok' };
    assert.deepEqual(await probeEndpoint(check, {}), { ok: false, reason: 'invalid JSON' });
    for (body of ['null', '{"database":"private diagnostic"}', '{}']) {
      assert.deepEqual(await probeEndpoint(check, {}), { ok: false, reason: 'JSON field mismatch' });
    }
    body = '{"database":"ok"}';
    assert.deepEqual(await probeEndpoint(check, {}), { ok: true });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('pinned probes bypass DNS, preserve the Host header, and retain connection error codes', async () => {
  let host;
  const server = createServer((req, res) => { host = req.headers.host; res.end('{"database":"ok"}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const check = { url: `http://sentinel.invalid:${port}/api/health`, address: '127.0.0.1',
    jsonField: 'database', jsonValue: 'ok' };
  try {
    assert.deepEqual(await probeEndpoint(check, {}), { ok: true });
    assert.equal(host, `sentinel.invalid:${port}`);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(await probeEndpoint(check, {}), { ok: false, reason: 'ECONNREFUSED' });
});
