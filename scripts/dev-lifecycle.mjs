// The rules behind `npm start`'s local development lifecycle: teardown, reset, install, build, start, readiness.
// Node built-ins only, because the install step may replace node_modules/ while the launcher runs.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_PORT = 5184;
export const STATE_FILE = 'tmp/dev/server.json';
export const INSTALL_MARKER = 'node_modules/.renderlab-install';
export const RESET_TARGETS = Object.freeze(['dist', 'node_modules/.vite', 'tmp/dev']);
// How a RenderLab dev server shows in `ps`: run through npm's bin link (bare `vite`) or Vite's own entry (this launcher).
export const VITE_ENTRIES = Object.freeze(['node_modules/.bin/vite', 'node_modules/vite/bin/vite.js']);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`RENDERLAB_PORT must be a whole number from 1 to 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `command` runs Vite from one of `checkouts`. The entry must be a whole argument, not the tail of a longer
 * path. A relative argument (`node node_modules/.bin/vite`) counts only when resolved against the process's `cwd`.
 */
export function isRepositoryVite(command, checkouts, cwd = null) {
  if (typeof command !== 'string') return false;
  const entries = checkouts.flatMap((checkout) => VITE_ENTRIES.map((entry) => resolve(checkout, entry)));
  if (entries.some((entry) => new RegExp(`(?:^|\\s)${literal(entry)}(?:\\s|$)`).test(command))) return true;
  return typeof cwd === 'string' && command.split(/\s+/)
    .some((arg) => arg && !isAbsolute(arg) && entries.includes(resolve(cwd, arg)));
}

/** This checkout and every worktree of its repository, each as given and as its real path. */
export function repositoryCheckouts(root, run = output) {
  let listed = [];
  try {
    listed = (run('git', ['-C', root, 'worktree', 'list', '--porcelain']) ?? '').split('\n')
      .filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
  } catch {
    // Without git, only this checkout's own servers can be proven.
  }
  const paths = [root, ...listed].flatMap((path) => {
    try {
      return [path, realpathSync(path)];
    } catch {
      return [path];
    }
  });
  return [...new Set(paths.map((path) => resolve(path)))];
}

/** Every disposable path the reset step removes, refusing any that would leave the checkout. */
export function resetPaths(root, targets = RESET_TARGETS) {
  const base = resolve(root);
  return targets.map((target) => {
    const path = resolve(base, target);
    if (!path.startsWith(`${base}${sep}`)) throw new Error(`refusing to reset a path outside the checkout: ${path}`);
    return path;
  });
}

export const needsInstall = ({ nodeModules, lockHash, installedHash }) => !nodeModules || installedHash !== lockHash;

export function foreignPortError(port, processes) {
  const who = processes.length
    ? processes.map(({ pid, command }) => `PID ${pid} (${command ?? 'command unreadable'})`).join(', ')
    : 'a process this user cannot inspect';
  return new Error(`port ${port} is in use by ${who}, which is not a RenderLab dev server, so nothing was stopped. `
    + `Inspect it with lsof -nP -iTCP:${port} -sTCP:LISTEN and stop it yourself, or start RenderLab on another port with `
    + 'RENDERLAB_PORT=<port> npm start.');
}

export function output(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout.trim() : null;
}

export function processInfo(pid, run = output) {
  const startedAt = run('ps', ['-o', 'lstart=', '-p', String(pid)]);
  const command = run('ps', ['-o', 'command=', '-p', String(pid)]);
  if (!startedAt || !command) return null;
  const cwd = (run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']) ?? '').split('\n')
    .find((line) => line.startsWith('n'))?.slice(1) || null;
  return { pid, startedAt, command, cwd };
}

export function portListeners(port, run = output) {
  const pids = (run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']) ?? '').split(/\s+/).filter(Boolean);
  return [...new Set(pids.map(Number))];
}

/** Whether Vite could bind the port: the same `localhost` it binds, so it also covers listeners `lsof` cannot see. */
export function portFree(port) {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', (error) => (error.code === 'EADDRINUSE' || error.code === 'EACCES' ? done(false) : fail(error)));
    server.listen({ port, host: 'localhost', exclusive: true }, () => server.close(() => done(true)));
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** SIGTERM, then SIGKILL after a bounded wait. `group` signals the process group the launcher started Vite in. */
export async function stopProcess(pid, { group = false, kill = process.kill, isAlive = alive, wait = sleep } = {}) {
  const send = (signal) => {
    for (const target of group ? [-pid, pid] : [pid]) {
      try {
        kill(target, signal);
        return true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    return false;
  };
  for (const [signal, polls] of [['SIGTERM', 50], ['SIGKILL', 20]]) {
    if (!send(signal)) return;
    for (let poll = 0; poll < polls; poll += 1) {
      if (!isAlive(pid)) return;
      await wait(100);
    }
  }
  throw new Error(`process ${pid} did not exit after SIGKILL`);
}

/**
 * Stop this checkout's recorded server, then every RenderLab Vite still listening on the port. If any listener is not
 * RenderLab's, stop nothing and refuse.
 */
export async function teardown({
  root, port, checkouts, record,
  inspect = processInfo, listeners = portListeners, stop = stopProcess, log = () => {},
}) {
  if (record?.root === root) {
    const info = inspect(record.pid);
    if (info && info.startedAt === record.startedAt && isRepositoryVite(info.command, [root], info.cwd)) {
      log(`stopping this checkout's last dev server, PID ${record.pid}`);
      await stop(record.pid, { group: true });
    }
  }
  const found = listeners(port).map((pid) => inspect(pid) ?? { pid, command: null });
  const foreign = found.filter((info) => !isRepositoryVite(info.command, checkouts, info.cwd));
  if (foreign.length) throw foreignPortError(port, foreign);
  for (const info of found) {
    log(`stopping RenderLab Vite PID ${info.pid} left on port ${port}: ${info.command}`);
    await stop(info.pid);
  }
  if (listeners(port).length) throw new Error(`port ${port} is still in use after teardown`);
}

export function readRecord(file) {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    return Number.isSafeInteger(record?.pid) && record.pid > 1 && typeof record.startedAt === 'string'
      && typeof record.root === 'string' ? record : null;
  } catch {
    return null;
  }
}

export function writeRecord(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** Remove the record only while it still names `pid`, so a replaced launcher never deletes its successor's record. */
export function removeRecordIfPid(file, pid) {
  if (readRecord(file)?.pid === pid) rmSync(file, { force: true });
}

export async function waitForReady(url, { exited, timeoutMs = 20_000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    if (exited()) throw new Error('Vite exited before it was ready');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.name === 'TimeoutError' ? 'request timed out' : error.message;
    }
    await sleep(150);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${url} (${last})`);
}

export function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
  child.once('error', () => console.warn(`Could not open a browser; continue at ${url}`));
  child.unref();
}
