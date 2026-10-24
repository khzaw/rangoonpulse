// Run on Iris as the existing iris login user after copying configuration files.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

process.umask(0o077);
const home = homedir();
const root = `${home}/.local/share/rangoonpulse/iris`;
const state = `${home}/.local/state/rangoonpulse/iris`;
const config = JSON.parse(await readFile(`${home}/.config/rangoonpulse/iris/config.json`, 'utf8'));
for (const path of [`${state}/textfile`, `${home}/Library/Logs/rangoonpulse`, `${home}/Library/LaunchAgents`]) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const jobs = {
  'dev.khzaw.iris.node-exporter': ['/opt/homebrew/opt/node_exporter/bin/node_exporter',
    `--web.listen-address=${config.listenAddress}:9100`, `--collector.textfile.directory=${state}/textfile`,
    '--collector.filesystem.mount-points-include=^(/|/System/Volumes/Data)$'],
  'dev.khzaw.iris.watchdog': ['/opt/homebrew/opt/node/bin/node', `${root}/watchdog.mjs`],
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
<key>StandardOutPath</key><string>${home}/Library/Logs/rangoonpulse/${label}.log</string>
<key>StandardErrorPath</key><string>${home}/Library/Logs/rangoonpulse/${label}.log</string>
</dict></plist>\n`, { mode: 0o600 });
  execFileSync('/usr/bin/plutil', ['-lint', path], { stdio: 'inherit' });
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); }
  catch { /* first installation has no existing job */ }
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, path]);
  console.log(`Installed ${label} (login LaunchAgent, KeepAlive)`);
}
