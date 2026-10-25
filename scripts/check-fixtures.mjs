#!/usr/bin/env node
// The fixture provenance lock: every file under fixtures/ is a byte-exact copy of a MapLab or RigLab file, and
// fixtures/provenance.json records its source repository, full commit, source path and SHA-256. This check is offline,
// so it proves the copies are unchanged since they were locked; whoever copies or refreshes a fixture re-reads the
// source at that commit and records it in the change.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK = 'fixtures/provenance.json';
export const SOURCES = Object.freeze(['Wizard-Gang/MapLab', 'Wizard-Gang/RigLab']);
const SEGMENT = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const safePath = (value) => typeof value === 'string' && value.split('/').every((segment) => SEGMENT.test(segment));
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();

/** `lock` is the parsed lock; `files` maps every repository-relative path under fixtures/ to its bytes. */
export function validateFixtureLock(lock, files) {
  const failures = [];
  if (!exactKeys(lock, ['format', 'version', 'fixtures']) || lock.format !== 'renderlab.fixture-provenance' || lock.version !== 1
    || !Array.isArray(lock.fixtures)) {
    return [`${LOCK} must be {format: "renderlab.fixture-provenance", version: 1, fixtures: [...]}`];
  }
  const locked = new Set();
  let previous = '';
  lock.fixtures.forEach((entry, index) => {
    const at = `${LOCK} fixtures[${index}]`;
    if (!exactKeys(entry, ['path', 'sha256', 'source']) || !exactKeys(entry.source, ['repository', 'commit', 'path'])) {
      failures.push(`${at} must have exactly path, sha256 and source {repository, commit, path}`);
      return;
    }
    const { path, sha256, source } = entry;
    if (!safePath(path) || !path.startsWith('fixtures/') || path === LOCK) failures.push(`${at}: path must be a safe file path under fixtures/`);
    if (path <= previous) failures.push(`${at}: fixtures must be sorted by path without duplicates`);
    previous = path;
    if (!SOURCES.includes(source.repository)) failures.push(`${at}: source repository must be one of ${SOURCES.join(', ')}`);
    if (!/^[0-9a-f]{40}$/.test(source.commit)) failures.push(`${at}: source commit must be a full 40-character SHA`);
    if (!safePath(source.path)) failures.push(`${at}: source path must be a safe relative path`);
    if (!/^[0-9a-f]{64}$/.test(sha256)) failures.push(`${at}: sha256 must be lowercase hex`);
    locked.add(path);
    const bytes = files.get(path);
    if (!bytes) failures.push(`${at}: ${path} is locked but missing`);
    else if (createHash('sha256').update(bytes).digest('hex') !== sha256) failures.push(`${path} changed since it was locked; re-copy it from source`);
  });
  for (const path of files.keys()) {
    if (path !== LOCK && !locked.has(path)) failures.push(`${path} is not in ${LOCK}; record its source repository, commit, path and SHA-256`);
  }
  return failures;
}

export function fixtureFiles(base = root) {
  const files = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(base, path).split(sep).join('/'), readFileSync(path));
    }
  };
  walk(join(base, 'fixtures'));
  return new Map([...files].sort(([left], [right]) => (left < right ? -1 : 1)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = fixtureFiles();
  const lock = JSON.parse(files.get(LOCK)?.toString('utf8') ?? 'null');
  const failures = validateFixtureLock(lock, files);
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Fixture provenance lock passed for ${files.size - 1} fixtures.`);
  }
}
