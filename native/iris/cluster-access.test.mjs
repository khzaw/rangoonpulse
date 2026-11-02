import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeKubeconfig, renewClusterAccess, runTool } from './cluster-access.mjs';

const endpoint = '192.0.2.10';
let directory;
let fresh;
let expiring;

async function certificateConfig(days) {
  const key = join(directory, `key-${days}.pem`);
  const certificate = join(directory, `certificate-${days}.pem`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-subj', '/CN=iris-test', '-days', String(days), '-keyout', key, '-out', certificate], { stdio: 'ignore' });
  const data = (await readFile(certificate)).toString('base64');
  return {
    apiVersion: 'v1', kind: 'Config', 'current-context': 'admin@rangoonpulse',
    clusters: [{ name: 'rangoonpulse', cluster: { server: `https://${endpoint}:6443`, 'certificate-authority-data': data } }],
    users: [{ name: 'admin', user: { 'client-certificate-data': data, 'client-key-data': (await readFile(key)).toString('base64') } }],
    contexts: [{ name: 'admin@rangoonpulse', context: { cluster: 'rangoonpulse', user: 'admin' } }],
  };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'iris-certificates-'));
  fresh = await certificateConfig(365);
  expiring = await certificateConfig(1);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

async function fixture(t, config = expiring, replacement = fresh) {
  const home = await mkdtemp(join(tmpdir(), 'iris-access-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const kube = join(home, '.kube');
  const target = join(kube, 'config');
  await mkdir(kube, { mode: 0o700 });
  if (config) await writeFile(target, JSON.stringify(config), { mode: 0o600 });
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command.endsWith('/talosctl')) return JSON.stringify(replacement);
    if (args.includes('view')) {
      // The real CLI reads this file as YAML or JSON; test documents use JSON.
      return execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1]))',
        args[args.indexOf('--kubeconfig') + 1]], { encoding: 'utf8' });
    }
    if (args.includes('--raw=/readyz')) return 'ok\n';
    if (args.includes('nodes')) return 'node/test\n';
    throw new Error('Unexpected command');
  };
  return { home, target, kube, calls, run };
}

test('healthy credentials do not need renewal or a Talos call', async t => {
  const setup = await fixture(t, fresh);
  const original = await readFile(setup.target, 'utf8');
  assert.equal((await renewClusterAccess({ ...setup, endpoint })).renewed, false);
  assert.equal(await readFile(setup.target, 'utf8'), original);
  assert.equal(setup.calls.some(call => call.command.endsWith('/talosctl')), false);
});

test('renews before expiry, validates access, and publishes mode 0600 without temporary credentials left behind', async t => {
  const setup = await fixture(t);
  const original = await readFile(setup.target, 'utf8');
  const run = (command, args) => {
    if (args.includes('nodes')) assert.equal(execFileSync('cat', [setup.target], { encoding: 'utf8' }), original);
    return setup.run(command, args);
  };
  const result = await renewClusterAccess({ ...setup, endpoint, run });
  assert.equal(result.renewed, true);
  assert.deepEqual(JSON.parse(await readFile(setup.target, 'utf8')), fresh);
  assert.equal((await stat(setup.target)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(setup.kube), ['config']);
});

test('preserves unrelated clusters, users, contexts, preferences and the selected context', () => {
  const other = {
    ...expiring, preferences: { colors: true }, 'current-context': 'other',
    clusters: [...expiring.clusters, { name: 'other', cluster: { server: 'https://other.example' } }],
    contexts: [...expiring.contexts, { name: 'other', context: { cluster: 'other', user: 'other' } }],
    users: [...expiring.users, { name: 'other', user: { token: 'unrelated-test-token' } }],
  };
  const merged = mergeKubeconfig(other, fresh);
  assert.equal(merged['current-context'], 'other');
  for (const section of ['clusters', 'users', 'contexts']) {
    assert.deepEqual(merged[section], [fresh[section][0], other[section][1]]);
  }
  assert.deepEqual(merged.preferences, other.preferences);
});

test('Talos failure leaves the existing kubeconfig untouched and removes temporary files', async t => {
  const setup = await fixture(t);
  const original = await readFile(setup.target, 'utf8');
  await assert.rejects(renewClusterAccess({ ...setup, endpoint, run(command, args) {
    if (command.endsWith('/talosctl')) throw new Error('Talos unavailable');
    return setup.run(command, args);
  } }), /Talos unavailable/);
  assert.equal(await readFile(setup.target, 'utf8'), original);
  assert.deepEqual(await readdir(setup.kube), ['config']);
});

test('a rejected but unexpired client certificate is renewed', async t => {
  const setup = await fixture(t, fresh);
  const result = await renewClusterAccess({ ...setup, endpoint, run(command, args) {
    if (args.includes('--raw=/readyz') && args[1] === setup.target) throw new Error('Unauthorized');
    return setup.run(command, args);
  } });
  assert.equal(result.renewed, true);
});

test('expired credentials and a missing kubeconfig both recover through Talos', async t => {
  const cert = new X509Certificate(Buffer.from(expiring.users[0].user['client-certificate-data'], 'base64'));
  const now = Date.parse(cert.validTo) + 1000;
  for (const config of [expiring, undefined]) {
    const setup = await fixture(t, config ?? null);
    assert.equal((await renewClusterAccess({ ...setup, endpoint, now })).renewed, true);
    assert.deepEqual(JSON.parse(await readFile(setup.target, 'utf8')), fresh);
  }
});

test('wrong endpoints, disabled TLS verification, old certificates and failed probes never replace working credentials', async t => {
  const wrongServer = structuredClone(fresh);
  wrongServer.clusters[0].cluster.server = 'https://wrong.example:6443';
  const insecure = structuredClone(fresh);
  insecure.clusters[0].cluster['insecure-skip-tls-verify'] = true;
  for (const replacement of [wrongServer, insecure, expiring, fresh]) {
    const setup = await fixture(t, expiring, replacement);
    const original = await readFile(setup.target, 'utf8');
    await assert.rejects(renewClusterAccess({ ...setup, endpoint, run(command, args) {
      if (replacement === fresh && args.includes('nodes')) throw new Error('Forbidden');
      return setup.run(command, args);
    } }));
    assert.equal(await readFile(setup.target, 'utf8'), original);
    assert.deepEqual(await readdir(setup.kube), ['config']);
  }
});

test('forced renewal exercises the full download and publication even when credentials are fresh', async t => {
  const setup = await fixture(t, fresh);
  assert.equal((await renewClusterAccess({ ...setup, endpoint, force: true })).renewed, true);
});

test('child-process failures do not expose credential-like stdout or stderr', () => {
  assert.throws(() => runTool(process.execPath, ['-e',
    'console.log("PRIVATE-STDOUT"); console.error("PRIVATE-STDERR"); process.exit(1)']), error => {
    assert.doesNotMatch(error.message, /PRIVATE/);
    assert.equal(error.cause, undefined);
    return true;
  });
});
