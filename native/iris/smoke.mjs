// On Iris: node smoke.mjs. Sends explicitly marked TEST firing/recovery messages.
// Exercises actual public-DNS resolution and delivery without disrupting the cluster.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { advance, deliver, independentLookup, send, notificationDue } from './watchdog.mjs';

const dir = `${homedir()}/.config/rangoonpulse/iris`;
const config = JSON.parse(await readFile(`${dir}/config.json`, 'utf8'));
const credentials = JSON.parse(await readFile(`${dir}/notifications.json`, 'utf8'));
const lookup = independentLookup(config.dnsServers);
let state = {};
for (let i = 0; i < config.failureThreshold; i++) state = advance(state, false, i, config);
if (!state.firing) throw new Error('failure threshold did not fire');
for (const phase of ['FIRING', 'RESOLVED']) {
  await deliver(state, Date.now() / 1000, config.repeatSeconds, async destination => {
    await send(destination, credentials,
      `[TEST ${phase}] Iris external sentinel notification drill.\n` +
      'Synthetic probe failure/recovery; the cluster was NOT stopped.\n' +
      `Native macOS launchd implementation, direct public DNS (${config.dnsServers.join(', ')}), no Alertmanager dependency.`, lookup);
    console.log(`TEST ${phase}: ${destination} delivered`);
  });
  for (const destination of ['telegram', 'discord']) {
    if (notificationDue(state, destination, Date.now() / 1000, config.repeatSeconds)) {
      throw new Error(`${destination} delivery failed`);
    }
  }
  for (let i = 0; i < config.recoveryThreshold; i++) state = advance(state, true, i, config);
}
