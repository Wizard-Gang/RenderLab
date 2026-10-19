import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block, keys } from './workflow-yaml.mjs';

function requireMatch(failures, name, source, pattern) {
  if (!pattern.test(source ?? '')) failures.push(name);
}

function sameSet(actual, expected) {
  return actual.length === expected.length && expected.every((entry) => actual.includes(entry));
}

export const REPOSITORY = 'Wizard-Gang/RenderLab';

// The governing specification. Amending it is a controlled change that updates this pin in the same commit.
export const SPECIFICATION = Object.freeze({
  path: 'docs/specifications/2026-10-18-renderlab.md',
  sha256: 'c35482fa91b43d6149b39b71cadba12b648d5dbc768848917c2eae58d129ed7e',
});

// RenderLab has CI only. Releases need their own governed task, which adds its workflows and their contract here.
export const WORKFLOWS = Object.freeze(['ci.yml']);

export const REQUIRED_SCRIPTS = Object.freeze([
  'start', 'dev', 'build', 'preview', 'typecheck', 'test', 'test:browser', 'check', 'check:change', 'check:patch',
  'check:repository', 'check:workflow-shell', 'test:contracts', 'test:plan-queue', 'test:github-settings',
  'verify:github-settings', 'apply:github-settings', 'audit:dependencies',
]);

// Provider, network, browser-binary and mutation commands stay outside the credential-free offline gate.
const OUTSIDE_CHECK = /audit|verify:github-settings|apply:github-settings|GH_ADMIN_TOKEN|GH_TOKEN|test:browser|playwright/;

// A public repository never tracks credential-bearing files.
const CREDENTIAL_FILE = /(^|\/)(\.env(\..*)?|\.dev\.vars(\..*)?|id_rsa|id_ed25519)$|\.(pem|key|p12|pfx)$/;

// RenderLab is React and TypeScript only: no Rust, Cargo or Tauri sources, toolchains or shells.
const NATIVE_TOOLCHAIN_FILE = /(^|\/)(src-tauri\/.*|Cargo\.(toml|lock)|rust-toolchain(\.toml)?|tauri\.conf\.json5?)$|\.rs$/;
const NATIVE_TOOLCHAIN_PACKAGE = /^@tauri-apps\/|^tauri$/;

// PixiJS v8 is the one rendering library; a second game or rendering engine is out of scope.
const COMPETING_ENGINE_PACKAGE = /^(phaser|three|babylonjs|@babylonjs\/.+|playcanvas|excalibur|kaboom|kaplay|melonjs|littlejsengine)$/;
const PIXI_V8_PIN = /^8\.\d+\.\d+$/;

export function validateTrackedFiles(paths) {
  return [
    ...paths.filter((path) => CREDENTIAL_FILE.test(path) && !path.endsWith('.env.example'))
      .map((path) => `credential-bearing file is tracked: ${path}`),
    ...paths.filter((path) => NATIVE_TOOLCHAIN_FILE.test(path))
      .map((path) => `RenderLab is React and TypeScript only; native toolchain file is tracked: ${path}`),
  ];
}

export function validatePackage(pkg, lock) {
  const failures = [];
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) failures.push('package.json owns a semantic version');
  if (pkg.private !== true) failures.push('application package must be private to npm publication');
  if (pkg.packageManager !== 'npm@12.1.0' || pkg.engines?.node !== '26.x' || pkg.engines?.npm !== '12.x') {
    failures.push('packageManager and engines must match the shared Node 26/npm 12 baseline');
  }
  if (lock?.version !== pkg.version || lock?.packages?.['']?.version !== pkg.version) {
    failures.push('package-lock version must match package.json');
  }
  for (const name of REQUIRED_SCRIPTS) {
    if (!pkg.scripts?.[name]) failures.push(`missing package script ${name}`);
  }
  if (pkg.scripts?.start !== 'npm run dev') failures.push('npm start must run the local dev server through npm run dev');
  if (pkg.scripts?.dev !== 'node scripts/dev.mjs') {
    failures.push('npm run dev must run the managed local development lifecycle, node scripts/dev.mjs');
  }
  if (pkg.scripts?.['audit:dependencies'] !== 'npm audit --audit-level=high') {
    failures.push('dependency advisory gate must fail on high-severity advisories');
  }
  if (pkg.scripts?.['test:browser'] !== 'playwright test') failures.push('browser tests must run through playwright test');
  if (OUTSIDE_CHECK.test(pkg.scripts?.check ?? '')) {
    failures.push('npm run check must stay credential-free, offline and independent of downloaded browsers');
  }
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    if (/wrangler|deploy/.test(script)) failures.push(`package script ${name} must never deploy`);
    if (/\b(tauri|cargo|rustc|rustup)\b/.test(script)) failures.push(`RenderLab is React and TypeScript only; package script ${name} must not run a native toolchain`);
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (pkg[field]?.wrangler) failures.push('RenderLab must not depend on wrangler');
    for (const [name, version] of Object.entries(pkg[field] ?? {})) {
      if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`${field} ${name} must pin an exact version`);
      if (NATIVE_TOOLCHAIN_PACKAGE.test(name)) failures.push(`RenderLab is React and TypeScript only; ${field} must not include ${name}`);
      if (COMPETING_ENGINE_PACKAGE.test(name)) failures.push(`PixiJS v8 is the rendering library; ${field} must not include ${name}`);
      if (name === 'pixi.js' && !PIXI_V8_PIN.test(version)) failures.push(`pixi.js must pin an exact 8.x release; found ${version}`);
    }
  }
  return failures;
}

function validateCi(ci, failures) {
  const ciEvents = keys(block(ci, 'on'), 2);
  if (!sameSet(ciEvents, ['pull_request', 'push'])) failures.push('CI must trigger only on PR and main push');
  requireMatch(failures, 'CI must rerun when PR title or body is edited', block(ci, 'pull_request', 2), /types: \[[^\]]*edited[^\]]*\]/);
  requireMatch(failures, 'CI push target must be main', block(ci, 'push', 2), /^    branches: \[main\]$/m);
  if (block(ci, 'permissions')?.trim() !== 'contents: read') failures.push('CI default token must be read-only');
  requireMatch(failures, 'CI must cancel only in-progress PR runs', block(ci, 'concurrency'), /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  const ciJobs = keys(block(ci, 'jobs'), 2);
  if (!sameSet(ciJobs, ['verify', 'change-id', 'security'])) failures.push('CI must expose verify, change-id, security required jobs');
  for (const job of ciJobs) {
    const contents = block(ci, job, 2);
    requireMatch(failures, `${job} must check out the exact PR head`, contents,
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    if (block(contents, 'permissions', 4)) failures.push(`${job} must not broaden token permissions`);
  }
  const verify = block(ci, 'verify', 2);
  requireMatch(failures, 'verify must run the complete local contract', verify, /run: npm run check/);
  requireMatch(failures, 'verify must install the Chromium and WebKit browsers after the offline gate', verify,
    /run: npm run check[\s\S]*run: npx playwright install --with-deps chromium webkit/);
  requireMatch(failures, 'verify must run the browser tests on the installed browsers', verify,
    /run: npx playwright install --with-deps chromium webkit[\s\S]*run: npm run test:browser/);
  requireMatch(failures, 'verify must check the committed PR patch', verify, /run: npm run check:patch/);
  requireMatch(failures, 'change-id must validate exact PR identity', block(ci, 'change-id', 2), /run: npm run check:change/);
  requireMatch(failures, 'security must run the dependency advisory gate', block(ci, 'security', 2), /run: npm run audit:dependencies/);
  return ciJobs;
}

function validateProvider(provider, ciJobs, failures) {
  if (!sameSet(provider?.requiredStatusChecks ?? [], ciJobs)) failures.push('provider required checks must match CI job names');
  if (provider?.repository !== REPOSITORY || provider?.defaultBranch !== 'main'
      || provider?.mergeMethods?.mergeCommit !== false || provider?.mergeMethods?.squash !== true
      || provider?.mergeMethods?.rebase !== false || provider?.deleteBranchOnMerge !== true
      || provider?.allowAutoMerge !== true || provider?.immutableReleases !== true) {
    failures.push('provider must enforce the committed squash-only baseline with immutable Releases');
  }
  const main = provider?.rulesets?.find((rule) => rule.target === 'branch');
  const tags = provider?.rulesets?.find((rule) => rule.target === 'tag');
  if (main?.enforcement !== 'active' || main?.requireBranchUpToDate !== true
      || main?.bypassActors?.length !== 0 || !sameSet(main?.include ?? [], ['refs/heads/main'])
      || !sameSet(main?.rules ?? [], ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'])) {
    failures.push('main ruleset must protect current main with no bypass actors');
  }
  if (tags?.enforcement !== 'active' || tags?.bypassActors?.length !== 0
      || !sameSet(tags?.include ?? [], ['refs/tags/v*']) || !sameSet(tags?.rules ?? [], ['deletion', 'update'])) {
    failures.push('release tag ruleset must make v* tags immutable');
  }
}

export function validateRepositoryContract({ ci, pkg, lock, provider }) {
  const failures = validatePackage(pkg, lock);
  const ciJobs = validateCi(ci, failures);
  if (/deploy-worker|wrangler|^\s*environment:/m.test(ci)) failures.push('workflows must never deploy');
  const uses = [...ci.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  if (!uses.length || uses.some((use) => !/^actions\/[a-z0-9-]+@[0-9a-f]{40}$/.test(use))) {
    failures.push('every action must be GitHub-owned and pinned to a full commit SHA');
  }
  for (const match of ci.matchAll(/\bnpm run ([\w:-]+)/g)) {
    if (!pkg.scripts?.[match[1]]) failures.push(`workflow references missing package script ${match[1]}`);
  }
  validateProvider(provider, ciJobs, failures);
  return failures;
}

export function validateSpecification(bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return digest === SPECIFICATION.sha256 ? [] : [
    `${SPECIFICATION.path} changed (sha256 ${digest}); amend it only in a controlled change that updates SPECIFICATION`,
  ];
}

export const REQUIRED_AUTHORITIES = Object.freeze([
  'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE', 'SECURITY.md', 'implementation_plan.md',
  'docs/ARCHITECTURE.md', 'docs/CHANGE-MANAGEMENT.md', 'docs/RELEASE-MANAGEMENT.md', 'docs/TESTING.md',
  SPECIFICATION.path, '.node-version', '.npmrc', 'package.json', 'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', '.github/pull_request_template.md',
  'config/github-repository-settings.json', ...WORKFLOWS.map((file) => `.github/workflows/${file}`),
]);

export function validateRepositoryAt(root, trackedPaths = []) {
  const failures = [];
  for (const path of REQUIRED_AUTHORITIES) {
    if (!existsSync(join(root, path)) || !readFileSync(join(root, path), 'utf8').trim()) {
      failures.push(`missing or empty repository authority: ${path}`);
    }
  }
  if (failures.length) return failures;
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const workflows = readdirSync(join(root, '.github/workflows')).sort();
  if (workflows.join() !== WORKFLOWS.join()) failures.push(`workflows must be exactly ${WORKFLOWS.join(', ')}`);
  for (const config of ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml']) {
    if (existsSync(join(root, config))) failures.push(`RenderLab never deploys and must not carry ${config}`);
  }
  failures.push(...validateTrackedFiles(trackedPaths));
  failures.push(...validateSpecification(readFileSync(join(root, SPECIFICATION.path))));
  return [...failures, ...validateRepositoryContract({
    ci: read('.github/workflows/ci.yml'),
    pkg: JSON.parse(read('package.json')),
    lock: JSON.parse(read('package-lock.json')),
    provider: JSON.parse(read('config/github-repository-settings.json')),
  })];
}
