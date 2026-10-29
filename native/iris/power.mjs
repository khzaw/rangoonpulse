// Native macmon power samples for node_exporter's independent textfile collector.
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function parseSample(line) {
  try {
    const watts = JSON.parse(line)?.sys_power;
    if (typeof watts === 'number' && Number.isFinite(watts) && watts > 0) return watts;
  } catch { /* Malformed input is never a successful sample. */ }
  return undefined;
}

export function createLineDecoder(onLine, { maxLineBytes = 64 * 1024 } = {}) {
  const buffer = Buffer.alloc(maxLineBytes);
  let length = 0;
  let oversized = false;
  return {
    get bufferedBytes() { return length; },
    push(chunk) {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start);
        const stop = end === -1 ? chunk.length : end;
        const size = stop - start;
        if (!oversized && length + size > maxLineBytes) {
          oversized = true;
          length = 0;
        }
        if (!oversized) {
          chunk.copy(buffer, length, start, stop);
          length += size;
        }
        if (end === -1) break;
        if (!oversized) onLine(buffer.toString('utf8', 0, length));
        length = 0;
        oversized = false;
        start = end + 1;
      }
    },
  };
}

export function createPublisher(outputPath, { io = fs } = {}) {
  let active;
  let closed = false;
  return {
    publish(watts, receiptSeconds) {
      // Consume the stream continuously; slow storage must never queue samples.
      if (closed || active) return undefined;
      const temporary = join(dirname(outputPath), `.iris-power-${process.pid}-${randomUUID()}.tmp`);
      active = (async () => {
        try {
          await io.writeFile(temporary,
            '# HELP iris_system_power_watts System power reported by macmon.\n' +
            '# TYPE iris_system_power_watts gauge\n' +
            `iris_system_power_watts ${watts}\n` +
            '# HELP iris_power_sample_timestamp_seconds Receipt time of the valid power sample.\n' +
            '# TYPE iris_power_sample_timestamp_seconds gauge\n' +
            `iris_power_sample_timestamp_seconds ${receiptSeconds}\n`,
            { mode: 0o600, flag: 'wx' });
          if (!closed) await io.rename(temporary, outputPath);
        } finally {
          await io.rm(temporary, { force: true });
        }
      })().finally(() => { active = undefined; });
      return active;
    },
    async close() {
      closed = true;
      await active;
    },
  };
}

export async function runCollector({
  outputPath = join(homedir(), '.local/state/rangoonpulse/iris/textfile/iris-power.prom'),
  spawnProcess = spawn, io = fs, now = Date.now, signals = process,
  sampleTimeoutMs = 50_000, shutdownGraceMs = 2000,
  startupTimeoutMs = 4000, shutdownTimeoutMs = 4000,
  logError = message => console.error(message),
} = {}) {
  const publisher = createPublisher(outputPath, { io });
  let child;
  let childClosed = false;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  let stopping = false;
  let failure;
  let deadline;
  let startupDeadline;
  let shutdownDeadline;
  const hardExit = reason => {
    // IO promises cannot be cancelled reliably. Exit the process so their late
    // continuations cannot publish, and let launchd restart a clean collector.
    try {
      if (child && !childClosed) child.kill('SIGKILL');
    } finally {
      try { logError(`iris power: ${reason}`); }
      finally { process.exit(1); }
    }
  };
  let resolveStop;
  const stopped = new Promise(resolve => { resolveStop = resolve; });
  const stop = reason => {
    if (stopping) return;
    stopping = true;
    failure = reason;
    clearTimeout(deadline);
    clearTimeout(startupDeadline);
    // Arm on the signal/failure itself, including while startup IO is stuck.
    // Four seconds leaves room inside launchd's default five-second exit grace.
    shutdownDeadline = setTimeout(() => hardExit('collector shutdown deadline exceeded'), shutdownTimeoutMs);
    resolveStop();
  };
  const terminate = () => stop();
  signals.on('SIGTERM', terminate);
  signals.on('SIGINT', terminate);
  const armDeadline = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => stop('no valid sample before deadline'), sampleTimeoutMs);
  };
  try {
    startupDeadline = setTimeout(() => hardExit('collector startup deadline exceeded'), startupTimeoutMs);
    await io.mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    // Never let a previous invocation's success survive a failed startup.
    await io.rm(outputPath, { force: true });
    // launchd owns the single instance. Only our PID/UUID temporary names are
    // recoverable orphans; watchdog output and other temporary files stay put.
    for (const name of await io.readdir(dirname(outputPath))) {
      if (/^\.iris-power-\d+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/.test(name)) {
        await io.rm(join(dirname(outputPath), name), { force: true });
      }
    }
    clearTimeout(startupDeadline);
    if (!stopping) {
      child = spawnProcess('/opt/homebrew/bin/macmon', ['pipe', '--interval', '10000'], {
        shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.once('error', () => stop('macmon process error'));
      child.once('exit', () => stop('macmon exited'));
      child.once('close', () => {
        childClosed = true;
        resolveClosed();
        stop('macmon closed');
      });
      const decoder = createLineDecoder(line => {
        if (stopping) return;
        const watts = parseSample(line);
        if (watts === undefined) return;
        const writing = publisher.publish(watts, now() / 1000);
        if (!writing) return;
        armDeadline();
        writing.catch(() => stop('power output write failed'));
      });
      child.stdout.on('data', chunk => decoder.push(chunk));
      child.stdout.once('error', () => stop('macmon stream error'));
      child.stdout.once('end', () => stop('macmon stream ended'));
      armDeadline();
    }
    await stopped;
  } catch {
    stop('collector startup failed');
  } finally {
    clearTimeout(deadline);
    // Close marks the writer stopped synchronously, before waiting for active IO.
    const writingStopped = publisher.close().catch(() => { failure ??= 'power output write failed'; });
    const removeOutput = async () => {
      try { await io.rm(outputPath, { force: true }); }
      catch { failure ??= 'power output removal failed'; }
    };
    const removed = removeOutput();
    if (child && !childClosed) {
      child.kill('SIGTERM');
      const escalation = setTimeout(() => {
        if (!childClosed) child.kill('SIGKILL');
      }, shutdownGraceMs);
      await closed;
      clearTimeout(escalation);
    }
    await Promise.all([writingStopped, removed]);
    // A rename already in progress at shutdown must not resurrect output.
    await removeOutput();
    clearTimeout(startupDeadline);
    clearTimeout(shutdownDeadline);
    signals.removeListener('SIGTERM', terminate);
    signals.removeListener('SIGINT', terminate);
  }
  // Fixed messages only: no untrusted macmon output or unbounded error detail.
  if (failure) logError(`iris power: ${failure}`);
  return failure ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCollector();
}
