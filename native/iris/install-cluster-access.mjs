// Run from the repository on Iris as the existing iris login user.
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { renewClusterAccess } from './cluster-access.mjs';

if (process.platform !== 'darwin' || process.env.USER !== 'iris' || process.argv.length !== 2) {
  throw new Error('Run node native/iris/install-cluster-access.mjs on Iris as iris');
}
process.umask(0o077);
const home = homedir();
const repo = fileURLToPath(new URL('../../', import.meta.url));
const settings = await readFile(join(repo, 'flux/cluster-settings.yaml'), 'utf8');
const endpoint = settings.match(/^  PRIMARY_NODE_IP: (\S+)$/m)?.[1];
if (!isIP(endpoint ?? '')) throw new Error('PRIMARY_NODE_IP is missing or invalid');
const root = join(home, '.local/share/rangoonpulse/iris');
const configuration = join(home, '.config/rangoonpulse/iris');
const logs = join(home, 'Library/Logs/rangoonpulse');
const agents = join(home, 'Library/LaunchAgents');
for (const path of [root, configuration, logs, agents]) await mkdir(path, { recursive: true, mode: 0o700 });

// Prove access before replacing the scheduled job or the repository alias.
const result = await renewClusterAccess({ home, endpoint }).catch(() => {
  throw new Error('Iris cluster access could not be validated; existing credentials and scheduled job preserved');
});
await copyFile(new URL('./cluster-access.mjs', import.meta.url), join(root, 'cluster-access.mjs'));
await chmod(join(root, 'cluster-access.mjs'), 0o600);
await writeFile(join(configuration, 'cluster-access.json'), `${JSON.stringify({ endpoint })}\n`, { mode: 0o600 });
const temporary = await mkdtemp(join(home, '.kube/.rangoonpulse-link-'));
try {
  const link = join(temporary, 'kubeconfig');
  await symlink(join(home, '.kube/config'), link);
  await rename(link, join(repo, 'kubeconfig'));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const label = 'dev.khzaw.iris.cluster-access';
const plist = join(agents, `${label}.plist`);
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/opt/node/bin/node</string><string>${xml(join(root, 'cluster-access.mjs'))}</string></array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>21600</integer>
<key>StandardOutPath</key><string>${xml(join(logs, `${label}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(join(logs, `${label}.log`))}</string>
</dict></plist>\n`, { mode: 0o600 });
await chmod(plist, 0o600);
execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'inherit' });
const domain = `gui/${process.getuid()}`;
let unloaded = false;
try {
  execFileSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
  unloaded = true;
} catch { /* First installation. */ }
for (let attempt = 0; ; attempt++) {
  try {
    execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' });
    break;
  } catch (error) {
    if (!unloaded || error.status !== 5 || attempt >= 39) throw error;
    await delay(250);
  }
}
console.log(`Installed ${label}; checks every six hours and renews within 30 days of expiry.`);
console.log(`Host kubeconfig expires ${result.expiresAt}; repository alias uses the same file.`);
