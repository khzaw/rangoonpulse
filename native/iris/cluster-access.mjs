// Renew the iris user's LAN kubeconfig using its existing Talos administrator identity.
import { execFileSync } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const renewBeforeMs = 30 * 24 * 60 * 60 * 1000;
const kubectl = '/opt/homebrew/bin/kubectl';
const talosctl = '/opt/homebrew/bin/talosctl';

export function runTool(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Child output and exec errors can contain the credential document.
    throw new Error(`${command === talosctl ? 'Talos' : 'Kubernetes'} credential check failed; existing kubeconfig preserved`);
  }
}

export function clusterCredentials(config, server) {
  const cluster = config.clusters?.find(entry => entry.cluster.server === server);
  const context = config.contexts?.find(entry => entry.context.cluster === cluster?.name);
  const user = config.users?.find(entry => entry.name === context?.context.user);
  if (!cluster || !context || !user || cluster.cluster['insecure-skip-tls-verify']
      || !cluster.cluster['certificate-authority-data'] || user.user.exec || user.user['auth-provider']) {
    throw new Error('Expected CA-validated LAN cluster and embedded client certificate');
  }
  const certificate = new X509Certificate(Buffer.from(user.user['client-certificate-data'], 'base64'));
  const privateKey = createPrivateKey(Buffer.from(user.user['client-key-data'], 'base64'));
  if (!certificate.checkPrivateKey(privateKey)) throw new Error('Client certificate and private key do not match');
  return { context: context.name, expiresAt: Date.parse(certificate.validTo), validFrom: Date.parse(certificate.validFrom) };
}

export function mergeKubeconfig(existing, fresh) {
  const result = { ...existing, apiVersion: 'v1', kind: 'Config' };
  for (const section of ['clusters', 'users', 'contexts']) {
    const entries = new Map((existing[section] ?? []).map(entry => [entry.name, entry]));
    for (const entry of fresh[section]) entries.set(entry.name, entry);
    result[section] = [...entries.values()];
  }
  result['current-context'] = existing['current-context'] || fresh['current-context'];
  return result;
}

export async function renewClusterAccess({ home = homedir(), endpoint, force = false, now = Date.now(), run = runTool }) {
  if (!isIP(endpoint)) throw new Error('Expected a node IP from cluster settings');
  const server = `https://${isIP(endpoint) === 6 ? `[${endpoint}]` : endpoint}:6443`;
  const directory = join(home, '.kube');
  const target = join(directory, 'config');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let existing = {};
  try {
    await readFile(target);
    existing = JSON.parse(run(kubectl, ['--kubeconfig', target, 'config', 'view', '--raw', '-o', 'json']));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!force) {
    try {
      const credentials = clusterCredentials(existing, server);
      if (credentials.expiresAt - now > renewBeforeMs && credentials.validFrom <= now
          && run(kubectl, ['--kubeconfig', target, '--context', credentials.context,
            '--request-timeout=10s', 'get', '--raw=/readyz']).trim() === 'ok') {
        await chmod(target, 0o600);
        return { renewed: false, expiresAt: new Date(credentials.expiresAt).toISOString() };
      }
    } catch { /* Invalid, expired or rejected credentials must be refreshed through Talos. */ }
  }
  const temporary = await mkdtemp(join(directory, '.rangoonpulse-renew-'));
  const candidate = join(temporary, 'config');
  try {
    const downloaded = run(talosctl, ['--talosconfig', join(home, '.talos', 'config'),
      '-e', endpoint, '-n', endpoint, 'kubeconfig', '-', '--merge=false']);
    await writeFile(candidate, downloaded, { mode: 0o600 });
    const fresh = JSON.parse(run(kubectl, ['--kubeconfig', candidate, 'config', 'view', '--raw', '-o', 'json']));
    const credentials = clusterCredentials(fresh, server);
    if (credentials.validFrom > now || credentials.expiresAt - now <= renewBeforeMs) {
      throw new Error('Talos returned a client certificate outside the required validity window');
    }
    const args = ['--kubeconfig', candidate, '--context', credentials.context, '--request-timeout=10s'];
    if (run(kubectl, [...args, 'get', '--raw=/readyz']).trim() !== 'ok') {
      throw new Error('Cluster API is not ready; existing kubeconfig preserved');
    }
    run(kubectl, [...args, 'get', 'nodes', '-o', 'name']);
    await writeFile(candidate, `${JSON.stringify(mergeKubeconfig(existing, fresh), null, 2)}\n`, { mode: 0o600 });
    await rename(candidate, target);
    return { renewed: true, expiresAt: new Date(credentials.expiresAt).toISOString() };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--force')) throw new Error('Usage: node cluster-access.mjs [--force]');
    const config = JSON.parse(await readFile(join(homedir(), '.config/rangoonpulse/iris/cluster-access.json'), 'utf8'));
    const result = await renewClusterAccess({ endpoint: config.endpoint, force: process.argv.includes('--force') });
    if (result.renewed) console.log(`Iris Kubernetes credentials renewed; expires ${result.expiresAt}`);
  } catch {
    console.error('Iris Kubernetes credential renewal failed; existing kubeconfig preserved. Check LAN/Talos access and certificate validity.');
    process.exitCode = 1;
  }
}
