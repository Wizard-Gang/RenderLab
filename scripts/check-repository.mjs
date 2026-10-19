#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepositoryAt } from './repository-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
const tracked = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : [];
const failures = validateRepositoryAt(root, tracked);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Repository authorities, specification pin, workflows, permissions, no-deploy boundary and provider policy passed.');
}
