// Execute the real CLI modules against scratch files and recorded command boundaries.
// The test entrypoint isolates the experimental VM APIs in a child process.
import * as fs from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as url from 'node:url';
import * as vm from 'node:vm';

export const scratch = `/Users/iris/.hermes/cache/scratch/iris-install-fixture-${randomUUID()}`;
export const macmon = '/opt/homebrew/bin/macmon';
export const preflight = 'test -f /opt/homebrew/bin/macmon && test -x /opt/homebrew/bin/macmon';
export const source = url.fileURLToPath(new URL('.', import.meta.url));

let fixtureCreated = false;
export async function prepareFixture() {
  try {
    await fs.mkdir(scratch, { mode: 0o700 });
    fixtureCreated = true;
  } catch (error) {
    if (process.env.CODEX_SANDBOX && ['EPERM', 'EACCES'].includes(error.code)) {
      return `Sandbox denies real filesystem fixtures at ${scratch}; rerun outside the sandbox.`;
    }
    throw error;
  }
  return false;
}

export async function cleanupFixture() {
  if (fixtureCreated) await fs.rm(scratch, { recursive: true, force: true });
}

export async function runCLI(name, { args = [], home = scratch, config, env = {}, command,
  missingMacmon = false, macmonIsFile = true } = {}) {
  assert.ok(home === scratch || home.startsWith(`${scratch}/`));
  await fs.rm(scratch, { recursive: true, force: true });
  const fixtures = `${scratch}/fixtures`;
  await fs.mkdir(fixtures, { recursive: true, mode: 0o700 });
  const executable = `${fixtures}/macmon`;
  if (!missingMacmon) {
    if (macmonIsFile) await fs.writeFile(executable, '#!/bin/sh\n', { mode: 0o700 });
    else await fs.mkdir(executable, { mode: 0o700 });
  }
  const example = `${fixtures}/config.example.json`;
  await fs.writeFile(example, JSON.stringify({ listenAddress: 'old', clusterChecks: [{}, {}] }), { mode: 0o600 });
  if (config !== undefined) {
    const directory = `${home}/.config/rangoonpulse/iris`;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(`${directory}/config.json`, JSON.stringify(config), { mode: 0o600 });
  }
  const events = [];
  const record = event => events.push(event);
  const commandCalls = [];
  const writes = new Map();
  const context = vm.createContext({
    URL, Buffer,
    console: { log: (...args) => record({ type: 'log', args }) },
    process: {
      argv: ['node', `${source}${name}`, ...args], env, getuid: () => 501,
      umask: value => record({ type: 'umask', value }),
    },
  });
  const mocks = {
    'node:fs': {
      constants,
      readFileSync: file => {
        record({ type: 'readFileSync', path: file });
        if (file !== `${source}/config.example.json`) throw new Error(`Unexpected read: ${file}`);
        return readFileSync(example, 'utf8');
      },
    },
    'node:fs/promises': {
      access: async (file, mode) => {
        record({ type: 'access', path: file, mode });
        if (file !== macmon || mode !== constants.X_OK) throw new Error('Unexpected executable check');
        await fs.access(executable, mode);
      },
      stat: async file => {
        record({ type: 'stat', path: file });
        if (file !== macmon) throw new Error(`Unexpected stat: ${file}`);
        return fs.stat(executable);
      },
      mkdir: async (file, options) => {
        record({ type: 'mkdir', path: file, options });
        await fs.mkdir(file, options);
        assert.equal((await fs.stat(file)).mode & 0o777, options.mode);
      },
      readFile: async file => {
        record({ type: 'readFile', path: file });
        if (config === undefined || file !== `${home}/.config/rangoonpulse/iris/config.json`) {
          throw new Error(`Forbidden configuration read: ${file}`);
        }
        return fs.readFile(file, 'utf8');
      },
      writeFile: async (file, value, options) => {
        record({ type: 'writeFile', path: file, options });
        await fs.writeFile(file, value, options);
        writes.set(file, await fs.readFile(file, 'utf8'));
      },
      chmod: async (file, mode) => {
        record({ type: 'chmod', path: file, mode });
        await fs.chmod(file, mode);
        assert.equal((await fs.stat(file)).mode & 0o777, mode);
      },
    },
    'node:child_process': {
      execFileSync: (file, args, options) => {
        // Normalize cross-realm arrays/objects before asserting exact arguments.
        const call = JSON.parse(JSON.stringify({ file, args, options }));
        record({ type: 'exec', ...call });
        commandCalls.push(call);
        return command?.(call, commandCalls) ?? Buffer.from('');
      },
    },
    'node:os': { homedir: () => home },
    'node:timers/promises': { setTimeout: async ms => record({ type: 'delay', ms }) },
    'node:path': path,
    'node:url': url,
  };
  const file = new URL(name, import.meta.url);
  const module = new vm.SourceTextModule(await fs.readFile(file, 'utf8'), {
    context, identifier: file.href, initializeImportMeta: meta => { meta.url = file.href; },
  });
  let error;
  try {
    await module.link(specifier => {
      const mock = mocks[specifier];
      if (!mock) throw new Error(`Unmocked dependency: ${specifier}`);
      return new vm.SyntheticModule(Object.keys(mock), function () {
        for (const [key, value] of Object.entries(mock)) this.setExport(key, value);
      }, { context });
    });
    await module.evaluate();
  } catch (caught) { error = caught; }
  return { error, events: JSON.parse(JSON.stringify(events)), calls: commandCalls, writes };
}
