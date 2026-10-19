import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  DEFAULT_PORT, RESET_TARGETS, isRepositoryVite, needsInstall, parsePort, readRecord, removeRecordIfPid,
  repositoryCheckouts, resetPaths, stopProcess, teardown, writeRecord,
} from '../../scripts/dev-lifecycle.mjs';

const root = '/work/RenderLab';
const worktree = '/scratch/renderlab-wt';
const checkouts = [root, worktree];
const fixtures = [];
after(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test('the port is RENDERLAB_PORT when set, else 5184, and only a whole number from 1 to 65535', () => {
  assert.equal(parsePort(undefined), DEFAULT_PORT);
  assert.equal(parsePort(''), 5184);
  assert.equal(parsePort('5190'), 5190);
  for (const bad of ['0', '65536', '51.8', '-1', ' 5184', '5184x', 'abc']) {
    assert.throws(() => parsePort(bad), /RENDERLAB_PORT must be a whole number from 1 to 65535/, bad);
  }
});

test('ownership matches a Vite from this checkout or one of its worktrees, and nothing else', () => {
  assert.ok(isRepositoryVite(`node ${root}/node_modules/.bin/vite`, checkouts), 'bare `vite` from an old npm start');
  assert.ok(isRepositoryVite(`/usr/bin/node ${root}/node_modules/vite/bin/vite.js --port 5184 --strictPort`, checkouts));
  assert.ok(isRepositoryVite(`node ${worktree}/node_modules/.bin/vite --port 5191`, checkouts), 'a worktree server');
  assert.ok(!isRepositoryVite('node /work/Other/node_modules/.bin/vite', checkouts), 'Vite under another repository');
  assert.ok(!isRepositoryVite('node /work/RenderLab-old/node_modules/.bin/vite', checkouts), 'a sibling sharing the prefix');
  assert.ok(!isRepositoryVite(`node /mirror${root}/node_modules/.bin/vite`, checkouts), 'a longer path ending the same');
  assert.ok(!isRepositoryVite(`node ${root}/node_modules/.bin/vitest`, checkouts), 'Vitest is not the dev server');
  assert.ok(!isRepositoryVite(`node ${root}/scripts/dev.mjs`, checkouts), 'a non-Vite node process in the checkout');
  assert.ok(!isRepositoryVite(null, checkouts), 'an unreadable process');
  assert.ok(isRepositoryVite('node node_modules/.bin/vite --port 5184', checkouts, root), 'relative, run in the checkout');
  assert.ok(isRepositoryVite('node ../renderlab-wt/node_modules/vite/bin/vite.js', checkouts, '/scratch/x'), 'relative to a worktree');
  assert.ok(!isRepositoryVite('node node_modules/.bin/vite', checkouts, '/work/Other'), 'relative, run in another repository');
  assert.ok(!isRepositoryVite('node node_modules/.bin/vite', checkouts), 'relative with an unreadable working directory');
});

test('checkouts are this one plus every git worktree', () => {
  const porcelain = `worktree ${root}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD def\ndetached\n`;
  assert.deepEqual(repositoryCheckouts(root, () => porcelain), checkouts);
  assert.deepEqual(repositoryCheckouts(root, () => { throw new Error('git missing'); }), [root]);
});

test('reset removes only disposable paths inside the checkout', () => {
  assert.deepEqual(RESET_TARGETS, ['dist', 'node_modules/.vite', 'tmp/dev']);
  assert.deepEqual(resetPaths(root), [`${root}/dist`, `${root}/node_modules/.vite`, `${root}/tmp/dev`]);
  for (const escape of ['..', '../RenderLab-old', '/etc', '.', 'tmp/../..']) {
    assert.throws(() => resetPaths(root, [escape]), /outside the checkout/, escape);
  }
});

test('install runs only for a missing node_modules/ or a changed lockfile', () => {
  assert.equal(needsInstall({ nodeModules: false, lockHash: 'a', installedHash: 'a' }), true);
  assert.equal(needsInstall({ nodeModules: true, lockHash: 'a', installedHash: null }), true);
  assert.equal(needsInstall({ nodeModules: true, lockHash: 'b', installedHash: 'a' }), true);
  assert.equal(needsInstall({ nodeModules: true, lockHash: 'a', installedHash: 'a' }), false);
});

function machine(processes) {
  const signaled = [];
  return {
    signaled,
    inspect: (pid) => processes[pid] ?? null,
    listeners: () => Object.keys(processes).map(Number).filter((pid) => processes[pid].listening && !signaled.includes(pid)),
    stop: async (pid, options = {}) => { signaled.push(pid); processes[pid].group = options.group ?? false; },
  };
}

test('teardown stops the recorded server and any RenderLab Vite left on the port', async () => {
  const host = machine({
    101: { pid: 101, startedAt: 'Tue', command: `node ${root}/node_modules/vite/bin/vite.js --port 5184`, listening: true },
    202: { pid: 202, startedAt: 'Mon', command: `node ${worktree}/node_modules/.bin/vite`, listening: true },
  });
  await teardown({ root, port: 5184, checkouts, record: { pid: 101, startedAt: 'Tue', root }, ...host });
  assert.deepEqual(host.signaled, [101, 202]);
});

test('teardown never signals a reused PID or a record from another checkout', async () => {
  const reused = machine({ 101: { pid: 101, startedAt: 'Wed', command: `node ${root}/node_modules/vite/bin/vite.js` } });
  await teardown({ root, port: 5184, checkouts, record: { pid: 101, startedAt: 'Tue', root }, ...reused });
  assert.deepEqual(reused.signaled, []);
  const other = machine({ 101: { pid: 101, startedAt: 'Tue', command: `node ${root}/node_modules/vite/bin/vite.js` } });
  await teardown({ root, port: 5184, checkouts, record: { pid: 101, startedAt: 'Tue', root: worktree }, ...other });
  assert.deepEqual(other.signaled, []);
});

test('a foreign listener is refused with its PID and nothing on the port is signaled', async () => {
  const host = machine({
    202: { pid: 202, startedAt: 'Mon', command: `node ${root}/node_modules/.bin/vite`, listening: true },
    303: { pid: 303, startedAt: 'Mon', command: 'python3 -m http.server 5184', listening: true },
  });
  await assert.rejects(teardown({ root, port: 5184, checkouts, record: null, ...host }),
    /port 5184 is in use by PID 303 \(python3 -m http\.server 5184\), which is not a RenderLab dev server, so nothing was stopped[\s\S]*RENDERLAB_PORT/);
  assert.deepEqual(host.signaled, []);
  const unreadable = machine({ 404: { listening: true } });
  unreadable.inspect = () => null;
  await assert.rejects(teardown({ root, port: 5184, checkouts, record: null, ...unreadable }), /PID 404 \(command unreadable\)/);
});

test('stopping escalates from SIGTERM to SIGKILL and prefers the process group', async () => {
  const sent = [];
  let alive = 3;
  await stopProcess(77, { group: true, kill: (target, signal) => sent.push([target, signal]), isAlive: () => alive-- > 0, wait: async () => {} });
  assert.deepEqual(sent, [[-77, 'SIGTERM']]);

  const stubborn = [];
  await stopProcess(78, {
    kill: (target, signal) => stubborn.push(signal), isAlive: () => !stubborn.includes('SIGKILL'), wait: async () => {},
  });
  assert.deepEqual(stubborn, ['SIGTERM', 'SIGKILL']);

  const gone = [];
  const esrch = Object.assign(new Error('gone'), { code: 'ESRCH' });
  await stopProcess(79, { group: true, kill: (target) => { gone.push(target); throw esrch; }, isAlive: () => true, wait: async () => {} });
  assert.deepEqual(gone, [-79, 79], 'falls back to the PID, then treats a missing process as stopped');
});

test('the record is removed only while it names the exiting server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'renderlab-dev-'));
  fixtures.push(dir);
  const file = join(dir, 'tmp/dev/server.json');
  writeRecord(file, { pid: 500, startedAt: 'Tue', root, port: 5184 });
  assert.equal(readRecord(file).pid, 500);
  removeRecordIfPid(file, 499);
  assert.equal(readRecord(file).pid, 500, 'a replaced launcher leaves its successor\'s record');
  removeRecordIfPid(file, 500);
  assert.equal(readRecord(file), null);
});
