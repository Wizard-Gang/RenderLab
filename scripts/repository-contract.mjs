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

// RenderLab has delivery gates only: no release workflow, tag cutter or deployment.
export const WORKFLOWS = Object.freeze(['change.yml', 'gate.yml', 'verify.yml']);

export const REQUIRED_SCRIPTS = Object.freeze([
  'start', 'dev', 'build', 'preview', 'typecheck', 'test', 'test:browser', 'check', 'check:gate', 'check:boundaries', 'check:change', 'check:fixtures',
  'check:patch',
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
  if (!/\bnpm run check:boundaries\b/.test(pkg.scripts?.check ?? '')) failures.push('npm run check must enforce the architecture boundaries');
  if (!/\bnpm run check:fixtures\b/.test(pkg.scripts?.check ?? '')) failures.push('npm run check must verify the fixture provenance lock');
  if (!/\btsc -p tsconfig\.core\.json\b/.test(pkg.scripts?.typecheck ?? '')) {
    failures.push('npm run typecheck must compile src/core/ without the DOM through tsconfig.core.json');
  }
  if (OUTSIDE_CHECK.test(pkg.scripts?.check ?? '') || OUTSIDE_CHECK.test(pkg.scripts?.['check:gate'] ?? '')) {
    failures.push('npm run check must stay credential-free, offline and independent of downloaded browsers');
  }
  if (/vitest|--test|\bnpm (?:run )?test\b|npm run check(?:\s|$)/.test(pkg.scripts?.['check:gate'] ?? '')) {
    failures.push('npm run check:gate must run only the non-test checks');
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

// Each delivery workflow: its PR bases, whether it can be dispatched, and its job names. None runs on push.
const DELIVERY = Object.freeze({
  verify: { branches: /^    branches: \[main\]$/m, bases: 'main', dispatch: true, jobs: ['verify', 'security'] },
  gate: { branches: /^    branches: \['release\/\*\*'\]$/m, bases: 'release/**', dispatch: false, jobs: ['gate'] },
  change: { branches: /^    branches: \[main, 'release\/\*\*'\]$/m, bases: 'main and release/**', dispatch: false, jobs: ['change-id'] },
});

function validateDelivery(name, workflow, failures) {
  const { branches, bases, dispatch, jobs } = DELIVERY[name];
  const events = keys(block(workflow, 'on'), 2);
  if (!sameSet(events, dispatch ? ['pull_request', 'workflow_dispatch'] : ['pull_request'])) {
    failures.push(`${name}.yml must trigger only on ${dispatch ? 'PRs and workflow_dispatch' : 'PRs'}, never on push`);
  }
  const pullRequest = block(workflow, 'pull_request', 2);
  requireMatch(failures, `${name}.yml must run on PRs into ${bases}`, pullRequest, branches);
  requireMatch(failures, `${name}.yml must rerun when PR title or body is edited`, pullRequest, /types: \[[^\]]*edited[^\]]*\]/);
  if (block(workflow, 'permissions')?.trim() !== 'contents: read') failures.push(`${name}.yml default token must be read-only`);
  requireMatch(failures, `${name}.yml must cancel only in-progress PR runs`, block(workflow, 'concurrency'), /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  const actual = keys(block(workflow, 'jobs'), 2);
  if (!sameSet(actual, jobs)) failures.push(`${name}.yml must expose exactly the ${jobs.join(', ')} jobs`);
  for (const job of actual) {
    const contents = block(workflow, job, 2);
    if (/^    if:/m.test(contents ?? '')) failures.push(`${job} must always run; a skipped job cannot gate a merge`);
    requireMatch(failures, `${job} must check out the exact PR head`, contents,
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    if (block(contents, 'permissions', 4)) failures.push(`${job} must not broaden token permissions`);
  }
  return actual;
}

function validateDeliveryCommands({ verify, gate, change }, failures) {
  const verifyJob = block(verify, 'verify', 2);
  requireMatch(failures, 'verify must run the complete local contract', verifyJob, /run: npm run check$/m);
  requireMatch(failures, 'verify must install the Chromium and WebKit browsers after the offline gate', verifyJob,
    /run: npm run check\n[\s\S]*run: npx playwright install --with-deps chromium webkit/);
  requireMatch(failures, 'verify must run the browser tests on the installed browsers', verifyJob,
    /run: npx playwright install --with-deps chromium webkit[\s\S]*run: npm run test:browser/);
  requireMatch(failures, 'verify must check the committed PR patch', verifyJob, /run: npm run check:patch/);
  requireMatch(failures, 'security must run the dependency advisory gate', block(verify, 'security', 2), /run: npm run audit:dependencies/);
  const gateJob = block(gate, 'gate', 2);
  requireMatch(failures, 'gate must run the non-test checks', gateJob, /run: npm run check:gate$/m);
  requireMatch(failures, 'gate must check the committed PR patch', gateJob, /run: npm run check:patch/);
  if (/vitest|--test|\bnpm (?:run )?test\b|npm run check$|playwright/m.test(gateJob ?? '')) failures.push('gate must not run tests');
  const changeJob = block(change, 'change-id', 2);
  requireMatch(failures, 'change-id must validate exact PR identity', changeJob, /run: npm run check:change/);
  requireMatch(failures, 'change-id must fetch merged PR heads for the release ledger', changeJob, /git fetch [^\n]*refs\/pull\/\*\/head/);
}

const MAIN_RULES = Object.freeze(['deletion', 'non_fast_forward', 'pull_request', 'required_linear_history', 'required_status_checks']);
// No deletion rule: automatic branch deletion removes a release branch once its release PR merges.
const RELEASE_RULES = Object.freeze(['non_fast_forward', 'pull_request', 'required_status_checks']);

function validateBranchRuleset(ruleset, label, { rules, mergeMethod, checks, checkSource }, failures) {
  if (ruleset?.enforcement !== 'active' || ruleset?.requireBranchUpToDate !== true
      || ruleset?.bypassActors?.length !== 0 || !sameSet(ruleset?.rules ?? [], rules)) {
    failures.push(`${label} ruleset must enforce ${rules.join(', ')} on current branches with no bypass actors`);
  }
  if (!sameSet(ruleset?.allowedMergeMethods ?? [], [mergeMethod])) failures.push(`${label} must accept PRs by ${mergeMethod} merge only`);
  if (!sameSet(ruleset?.requiredStatusChecks ?? [], checks)) failures.push(`${label} required checks must match the ${checkSource} jobs`);
}

function validateProvider(provider, { mainChecks, releaseChecks }, failures) {
  if (provider?.repository !== REPOSITORY || provider?.defaultBranch !== 'main'
      || provider?.mergeMethods?.mergeCommit !== false || provider?.mergeMethods?.squash !== true
      || provider?.mergeMethods?.rebase !== true || provider?.deleteBranchOnMerge !== true
      || provider?.allowAutoMerge !== true || provider?.immutableReleases !== true) {
    failures.push('provider must allow only squash and rebase merges, delete merged branches and keep immutable Releases');
  }
  const branches = provider?.rulesets?.filter((rule) => rule.target === 'branch') ?? [];
  const main = branches.find((rule) => sameSet(rule.include ?? [], ['refs/heads/main']));
  const release = branches.find((rule) => sameSet(rule.include ?? [], ['refs/heads/release/*']));
  if (branches.length !== 2 || !main || !release) failures.push('provider must have exactly the main and release/* branch rulesets');
  validateBranchRuleset(main, 'main', {
    rules: MAIN_RULES, mergeMethod: 'rebase', checks: mainChecks, checkSource: 'verify.yml and change.yml',
  }, failures);
  validateBranchRuleset(release, 'release/*', {
    rules: RELEASE_RULES, mergeMethod: 'squash', checks: releaseChecks, checkSource: 'gate.yml and change.yml',
  }, failures);
  const tags = provider?.rulesets?.find((rule) => rule.target === 'tag');
  if (tags?.enforcement !== 'active' || tags?.bypassActors?.length !== 0
      || !sameSet(tags?.include ?? [], ['refs/tags/v*']) || !sameSet(tags?.rules ?? [], ['deletion', 'update'])) {
    failures.push('release tag ruleset must make v* tags immutable');
  }
}

export function validateRepositoryContract({ verify, gate, change, pkg, lock, provider }) {
  const failures = validatePackage(pkg, lock);
  const verifyJobs = validateDelivery('verify', verify, failures);
  const gateJobs = validateDelivery('gate', gate, failures);
  const changeJobs = validateDelivery('change', change, failures);
  validateDeliveryCommands({ verify, gate, change }, failures);
  const ci = [verify, gate, change].join('\n');
  if (/deploy-worker|wrangler|^\s*environment:/m.test(ci)) failures.push('workflows must never deploy');
  const uses = [...ci.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  if (!uses.length || uses.some((use) => !/^actions\/[a-z0-9-]+@[0-9a-f]{40}$/.test(use))) {
    failures.push('every action must be GitHub-owned and pinned to a full commit SHA');
  }
  for (const match of ci.matchAll(/\bnpm run ([\w:-]+)/g)) {
    if (!pkg.scripts?.[match[1]]) failures.push(`workflow references missing package script ${match[1]}`);
  }
  validateProvider(provider, {
    mainChecks: [...verifyJobs, ...changeJobs], releaseChecks: [...gateJobs, ...changeJobs],
  }, failures);
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
  'docs/ARCHITECTURE.md', 'docs/CHANGE-MANAGEMENT.md', 'docs/GPU-BACKENDS.md', 'docs/RELEASE-MANAGEMENT.md', 'docs/TESTING.md',
  SPECIFICATION.path, '.node-version', '.npmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.core.json',
  'scripts/check-boundaries.mjs', 'scripts/check-fixtures.mjs', 'fixtures/provenance.json', 'docs/ASSET-PIPELINE.md',
  'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', '.github/pull_request_template.md',
  'config/github-repository-settings.json', 'docs/releases.json', ...WORKFLOWS.map((file) => `.github/workflows/${file}`),
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
    verify: read('.github/workflows/verify.yml'),
    gate: read('.github/workflows/gate.yml'),
    change: read('.github/workflows/change.yml'),
    pkg: JSON.parse(read('package.json')),
    lock: JSON.parse(read('package-lock.json')),
    provider: JSON.parse(read('config/github-repository-settings.json')),
  })];
}
