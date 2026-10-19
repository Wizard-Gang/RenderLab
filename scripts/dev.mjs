// `npm start` runs `npm run dev`, which runs this launcher: teardown, reset, install, build, start, readiness, open.
// Each run replaces the RenderLab dev server on its port instead of failing on it. Ctrl-C stops the server it started.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  INSTALL_MARKER, STATE_FILE, foreignPortError, needsInstall, openBrowser, parsePort, portFree, processInfo,
  readRecord, removeRecordIfPid, repositoryCheckouts, resetPaths, sha256, stopProcess, teardown, waitForReady,
  writeRecord,
} from './dev-lifecycle.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stateFile = join(root, STATE_FILE);
const vite = join(root, 'node_modules/vite/bin/vite.js');
const step = (message) => console.log(`\n\x1b[35m▸ ${message}\x1b[0m`);

function run(file, args) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${[file, ...args].join(' ')} exited with status ${result.status}`);
}

let phase = 'configuration';
let child;
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (child?.pid) {
    try {
      await stopProcess(child.pid, { group: true });
    } catch (error) {
      console.error(`[dev] stop failed: ${error.message}`);
      code = 1;
    }
    removeRecordIfPid(stateFile, child.pid);
  }
  process.exit(code);
}

try {
  if (process.platform === 'win32') throw new Error('the managed launcher supports macOS and Linux only; run npx vite instead');
  const port = parsePort(process.env.RENDERLAB_PORT);
  const url = `http://localhost:${port}/`;
  const open = !process.argv.includes('--no-open') && process.env.RENDERLAB_NO_OPEN !== '1';

  phase = 'teardown';
  step(`Teardown: stopping RenderLab dev servers on port ${port}`);
  await teardown({
    root, port, checkouts: repositoryCheckouts(root), record: readRecord(stateFile), log: (line) => console.log(`  ${line}`),
  });
  if (!(await portFree(port))) throw foreignPortError(port, []);

  phase = 'reset';
  step('Reset: clearing dist/, node_modules/.vite/ and tmp/dev/');
  for (const path of resetPaths(root)) rmSync(path, { recursive: true, force: true });

  phase = 'install';
  const lockHash = sha256(readFileSync(join(root, 'package-lock.json')));
  const marker = join(root, INSTALL_MARKER);
  const installedHash = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null;
  if (needsInstall({ nodeModules: existsSync(join(root, 'node_modules')), lockHash, installedHash })) {
    step('Install: npm ci (node_modules/ is missing or older than package-lock.json)');
    run('npm', ['ci', '--no-audit', '--no-fund']);
    writeFileSync(marker, `${lockHash}\n`);
  } else {
    step('Install: node_modules/ matches package-lock.json');
  }

  phase = 'build';
  step('Build: vite build');
  run(process.execPath, [vite, 'build', '--logLevel', 'warn']);

  phase = 'start';
  step(`Start: Vite on port ${port}`);
  // Its own process group, so stopping it stops everything it started. Vite gets no stdin, so it never reads the
  // terminal from the background; this launcher handles Ctrl-C.
  child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true,
  });
  child.once('error', (error) => {
    console.error(`[dev] start failed: ${error.message}`);
    void stop(1);
  });
  child.once('exit', (code, signal) => {
    removeRecordIfPid(stateFile, child.pid);
    if (stopping) return;
    const replaced = signal === 'SIGTERM' || code === 143 ? '; a newer npm start on this port replaces the running server' : '';
    console.error(`[dev] Vite exited with ${signal ?? `status ${code}`}${replaced}`);
    process.exit(code ?? 1);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void stop(0));

  let identity = null;
  for (let attempt = 0; attempt < 20 && !identity && child.exitCode === null; attempt += 1) {
    identity = processInfo(child.pid);
    if (!identity) await sleep(50);
  }
  if (!identity) throw new Error(`could not read the identity of Vite PID ${child.pid}`);
  writeRecord(stateFile, { pid: child.pid, startedAt: identity.startedAt, root, port, url });

  phase = 'readiness';
  await waitForReady(url, { exited: () => child.exitCode !== null || child.signalCode !== null });
  step(`Ready: ${url}${open ? '' : '   (browser not opened: --no-open or RENDERLAB_NO_OPEN=1)'}`);
  if (open) openBrowser(url);
} catch (error) {
  console.error(`\n[dev] ${phase} failed: ${error.message}`);
  await stop(1);
}
