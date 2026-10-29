import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { parseSample, createLineDecoder, createPublisher, runCollector } from './power.mjs';

const scratch = process.env.IRIS_TEST_TMPDIR || join(homedir(), '.hermes/cache/scratch');
async function fixture(t) {
  const directory = await fs.mkdtemp(join(scratch, 'iris-power-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, outputPath: join(directory, 'iris-power.prom'), io: fs };
}

function memoryFilesystem() {
  const files = new Map();
  const missing = () => Object.assign(new Error('missing file'), { code: 'ENOENT' });
  return {
    async mkdir() {},
    async writeFile(path, contents, options = {}) {
      if (options.flag === 'wx' && files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      files.set(path, { contents, mode: files.get(path)?.mode ?? options.mode ?? 0o644 });
    },
    async readFile(path) {
      if (!files.has(path)) throw missing();
      return files.get(path).contents;
    },
    async stat(path) {
      if (!files.has(path)) throw missing();
      return { mode: files.get(path).mode };
    },
    async rename(from, to) {
      if (!files.has(from)) throw missing();
      files.set(to, files.get(from));
      files.delete(from);
    },
    async rm(path, options = {}) {
      if (!files.delete(path) && !options.force) throw missing();
    },
    async readdir(path) {
      return [...files.keys()].filter(file => dirname(file) === path).map(file => file.slice(path.length + 1));
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate, timeout = 3000) {
  const deadline = performance.now() + timeout;
  while (!(await predicate())) {
    if (performance.now() >= deadline) assert.fail('condition timed out');
    await delay(5);
  }
}

async function exists(io, path) {
  try { await io.stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function collector(t, script, overrides = {}) {
  const signals = new EventEmitter();
  let done;
  t.after(async () => { signals.emit('SIGTERM'); await done; });
  const setup = await fixture(t);
  const errors = [];
  let child;
  done = runCollector({
    ...setup, signals, sampleTimeoutMs: 1500, shutdownGraceMs: 100,
    logError: message => errors.push(message),
    spawnProcess(command, args, options) {
      assert.equal(command, '/opt/homebrew/bin/macmon');
      assert.deepEqual(args, ['pipe', '--interval', '10000']);
      assert.equal(options.shell, false);
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
      child = spawn(process.execPath, ['--input-type=module', '-e', script], options);
      return child;
    },
    ...overrides,
  });
  return { ...setup, ...overrides, signals, errors, done, get child() { return child; } };
}

test('only finite, strictly positive JSON numbers in sys_power are samples', () => {
  for (const watts of [0.001, 7, 19.25, 1e100]) {
    assert.equal(parseSample(JSON.stringify({ sys_power: watts })), watts);
  }
  for (const line of ['', 'broken', '{}', 'null', '[]', '42',
    '{"sys_power":null}', '{"sys_power":"12"}', '{"sys_power":true}',
    '{"sys_power":0}', '{"sys_power":-1}', '{"sys_power":NaN}',
    '{"sys_power":Infinity}', '{"sys_power":1e999}', '{"sys_power":{}}']) {
    assert.equal(parseSample(line), undefined, line);
  }
});

test('NDJSON decoder joins partial lines, handles CRLF, and discards oversized lines through newline', () => {
  const lines = [];
  const decoder = createLineDecoder(line => lines.push(line), { maxLineBytes: 32 });
  decoder.push(Buffer.from('{"sys_'));
  assert.deepEqual(lines, []);
  decoder.push(Buffer.from('power":12}\r\nbad\n{"sys_power":13}\n'));
  assert.deepEqual(lines, ['{"sys_power":12}\r', 'bad', '{"sys_power":13}']);
  decoder.push(Buffer.alloc(1024 * 1024, 120));
  for (let i = 0; i < 50; i++) decoder.push(Buffer.alloc(1024, 120));
  assert.ok(decoder.bufferedBytes <= 32);
  decoder.push(Buffer.from('{"sys_power":99}\n{"sys_power":14}\nunfinished'));
  assert.equal(lines.at(-1), '{"sys_power":14}');
  assert.equal(lines.length, 4);
});

test('NDJSON limit counts bytes across chunks, including multibyte text', () => {
  const lines = [];
  const decoder = createLineDecoder(line => lines.push(line), { maxLineBytes: 4 });
  const input = Buffer.from('éé\nééé\nx\n');
  for (const byte of input) decoder.push(Buffer.from([byte]));
  assert.deepEqual(lines, ['éé', 'x']);
});

test('publisher uses restrictive same-directory atomic rename, serializes writes, and drops busy samples', async t => {
  const { directory, outputPath, io: fs } = await fixture(t);
  const watchdog = join(directory, 'iris.prom');
  await fs.writeFile(watchdog, 'watchdog untouched');
  await fs.writeFile(outputPath, 'previous complete sample');
  const entered = deferred();
  const release = deferred();
  let renames = 0;
  const publisher = createPublisher(outputPath, { io: {
    ...fs,
    async rename(from, to) {
      assert.equal(dirname(from), directory);
      assert.equal(to, outputPath);
      assert.equal((await fs.stat(from)).mode & 0o777, 0o600);
      renames++;
      if (renames === 1) { entered.resolve(); await release.promise; }
      await fs.rename(from, to);
    },
  } });
  const first = publisher.publish(12.5, 123.25);
  await entered.promise;
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'previous complete sample');
  for (let i = 0; i < 1000; i++) assert.equal(publisher.publish(99, 999), undefined);
  release.resolve();
  await first;
  const body = await fs.readFile(outputPath, 'utf8');
  assert.match(body, /^iris_system_power_watts 12\.5$/m);
  assert.match(body, /^iris_power_sample_timestamp_seconds 123\.25$/m);
  assert.equal((await fs.stat(outputPath)).mode & 0o777, 0o600);
  assert.equal(renames, 1, 'busy samples must not build a write queue');
  await publisher.publish(13, 124);
  assert.match(await fs.readFile(outputPath, 'utf8'), /^iris_system_power_watts 13$/m);
  await publisher.close();
  assert.equal(publisher.publish(14, 125), undefined);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['iris-power.prom', 'iris.prom']);
  assert.equal(await fs.readFile(watchdog, 'utf8'), 'watchdog untouched');
});

test('closing during a write prevents publication; failed writes remove temporary artifacts', async t => {
  const { directory, outputPath, io: fs } = await fixture(t);
  const entered = deferred();
  const release = deferred();
  const publisher = createPublisher(outputPath, { io: {
    ...fs,
    async writeFile(...args) {
      await fs.writeFile(...args);
      entered.resolve();
      await release.promise;
    },
  } });
  const active = publisher.publish(10, 123);
  await entered.promise;
  const closing = publisher.close();
  release.resolve();
  await Promise.all([active, closing]);
  assert.deepEqual(await fs.readdir(directory), []);
  const failing = createPublisher(outputPath, { io: {
    ...fs, async rename() { throw new Error('disk failure'); },
  } });
  await assert.rejects(failing.publish(10, 124), /disk failure/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('startup removes stale output before spawning, without touching watchdog metrics', async t => {
  const setup = await fixture(t);
  const watchdog = join(setup.directory, 'iris.prom');
  await setup.io.writeFile(setup.outputPath, 'stale');
  await setup.io.writeFile(watchdog, 'watchdog');
  let spawned = false;
  let removed = false;
  const errors = [];
  const code = await runCollector({ ...setup, signals: new EventEmitter(),
    logError: message => errors.push(message),
    spawnProcess() {
      assert.equal(removed, true, 'stale output must be gone before spawn');
      spawned = true;
      throw new Error('unavailable');
    },
    io: { ...setup.io, async rm(path, options) {
      if (path === setup.outputPath && !spawned) assert.equal(await setup.io.readFile(path, 'utf8'), 'stale');
      await setup.io.rm(path, options);
      if (path === setup.outputPath) removed = true;
    } },
  });
  assert.equal(spawned, true);
  assert.equal(code, 1);
  assert.equal(await exists(setup.io, setup.outputPath), false);
  assert.equal(await setup.io.readFile(watchdog, 'utf8'), 'watchdog');
  assert.equal(errors.length, 1);
});

test('real child partial NDJSON uses receipt time; invalid input never advances the sample', async t => {
  let now = 123250;
  const c = await collector(t, `
    process.stdout.write('{"sys_');
    setTimeout(() => process.stdout.write('power":12.5,"timestamp":1}\\n'), 40);
    setTimeout(() => process.stdout.write('broken\\n{}\\n{"sys_power":null}\\n{"sys_power":"50"}\\n{"sys_power":NaN}\\n{"sys_power":1e999}\\n{"sys_power":0}\\n'), 100);
    setInterval(() => {}, 1000);
  `, { now: () => now });
  await until(() => exists(c.io, c.outputPath));
  const first = await c.io.readFile(c.outputPath, 'utf8');
  assert.match(first, /^iris_system_power_watts 12\.5$/m);
  assert.match(first, /^iris_power_sample_timestamp_seconds 123\.25$/m);
  now = 900000;
  await delay(180);
  assert.equal(await c.io.readFile(c.outputPath, 'utf8'), first);
  assert.deepEqual(c.errors, [], 'healthy collector and invalid records stay quiet');
  c.signals.emit('SIGTERM');
  assert.equal(await c.done, 0);
  assert.equal(await exists(c.io, c.outputPath), false);
  assert.notEqual(c.child.signalCode, null);
  assert.equal(c.signals.listenerCount('SIGTERM'), 0);
  assert.equal(c.signals.listenerCount('SIGINT'), 0);
});

test('child exit fails closed even after a valid sample', async t => {
  const c = await collector(t, `
    process.stdout.write('{"sys_power":9}\\n');
    setTimeout(() => process.exit(0), 150);
  `);
  await until(() => exists(c.io, c.outputPath));
  assert.equal(await c.done, 1);
  assert.equal(await exists(c.io, c.outputPath), false);
  assert.equal(c.errors.length, 1);
});

test('default no-valid-sample deadline is 50 seconds and is independent of wall time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const io = memoryFilesystem();
  const outputPath = join(scratch, 'deadline-test/iris-power.prom');
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close')); return true; };
  let spawned = false;
  let finished = false;
  const done = runCollector({ io, outputPath, signals: new EventEmitter(), now: () => 1e12,
    logError() {}, spawnProcess() { spawned = true; return child; },
  }).then(code => { finished = true; return code; });
  while (!spawned) await Promise.resolve();
  t.mock.timers.tick(44_999);
  await Promise.resolve();
  assert.equal(finished, false);
  child.stdout.write('{"sys_power":"100"}\n');
  t.mock.timers.tick(5001);
  assert.equal(await done, 1);
  assert.equal(await exists(io, outputPath), false);
});

for (const mode of ['silent', 'invalid flood', 'valid then invalid']) {
  test(`real child ${mode} times out, removes output, and is reaped`, async t => {
    const script = mode === 'silent' ? 'setInterval(() => {}, 1000);'
      : `${mode === 'valid then invalid' ? `process.stdout.write('{"sys_power":8}\\n');` : ''}
         setInterval(() => process.stdout.write('broken\\n{"sys_power":null}\\n'), 5);`;
    const c = await collector(t, script, { sampleTimeoutMs: 200 });
    if (mode === 'valid then invalid') await until(() => exists(c.io, c.outputPath));
    assert.equal(await c.done, 1);
    assert.equal(await exists(c.io, c.outputPath), false);
    assert.notEqual(c.child.signalCode, null);
    assert.equal(c.errors.length, 1);
    assert.ok(c.errors[0].length < 120);
  });
}

test('real oversized stream recovers at newline without publishing embedded samples', async t => {
  const c = await collector(t, `
    process.stdout.write('x'.repeat(1024 * 1024));
    process.stdout.write('{"sys_power":99}\\n{"sys_power":14}\\n');
    setInterval(() => {}, 1000);
  `);
  await until(() => exists(c.io, c.outputPath));
  assert.match(await c.io.readFile(c.outputPath, 'utf8'), /^iris_system_power_watts 14$/m);
  c.signals.emit('SIGINT');
  assert.equal(await c.done, 0);
  assert.equal(await exists(c.io, c.outputPath), false);
});

test('asynchronous spawn error fails closed and reports only a bounded fixed message', async t => {
  const c = await collector(t, '', {
    spawnProcess: () => spawn(join(scratch, 'missing-macmon'), [], { stdio: ['ignore', 'pipe', 'ignore'] }),
  });
  assert.equal(await c.done, 1);
  assert.equal(await exists(c.io, c.outputPath), false);
  assert.equal(c.errors.length, 1);
  assert.ok(c.errors[0].length < 120);
});

test('storage failure removes an already published sample and terminates the child', async t => {
  const setup = await fixture(t);
  let renames = 0;
  const c = await collector(t, `
    process.stdout.write('{"sys_power":7}\\n');
    setTimeout(() => process.stdout.write('{"sys_power":8}\\n'), 120);
    setInterval(() => {}, 1000);
  `, { ...setup, io: { ...setup.io, async rename(from, to) {
    if (++renames > 1) throw new Error('unbounded untrusted detail'.repeat(1000));
    await setup.io.rename(from, to);
  } } });
  await until(() => exists(c.io, c.outputPath));
  assert.equal(await c.done, 1);
  assert.equal(await exists(c.io, c.outputPath), false);
  assert.deepEqual(await c.io.readdir(c.directory), []);
  assert.equal(c.errors.length, 1);
  assert.ok(c.errors[0].length < 120);
});

test('timeout stops the child while a write is blocked and prevents a late publication', async t => {
  const setup = await fixture(t);
  const entered = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const c = await collector(t, `
    process.stdout.write('{"sys_power":7}\\n');
    setInterval(() => process.stdout.write('{"sys_power":8}\\n'), 5);
  `, { ...setup, sampleTimeoutMs: 150, io: { ...setup.io, async writeFile(...args) {
    await setup.io.writeFile(...args);
    entered.resolve();
    await release.promise;
  } } });
  await entered.promise;
  await until(() => c.child.signalCode !== null);
  assert.equal(await exists(c.io, c.outputPath), false);
  release.resolve();
  assert.equal(await c.done, 1);
  assert.equal(await exists(c.io, c.outputPath), false);
  assert.deepEqual(await c.io.readdir(c.directory), []);
});

test('fresh valid samples extend the deadline and persist their receipt time', async t => {
  let now = 100000;
  const c = await collector(t, `
    process.stdout.write('{"sys_power":7,"timestamp":1}\\n');
    setInterval(() => process.stdout.write('{"sys_power":8,"timestamp":2}\\n'), 50);
  `, { now: () => now, sampleTimeoutMs: 180 });
  await until(() => exists(c.io, c.outputPath));
  now = 200000;
  await delay(300);
  assert.match(await c.io.readFile(c.outputPath, 'utf8'), /^iris_power_sample_timestamp_seconds 200$/m);
  c.signals.emit('SIGTERM');
  assert.equal(await c.done, 0);
  assert.deepEqual(c.errors, []);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`real wrapper ${signal} waits for and escalates a stubborn child without leaks`, async t => {
    const setup = await fixture(t);
    const childScript = `
      process.on('SIGTERM', () => {});
      process.stdout.write('{"sys_power":10}\\n');
      setInterval(() => {}, 1000);
    `;
    const wrapperScript = `
      import { runCollector } from ${JSON.stringify(new URL('./power.mjs', import.meta.url).href)};
      import { spawn } from 'node:child_process';
      import * as fs from 'node:fs/promises';
      const io = fs;
      const outputPath = ${JSON.stringify(setup.outputPath)};
      const code = await runCollector({
        outputPath, io: { ...io, async rename(from, to) {
          await io.rename(from, to);
          process.send({ type: 'published' });
        } }, shutdownGraceMs: 100, sampleTimeoutMs: 2000,
        spawnProcess(command, args, options) {
          const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], options);
          process.send({ type: 'child', pid: child.pid });
          child.on('close', (code, signal) => process.send({ type: 'closed', code, signal }));
          return child;
        },
        logError: message => process.send({ type: 'error', message }),
      });
      process.send({ type: 'done', code, exists: await io.stat(outputPath).then(() => true, () => false) });
      process.exitCode = code;
      process.disconnect();
    `;
    const wrapper = spawn(process.execPath, ['--input-type=module', '-e', wrapperScript], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false,
    });
    const messages = [];
    const output = [];
    let childPid;
    wrapper.on('message', message => {
      messages.push(message);
      if (message.type === 'child') childPid = message.pid;
    });
    wrapper.stdout.on('data', chunk => output.push(chunk.toString()));
    wrapper.stderr.on('data', chunk => output.push(chunk.toString()));
    const completed = new Promise(resolve => wrapper.once('close', (code, signal) => resolve({ code, signal })));
    t.after(async () => {
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL');
      await completed;
      if (childPid) {
        try { process.kill(childPid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    });
    await until(() => messages.some(message => message.type === 'published'));
    const started = performance.now();
    wrapper.kill(signal);
    await delay(20);
    wrapper.kill(signal);
    const result = await completed;
    assert.deepEqual(result, { code: 0, signal: null });
    assert.ok(performance.now() - started >= 80, 'wrapper must wait for the escalation grace period');
    assert.deepEqual(messages.find(message => message.type === 'closed'), { type: 'closed', code: null, signal: 'SIGKILL' });
    assert.deepEqual(messages.find(message => message.type === 'done'), { type: 'done', code: 0, exists: false });
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' }, 'child was reaped before wrapper exit');
    assert.deepEqual(output, [], 'healthy wrapper stays quiet');
    assert.equal(messages.some(message => message.type === 'error'), false);
  });
}

// The collector itself must exit. Resolving a stalled promise in teardown would
// hide the launchd recovery failure, so these wrappers never release their IO.
async function wrapper(t, script) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], shell: false,
  });
  const messages = [];
  let stderr = '';
  let samplerPid;
  child.on('message', message => {
    messages.push(message);
    if (message.type === 'child') samplerPid = message.pid;
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await completed;
    if (samplerPid) {
      try { process.kill(samplerPid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  });
  return {
    child, messages,
    async finish(expectedCode = 1) {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 1500);
      try {
        assert.deepEqual(await completed, { code: expectedCode, signal: null },
          'collector must exit itself before the outer test kill');
      } finally { clearTimeout(timeout); }
      return stderr;
    },
  };
}

for (const stall of ['startup mkdir', 'startup unlink', 'shutdown write', 'shutdown unlink']) {
  test(`hard deadline exits with NEVER-settling ${stall}`, async t => {
    const script = `
      import { runCollector } from ${JSON.stringify(new URL('./power.mjs', import.meta.url).href)};
      import { spawn } from 'node:child_process';
      import { dirname } from 'node:path';
      const io = (${memoryFilesystem.toString()})();
      const never = () => { process.send({ type: 'stalled' }); return new Promise(() => {}); };
      const stall = ${JSON.stringify(stall)};
      let removals = 0;
      const originalRm = io.rm;
      if (stall === 'startup mkdir') io.mkdir = never;
      io.rm = async (...args) => {
        if (stall === 'startup unlink' || (stall === 'shutdown unlink' && ++removals > 1)) return never();
        return originalRm(...args);
      };
      if (stall === 'shutdown write') io.writeFile = never;
      // Keep the wrapper alive even when a stalled mock IO has no native handle.
      setInterval(() => {}, 1000);
      await runCollector({
        io, outputPath: '/virtual/iris-power.prom',
        startupTimeoutMs: 120, shutdownTimeoutMs: 120, sampleTimeoutMs: 80,
        // Hard exit must kill even a child whose normal grace is not over yet.
        shutdownGraceMs: 1000,
        spawnProcess(command, args, options) {
          const child = spawn(process.execPath, ['-e', ${JSON.stringify(`
            process.on('SIGTERM', () => {});
            process.stdout.write('{"sys_power":8}\\n');
            setInterval(() => {}, 1000);
          `)}], options);
          process.send({ type: 'child', pid: child.pid });
          return child;
        },
      });
    `;
    const w = await wrapper(t, script);
    const stderr = await w.finish();
    assert.ok(w.messages.some(message => message.type === 'stalled'), 'test reached the injected IO stall');
    assert.equal(stderr, `iris power: collector ${stall.startsWith('startup') ? 'startup' : 'shutdown'} deadline exceeded\n`);
    const pid = w.messages.find(message => message.type === 'child')?.pid;
    if (stall.startsWith('startup')) assert.equal(pid, undefined);
    else {
      assert.ok(pid, 'sampler started before shutdown');
      await until(() => {
        try { process.kill(pid, 0); return false; }
        catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      });
    }
  });
}

test('startup removes only collector-owned orphan temporary files', async t => {
  const setup = await fixture(t);
  const owned = [
    '.iris-power-123-00000000-0000-4000-8000-000000000000.tmp',
    '.iris-power-456-11111111-1111-4111-8111-111111111111.tmp',
  ];
  const retained = ['iris.prom', 'unrelated.tmp', '.iris-other-123.tmp', '.iris-power-not-owned.tmp'];
  for (const name of [...owned, ...retained]) await fs.writeFile(join(setup.directory, name), name);
  let filesAtSpawn;
  const code = await runCollector({ ...setup, signals: new EventEmitter(), logError() {},
    spawnProcess() {
      filesAtSpawn = readdirSync(setup.directory).sort();
      throw new Error('stop after startup cleanup');
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(filesAtSpawn, retained.sort());
  assert.deepEqual((await fs.readdir(setup.directory)).sort(), retained.sort());
  for (const name of retained) assert.equal(await fs.readFile(join(setup.directory, name), 'utf8'), name);
});

test('hard exit prevents delayed asynchronous rename from resurrecting fresh output', async t => {
  const setup = await fixture(t);
  const w = await wrapper(t, `
    import { runCollector } from ${JSON.stringify(new URL('./power.mjs', import.meta.url).href)};
    import * as fs from 'node:fs/promises';
    import { spawn } from 'node:child_process';
    import { setTimeout as delay } from 'node:timers/promises';
    await runCollector({
      outputPath: ${JSON.stringify(setup.outputPath)},
      startupTimeoutMs: 120, shutdownTimeoutMs: 120, shutdownGraceMs: 40,
      sampleTimeoutMs: 2000,
      io: { ...fs, async rename(...args) {
        process.send({ type: 'renaming' });
        await delay(600);
        await fs.rename(...args);
      } },
      spawnProcess(command, args, options) {
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(`
          process.stdout.write('{"sys_power":8}\\n');
          setInterval(() => {}, 1000);
        `)}], options);
        process.send({ type: 'child', pid: child.pid });
        return child;
      },
    });
  `);
  await until(() => w.messages.some(message => message.type === 'renaming'));
  w.child.kill('SIGTERM');
  assert.equal(await w.finish(), 'iris power: collector shutdown deadline exceeded\n');
  await delay(700);
  assert.equal(await exists(fs, setup.outputPath), false);
  // A temp file may survive a forced exit, but it cannot become scrapeable output.
  assert.ok((await fs.readdir(setup.directory)).every(name => name.startsWith('.iris-power-') && name.endsWith('.tmp')));
});

test('SIGTERM bounds shutdown even during NEVER-settling startup IO', async t => {
  const w = await wrapper(t, `
    import { runCollector } from ${JSON.stringify(new URL('./power.mjs', import.meta.url).href)};
    setInterval(() => {}, 1000);
    await runCollector({
      outputPath: '/virtual/iris-power.prom', startupTimeoutMs: 1000, shutdownTimeoutMs: 120,
      io: { mkdir() {
        process.kill(process.pid, 'SIGTERM');
        return new Promise(() => {});
      } },
      spawnProcess() { throw new Error('must never spawn'); },
    });
  `);
  assert.equal(await w.finish(), 'iris power: collector shutdown deadline exceeded\n');
});

test('healthy cleanup clears hard-exit timers and lets the wrapper exit naturally', async t => {
  const w = await wrapper(t, `
    import { runCollector } from ${JSON.stringify(new URL('./power.mjs', import.meta.url).href)};
    import { dirname } from 'node:path';
    import { spawn } from 'node:child_process';
    const io = (${memoryFilesystem.toString()})();
    const code = await runCollector({
      io: { ...io, async rename(...args) {
        await io.rename(...args);
        process.send({ type: 'published' });
      } },
      outputPath: '/virtual/iris-power.prom',
      spawnProcess(command, args, options) {
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(`
          process.stdout.write('{"sys_power":8}\\n');
          setInterval(() => {}, 1000);
        `)}], options);
        process.send({ type: 'child', pid: child.pid });
        return child;
      },
    });
    process.exitCode = code;
    process.disconnect();
  `);
  await until(() => w.messages.some(message => message.type === 'published'));
  w.child.kill('SIGTERM');
  assert.equal(await w.finish(0), '');
});
