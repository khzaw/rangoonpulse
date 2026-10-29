import nodeTest, { after } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { runCLI, scratch, macmon, preflight, source, prepareFixture, cleanupFixture } from './deployment-harness.mjs';

// Keep VM flags out of the standard test command and the other test files.
if (typeof vm.SourceTextModule !== 'function') {
  nodeTest('deployment suite (isolated VM child)', t => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath,
      ['--experimental-vm-modules', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)],
      { env, encoding: 'utf8' });
    if (child.stdout) t.diagnostic(child.stdout);
    if (child.stderr) t.diagnostic(child.stderr);
    assert.ifError(child.error);
    assert.equal(child.status, 0, `Deployment child failed (${child.signal ?? child.status})`);
    if (/^# pass 0$/m.test(child.stdout) && /^# skipped 14$/m.test(child.stdout)) {
      t.skip('Sandbox denies real filesystem fixtures; all 14 deployment cases were explicitly skipped.');
    }
  });
} else {
  after(cleanupFixture);
  const skip = await prepareFixture();
  const test = (name, body) => nodeTest(name, { skip }, body);
  const power = 'dev.khzaw.iris.power';
  const exporter = 'dev.khzaw.iris.node-exporter';
  const watchdog = 'dev.khzaw.iris.watchdog';
  const root = `${scratch}/.local/share/rangoonpulse/iris`;
  const state = `${scratch}/.local/state/rangoonpulse/iris`;
  const plist = label => `${scratch}/Library/LaunchAgents/${label}.plist`;
  const bootout = label => ({ file: '/bin/launchctl', args: ['bootout', `gui/501/${label}`], options: { stdio: 'ignore' } });
  const bootstrap = label => ({ file: '/bin/launchctl', args: ['bootstrap', 'gui/501', plist(label)], options: { stdio: 'pipe' } });
  const lint = label => ({ file: '/usr/bin/plutil', args: ['-lint', plist(label)], options: { stdio: 'inherit' } });
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  test('power-only install never reads config and writes exactly the independent login LaunchAgent', async () => {
    const result = await runCLI('install.mjs', { args: ['--only', 'power'] });
    assert.ifError(result.error);
    assert.deepEqual([...result.writes.keys()], [plist(power)]);
    assert.equal(result.writes.get(plist(power)), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${power}</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/opt/node/bin/node</string><string>${root}/power.mjs</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>WorkingDirectory</key><string>${root}</string>
<key>StandardOutPath</key><string>${scratch}/Library/Logs/rangoonpulse/${power}.log</string>
<key>StandardErrorPath</key><string>${scratch}/Library/Logs/rangoonpulse/${power}.log</string>
</dict></plist>\n`);
    assert.deepEqual(result.calls, [lint(power), bootout(power), bootstrap(power)]);
    assert.equal(result.events.filter(e => /readFile/.test(e.type)).length, 0);
    assert.deepEqual(result.events.filter(e => e.type === 'mkdir').map(e => e.path), [
      `${state}/textfile`, `${scratch}/Library/Logs/rangoonpulse`, `${scratch}/Library/LaunchAgents`,
    ]);
    assert.ok(result.events.filter(e => e.type === 'mkdir').every(e => e.options.mode === 0o700));
    assert.deepEqual(result.events.filter(e => e.type === 'writeFile'), [
      { type: 'writeFile', path: plist(power), options: { mode: 0o600 } },
    ]);
    assert.deepEqual(result.events.filter(e => e.type === 'chmod'), [{ type: 'chmod', path: plist(power), mode: 0o600 }]);
    assert.deepEqual(result.events[0], { type: 'access', path: macmon, mode: constants.X_OK });
    assert.ok(result.events.findIndex(e => e.type === 'stat') < result.events.findIndex(e => e.type === 'umask'));
  });

  test('default installer preserves exporter/watchdog arguments and adds power', async () => {
    const result = await runCLI('install.mjs', { config: { listenAddress: '10.0.0.66' } });
    assert.ifError(result.error);
    assert.deepEqual([...result.writes.keys()], [exporter, watchdog, power].map(plist));
    assert.deepEqual(result.calls, [exporter, watchdog, power].flatMap(label => [lint(label), bootout(label), bootstrap(label)]));
    const args = label => [...result.writes.get(plist(label)).match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/s)[1]
      .matchAll(/<string>(.*?)<\/string>/g)].map(match => match[1]);
    assert.deepEqual(args(exporter), ['/opt/homebrew/opt/node_exporter/bin/node_exporter',
      '--web.listen-address=10.0.0.66:9100', `--collector.textfile.directory=${state}/textfile`,
      '--collector.filesystem.mount-points-include=^(/|/System/Volumes/Data)$']);
    assert.deepEqual(args(watchdog), ['/opt/homebrew/opt/node/bin/node', `${root}/watchdog.mjs`]);
    assert.deepEqual(args(power), ['/opt/homebrew/opt/node/bin/node', `${root}/power.mjs`]);
    assert.equal(result.events.filter(e => e.type === 'readFile').length, 1);
    assert.ok(result.events.findIndex(e => e.type === 'access') < result.events.findIndex(e => e.type === 'readFile'));
    assert.equal(result.events.filter(e => e.type === 'chmod' && e.mode === 0o600).length, 3);
  });

  test('installer escapes all plist paths, including logs', async () => {
    const home = `${scratch}/<&> Iris`;
    const result = await runCLI('install.mjs', { args: ['--only', 'power'], home });
    assert.ifError(result.error);
    const content = [...result.writes.values()][0];
    assert.ok(content.includes(`<string>${xml(home)}/.local/share/rangoonpulse/iris/power.mjs</string>`));
    assert.ok(content.includes(`<string>${xml(home)}/Library/Logs/rangoonpulse/${power}.log</string>`));
    assert.equal(content.includes(home), false);
  });

  test('missing/non-executable macmon fails before any installer change or config read, in both modes', async () => {
    for (const args of [[], ['--only', 'power']]) {
      const result = await runCLI('install.mjs', { args, missingMacmon: true });
      assert.match(result.error?.message ?? '', /macmon/);
      assert.deepEqual(result.events, [{ type: 'access', path: macmon, mode: constants.X_OK }]);
      assert.equal(result.writes.size, 0);
      assert.deepEqual(result.calls, []);
    }
  });

  test('an executable directory is not accepted as macmon', async () => {
    const result = await runCLI('install.mjs', { args: ['--only', 'power'], macmonIsFile: false });
    assert.match(result.error?.message ?? '', /macmon/);
    assert.ok(result.events.every(e => ['access', 'stat'].includes(e.type)));
  });

  test('invalid installer targets/arguments fail before reads, commands, or writes', async () => {
    for (const args of [['--only'], ['--only', 'watchdog'], ['--only', 'POWER'], ['--only', 'power', 'extra'],
      ['power'], ['--unknown']]) {
      const result = await runCLI('install.mjs', { args });
      assert.match(result.error?.message ?? '', /Usage:.*install\.mjs/);
      assert.deepEqual(result.events, []);
    }
  });

  test('successful bootout permits bounded retries only for bootstrap status 5', async () => {
    let attempts = 0;
    const result = await runCLI('install.mjs', { args: ['--only', 'power'], command: call => {
      if (call.args[0] === 'bootstrap' && ++attempts < 3) throw Object.assign(new Error('race'), { status: 5 });
    } });
    assert.ifError(result.error);
    assert.equal(attempts, 3);
    assert.deepEqual(result.calls, [lint(power), bootout(power), bootstrap(power), bootstrap(power), bootstrap(power)]);
    assert.deepEqual(result.events.filter(e => e.type === 'delay'), [{ type: 'delay', ms: 250 }, { type: 'delay', ms: 250 }]);
  });

  test('bootstrap status 5 exhausts after 40 attempts and 39 pauses', async () => {
    const result = await runCLI('install.mjs', { args: ['--only', 'power'], command: call => {
      if (call.args[0] === 'bootstrap') throw Object.assign(new Error('still unloading'), { status: 5 });
    } });
    assert.match(result.error?.message ?? '', /still unloading/);
    assert.equal(result.calls.filter(call => call.args[0] === 'bootstrap').length, 40);
    assert.equal(result.events.filter(e => e.type === 'delay' && e.ms === 250).length, 39);
  });

  test('first install has no retry on status 5; other bootstrap errors never retry', async () => {
    for (const unloaded of [true, false]) {
      const result = await runCLI('install.mjs', { args: ['--only', 'power'], command: call => {
        if (call.args[0] === 'bootout' && !unloaded) throw new Error('not loaded');
        if (call.args[0] === 'bootstrap') throw Object.assign(new Error('bootstrap failed'), { status: unloaded ? 78 : 5 });
      } });
      assert.match(result.error?.message ?? '', /bootstrap failed/);
      assert.equal(result.calls.filter(call => call.args[0] === 'bootstrap').length, 1);
      assert.equal(result.events.filter(e => e.type === 'delay').length, 0);
    }
  });

  test('failed plist lint prevents bootout/bootstrap', async () => {
    const result = await runCLI('install.mjs', { args: ['--only', 'power'], command: call => {
      if (call.file === '/usr/bin/plutil') throw new Error('invalid plist');
    } });
    assert.match(result.error?.message ?? '', /invalid plist/);
    assert.deepEqual(result.calls, [lint(power)]);
  });

  const ssh = (host, remote) => ({ file: 'ssh', args: ['-o', 'BatchMode=yes', host, remote] });

  test('power-only deployment copies only power and installer, without cluster/config/credential access', async () => {
    for (const host of ['iris@iris.khzaw.dev', 'iris@10.0.0.66', 'iris-mini']) {
      const args = ['--only', 'power', ...(host === 'iris@iris.khzaw.dev' ? [] : [host])];
      const result = await runCLI('deploy.mjs', { args });
      assert.ifError(result.error);
      assert.deepEqual(result.calls, [
        ssh(host, preflight),
        ssh(host, 'umask 077; mkdir -p ~/.local/share/rangoonpulse/iris'),
        { file: 'scp', args: ['-q', `${source}/power.mjs`, `${source}/install.mjs`,
          `${host}:.local/share/rangoonpulse/iris/`], options: { stdio: 'inherit' } },
        { ...ssh(host, '/opt/homebrew/opt/node/bin/node ~/.local/share/rangoonpulse/iris/install.mjs --only power'),
          options: { stdio: 'inherit' } },
      ]);
      assert.ok(result.events.every(e => e.type === 'exec'));
      assert.equal(result.writes.size, 0);
    }
  });

  test('missing remote macmon aborts both deployment modes before Kubernetes reads or copying', async () => {
    for (const args of [[], ['iris@10.0.0.66'], ['--only', 'power']]) {
      const host = args.length === 1 ? args[0] : 'iris@iris.khzaw.dev';
      const result = await runCLI('deploy.mjs', { args, command: call => {
        if (call.file === 'ssh') throw new Error('macmon missing or not executable');
        throw new Error('Must not reach cluster or copying');
      } });
      assert.match(result.error?.message ?? '', /macmon/);
      assert.deepEqual(result.calls, [ssh(host, preflight)]);
      assert.ok(result.events.every(e => e.type === 'exec'));
    }
  });

  test('invalid deploy targets/options/hosts fail before all external access', async () => {
    for (const args of [['--only'], ['--only', 'watchdog'], ['--only', 'POWER'], ['--only', 'power', 'host', 'extra'],
      ['host', 'extra'], ['--unknown'], ['--only', 'power', '-oProxyCommand=bad'], ['iris@host;touch bad'],
      ['iris@host\nother'], [''], ['--only', 'power', '']]) {
      const result = await runCLI('deploy.mjs', { args });
      assert.match(result.error?.message ?? '', /Usage:.*deploy\.mjs/);
      assert.deepEqual(result.events, []);
    }
  });

  test('full deployment retains default/custom host, cluster/config/credential transfer, and adds power source', async () => {
    for (const args of [[], ['iris@10.0.0.66']]) {
      const host = args[0] ?? 'iris@iris.khzaw.dev';
      const settings = { IRIS_MAC_MINI_IP: '10.0.0.66', PRIMARY_NODE_IP: '10.0.0.197', BASE_DOMAIN: 'khzaw.dev', INGRESS_VIP: '10.0.0.231' };
      const encode = value => Buffer.from(value).toString('base64');
      const result = await runCLI('deploy.mjs', { args, env: { KUBECONFIG: '/fixture/kubeconfig' }, command: call => {
        if (call.file !== 'kubectl') return;
        const name = call.args[4];
        const data = name === 'cluster-settings' ? settings : name === 'alertmanager-receivers'
          ? { TELEGRAM_BOT_TOKEN: encode('test-telegram'), DISCORD_WEBHOOK_URL: encode('test-discord') }
          : { token: encode('test-api-token'), 'ca.crt': encode('test-ca') };
        return Buffer.from(JSON.stringify({ data }));
      } });
      assert.ifError(result.error);
      assert.deepEqual(result.calls[0], ssh(host, preflight));
      assert.deepEqual(result.calls.filter(call => call.file === 'kubectl'), [
        ['flux-system', 'configmap', 'cluster-settings'], ['monitoring', 'secret', 'alertmanager-receivers'],
        ['monitoring', 'secret', 'iris-watchdog-api-token'],
      ].map(([namespace, kind, name]) => ({ file: 'kubectl', args: ['-n', namespace, 'get', kind, name, '-o', 'json'],
        options: { env: { KUBECONFIG: '/fixture/kubeconfig' } } })));
      assert.deepEqual(result.calls.find(call => call.file === 'scp'), {
        file: 'scp', args: ['-q', `${source}/watchdog.mjs`, `${source}/install.mjs`, `${source}/smoke.mjs`, `${source}/power.mjs`,
          `${host}:.local/share/rangoonpulse/iris/`], options: { stdio: 'inherit' },
      });
      assert.ok(result.calls.some(call => call.args[3] === 'umask 077; mkdir -p ~/.local/share/rangoonpulse/iris ~/.config/rangoonpulse/iris'));
      const last = result.calls.at(-1);
      assert.deepEqual(last.args.slice(0, 3), ['-o', 'BatchMode=yes', host]);
      assert.ok(last.args[3].startsWith('/opt/homebrew/bin/node --input-type=module -e '));
      assert.ok(last.args[3].includes('await chmod(path,0o600)'));
      assert.ok(last.args[3].includes('/.local/share/rangoonpulse/iris/install.mjs'));
      const payload = JSON.parse(last.options.input);
      assert.deepEqual(payload, {
        config: { listenAddress: '10.0.0.66', clusterChecks: [
          { url: 'https://10.0.0.197:6443/readyz' }, { url: 'https://grafana.khzaw.dev/api/health', address: '10.0.0.231' },
        ] },
        notifications: { telegramBotToken: 'test-telegram', telegramChatId: 19198668, discordWebhookUrl: 'test-discord' },
        kubernetes: { token: 'test-api-token', ca: 'test-ca' },
      });
      assert.deepEqual(last.options.stdio, ['pipe', 'inherit', 'inherit']);
      for (const secret of ['test-telegram', 'test-discord', 'test-api-token', 'test-ca']) {
        assert.equal(JSON.stringify(result.calls.map(call => call.args)).includes(secret), false);
      }
      assert.equal(result.calls.length, 7);
    }
  });
}
