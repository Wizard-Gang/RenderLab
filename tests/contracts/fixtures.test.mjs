import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureFiles, LOCK, validateFixtureLock } from '../../scripts/check-fixtures.mjs';

const current = () => {
  const files = fixtureFiles();
  return { files, lock: JSON.parse(files.get(LOCK).toString('utf8')) };
};
const failuresWith = (change) => {
  const state = current();
  change(state);
  return validateFixtureLock(state.lock, state.files).join('\n');
};
const FOREST = 'fixtures/maplab/forest-export/maps/forest.map.json';

test('every committed fixture is locked to its MapLab or RigLab source and unchanged', () => {
  const { files, lock } = current();
  assert.deepEqual(validateFixtureLock(lock, files), []);
  assert.ok(lock.fixtures.length > 0);
  for (const entry of lock.fixtures) assert.match(entry.source.repository, /^Wizard-Gang\/(MapLab|RigLab)$/);
});

test('a changed, unlisted or missing fixture fails the lock', () => {
  assert.match(failuresWith(({ files }) => { files.set(FOREST, Buffer.concat([files.get(FOREST), Buffer.from(' ')])); }),
    /forest\.map\.json changed since it was locked/);
  assert.match(failuresWith(({ files }) => { files.set('fixtures/maplab/extra.json', Buffer.from('{}')); }),
    /fixtures\/maplab\/extra\.json is not in fixtures\/provenance\.json/);
  assert.match(failuresWith(({ files }) => { files.delete(FOREST); }), /forest\.map\.json is locked but missing/);
});

test('each lock entry names a known repository, a full commit, safe paths and a digest, in path order', () => {
  assert.match(failuresWith(({ lock }) => { lock.fixtures[0].source.repository = 'someone/MapLab'; }), /source repository must be one of/);
  assert.match(failuresWith(({ lock }) => { lock.fixtures[0].source.commit = '30ad4ac'; }), /full 40-character SHA/);
  assert.match(failuresWith(({ lock }) => { lock.fixtures[0].source.path = '../secrets.json'; }), /source path must be a safe relative path/);
  assert.match(failuresWith(({ lock }) => { lock.fixtures[0].sha256 = 'ABC'; }), /sha256 must be lowercase hex/);
  assert.match(failuresWith(({ lock }) => { lock.fixtures.reverse(); }), /sorted by path without duplicates/);
  assert.match(failuresWith(({ lock }) => { lock.fixtures.push(lock.fixtures.at(-1)); }), /sorted by path without duplicates/);
  assert.match(failuresWith(({ lock }) => { delete lock.fixtures[0].source; }), /exactly path, sha256 and source/);
  assert.match(failuresWith(({ lock }) => { lock.version = 2; }), /renderlab\.fixture-provenance/);
});
