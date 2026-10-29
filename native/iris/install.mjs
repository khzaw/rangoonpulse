// Run on Iris as the existing iris login user; --only power needs no configuration.
import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
const powerOnly = argv.length === 2 && argv[0] === '--only' && argv[1] === 'power';
if (argv.length && !powerOnly) throw new Error('Usage: node install.mjs [--only power]');
// Check macmon before changing files or replacing any running job.
try {
  await access('/opt/homebrew/bin/macmon', constants.X_OK);
  if (!(await stat('/opt/homebrew/bin/macmon')).isFile()) throw new Error('Not a file');
} catch (cause) {
  throw new Error('Required executable unavailable: /opt/homebrew/bin/macmon', { cause });
}
process.umask(0o077);
const home = homedir();
const root = `${home}/.local/share/rangoonpulse/iris`;
const state = `${home}/.local/state/rangoonpulse/iris`;
const config = powerOnly ? undefined
  : JSON.parse(await readFile(`${home}/.config/rangoonpulse/iris/config.json`, 'utf8'));
for (const path of [`${state}/textfile`, `${home}/Library/Logs/rangoonpulse`, `${home}/Library/LaunchAgents`]) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const jobs = {
  ...(!powerOnly && {
    'dev.khzaw.iris.node-exporter': ['/opt/homebrew/opt/node_exporter/bin/node_exporter',
      `--web.listen-address=${config.listenAddress}:9100`, `--collector.textfile.directory=${state}/textfile`,
      '--collector.filesystem.mount-points-include=^(/|/System/Volumes/Data)$'],
    'dev.khzaw.iris.watchdog': ['/opt/homebrew/opt/node/bin/node', `${root}/watchdog.mjs`],
  }),
  'dev.khzaw.iris.power': ['/opt/homebrew/opt/node/bin/node', `${root}/power.mjs`],
};
for (const [label, args] of Object.entries(jobs)) {
  const path = `${home}/Library/LaunchAgents/${label}.plist`;
  await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StandardOutPath</key><string>${xml(`${home}/Library/Logs/rangoonpulse/${label}.log`)}</string>
<key>StandardErrorPath</key><string>${xml(`${home}/Library/Logs/rangoonpulse/${label}.log`)}</string>
</dict></plist>\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  execFileSync('/usr/bin/plutil', ['-lint', path], { stdio: 'inherit' });
  let unloaded = false;
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' });
    unloaded = true;
  }
  catch { /* first installation has no existing job */ }
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, path], { stdio: 'pipe' });
      break;
    } catch (error) {
      // bootout returns before launchd finishes removing the old job. Retry only this race.
      if (!unloaded || error.status !== 5 || attempt >= 39) throw error;
      await delay(250);
    }
  }
  console.log(`Installed ${label} (login LaunchAgent, KeepAlive)`);
}
