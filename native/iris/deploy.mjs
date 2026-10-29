// From the repo root: node native/iris/deploy.mjs [--only power] [iris@iris.khzaw.dev]
// Copies existing receiver credentials without printing or storing a local plaintext copy.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const source = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const powerOnly = argv[0] === '--only' && argv[1] === 'power';
const positional = powerOnly ? argv.slice(2) : argv;
const host = positional[0] ?? 'iris@iris.khzaw.dev';
if (positional.length > 1 || !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?(?:[A-Za-z0-9][A-Za-z0-9._-]*|\[[A-Fa-f0-9:]+\])$/.test(host)) {
  throw new Error('Usage: node deploy.mjs [--only power] [iris@iris.khzaw.dev]');
}
// A read-only remote check must succeed before cluster reads or installation changes.
execFileSync('ssh', ['-o', 'BatchMode=yes', host,
  'test -f /opt/homebrew/bin/macmon && test -x /opt/homebrew/bin/macmon']);
if (powerOnly) {
  execFileSync('ssh', ['-o', 'BatchMode=yes', host, 'umask 077; mkdir -p ~/.local/share/rangoonpulse/iris']);
  execFileSync('scp', ['-q', `${source}/power.mjs`, `${source}/install.mjs`,
    `${host}:.local/share/rangoonpulse/iris/`], { stdio: 'inherit' });
  execFileSync('ssh', ['-o', 'BatchMode=yes', host,
    '/opt/homebrew/opt/node/bin/node ~/.local/share/rangoonpulse/iris/install.mjs --only power'], { stdio: 'inherit' });
} else {
  const env = { ...process.env, KUBECONFIG: process.env.KUBECONFIG || resolve('kubeconfig') };
  function get(namespace, kind, name) {
    return JSON.parse(execFileSync('kubectl', ['-n', namespace, 'get', kind, name, '-o', 'json'], { env }));
  }
  const settings = get('flux-system', 'configmap', 'cluster-settings').data;
  const receivers = get('monitoring', 'secret', 'alertmanager-receivers').data;
  const identity = get('monitoring', 'secret', 'iris-watchdog-api-token').data;
  const decode = value => Buffer.from(value, 'base64').toString('utf8');
  if (!identity?.token || !identity['ca.crt']) throw new Error('Wait for the service-account token controller');
  const config = JSON.parse(readFileSync(`${source}/config.example.json`, 'utf8'));
  config.listenAddress = settings.IRIS_MAC_MINI_IP;
  config.clusterChecks[0].url = `https://${settings.PRIMARY_NODE_IP}:6443/readyz`;
  config.clusterChecks[1].url = `https://grafana.${settings.BASE_DOMAIN}/api/health`;
  config.clusterChecks[1].address = settings.INGRESS_VIP;
  const payload = {
    config,
    notifications: {
      telegramBotToken: decode(receivers.TELEGRAM_BOT_TOKEN), telegramChatId: 19198668,
      discordWebhookUrl: decode(receivers.DISCORD_WEBHOOK_URL),
    },
    kubernetes: { token: decode(identity.token), ca: decode(identity['ca.crt']) },
  };
  execFileSync('ssh', ['-o', 'BatchMode=yes', host,
    'umask 077; mkdir -p ~/.local/share/rangoonpulse/iris ~/.config/rangoonpulse/iris']);
  execFileSync('scp', ['-q', `${source}/watchdog.mjs`, `${source}/install.mjs`, `${source}/smoke.mjs`, `${source}/power.mjs`,
    `${host}:.local/share/rangoonpulse/iris/`], { stdio: 'inherit' });
  const remote = `import {writeFile,chmod} from 'node:fs/promises'; import {homedir} from 'node:os';
let input=''; for await (const chunk of process.stdin) input+=chunk;
process.umask(0o077); const payload=JSON.parse(input);
for (const [name,value] of Object.entries(payload)) {
  const path=homedir()+'/.config/rangoonpulse/iris/'+name+'.json';
  await writeFile(path, JSON.stringify(value,null,2)+'\\n', {mode:0o600}); await chmod(path,0o600);
}
await import(homedir()+'/.local/share/rangoonpulse/iris/install.mjs');`;
  const quoted = `'${remote.replaceAll("'", "'\\''")}'`;
  execFileSync('ssh', ['-o', 'BatchMode=yes', host, `/opt/homebrew/bin/node --input-type=module -e ${quoted}`], {
    input: JSON.stringify(payload), stdio: ['pipe', 'inherit', 'inherit'],
  });
}
