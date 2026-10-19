import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  REPOSITORY, SPECIFICATION, validatePackage, validateRepositoryAt, validateRepositoryContract, validateSpecification,
  validateTrackedFiles,
} from '../../scripts/repository-contract.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const current = () => ({
  ci: read('.github/workflows/ci.yml'),
  pkg: JSON.parse(read('package.json')),
  lock: JSON.parse(read('package-lock.json')),
  provider: JSON.parse(read('config/github-repository-settings.json')),
});
const failuresWith = (change) => {
  const state = current();
  change(state);
  return validateRepositoryContract(state).join('\n');
};

test('the committed repository satisfies its own contract', () => {
  assert.deepEqual(validateRepositoryAt(new URL('.', root).pathname, ['README.md', '.env.example']), []);
  assert.equal(JSON.parse(read('config/github-repository-settings.json')).repository, REPOSITORY);
});

test('the governing specification is pinned and changes only with its pin', () => {
  const bytes = readFileSync(new URL(SPECIFICATION.path, root));
  assert.deepEqual(validateSpecification(bytes), []);
  assert.match(validateSpecification(Buffer.concat([bytes, Buffer.from('\n')])).join('\n'),
    /changed \(sha256 [0-9a-f]{64}\); amend it only in a controlled change/);
});

test('npm start runs the dev server and check stays credential-free, offline and browser-free', () => {
  assert.match(failuresWith((state) => { state.pkg.scripts.start = 'vite'; }), /npm start must run the local dev server/);
  assert.match(failuresWith((state) => { state.pkg.scripts.check += ' && npm run audit:dependencies'; }), /credential-free, offline/);
  assert.match(failuresWith((state) => { state.pkg.scripts.check += ' && npm run verify:github-settings'; }), /credential-free, offline/);
  assert.match(failuresWith((state) => { state.pkg.scripts.check += ' && npm run test:browser'; }), /independent of downloaded browsers/);
  assert.match(failuresWith((state) => { delete state.pkg.scripts.dev; }), /missing package script dev/);
  assert.match(failuresWith((state) => { state.pkg.scripts.dev = 'vite'; }), /managed local development lifecycle/);
  assert.match(failuresWith((state) => { state.pkg.scripts['test:browser'] = 'vitest run'; }), /through playwright test/);
});

test('RenderLab never deploys', () => {
  assert.match(failuresWith((state) => { state.pkg.scripts.ship = 'wrangler deploy'; }), /must never deploy/);
  assert.match(failuresWith((state) => { state.pkg.devDependencies.wrangler = '4.147.0'; }), /must not depend on wrangler/);
  assert.match(failuresWith((state) => {
    state.ci = state.ci.replace('    name: security\n', '    name: security\n    environment: production\n');
  }), /workflows must never deploy/);
});

test('dependencies are exact pins and versions agree', () => {
  assert.match(validatePackage({ ...current().pkg, dependencies: { react: '^19.3.0' } }, current().lock).join('\n'),
    /dependencies react must pin an exact version/);
  assert.match(failuresWith((state) => { state.lock.version = '9.9.9'; }), /package-lock version must match/);
  assert.match(failuresWith((state) => { state.pkg.packageManager = 'npm@11.0.0'; }), /Node 26\/npm 12 baseline/);
});

test('PixiJS v8 is the one rendering library', () => {
  assert.equal(failuresWith((state) => { state.pkg.dependencies['pixi.js'] = '8.9.2'; }), '');
  assert.match(failuresWith((state) => { state.pkg.dependencies['pixi.js'] = '7.4.3'; }), /pixi\.js must pin an exact 8\.x release/);
  assert.match(failuresWith((state) => { state.pkg.dependencies.phaser = '3.90.0'; }), /must not include phaser/);
  assert.match(failuresWith((state) => { state.pkg.dependencies['@babylonjs/core'] = '8.0.0'; }), /must not include @babylonjs\/core/);
  assert.match(failuresWith((state) => { state.pkg.dependencies.three = '0.180.0'; }), /must not include three/);
});

test('CI keeps the three required jobs on the exact head with a read-only token', () => {
  assert.match(failuresWith((state) => { state.ci = state.ci.replace('  security:', '  audit:'); }), /verify, change-id, security/);
  assert.match(failuresWith((state) => { state.ci = state.ci.replace('contents: read', 'contents: write'); }), /read-only/);
  assert.match(failuresWith((state) => {
    state.ci = state.ci.replace('run: npm run check:change', 'run: echo skipped');
  }), /change-id must validate exact PR identity/);
  assert.match(failuresWith((state) => {
    state.ci = state.ci.replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v7');
  }), /pinned to a full commit SHA/);
});

test('the required verify job runs the browser tests on Chromium and WebKit', () => {
  assert.match(failuresWith((state) => { state.ci = state.ci.replace('run: npm run test:browser', 'run: echo skipped'); }),
    /verify must run the browser tests/);
  assert.match(failuresWith((state) => { state.ci = state.ci.replace('chromium webkit', 'chromium'); }),
    /install the Chromium and WebKit browsers/);
});

test('provider policy is squash-only, current-with-main and bypass-free', () => {
  assert.match(failuresWith((state) => { state.provider.mergeMethods.rebase = true; }), /squash-only baseline/);
  assert.match(failuresWith((state) => { state.provider.immutableReleases = false; }), /immutable Releases/);
  assert.match(failuresWith((state) => { state.provider.rulesets[0].bypassActors = [{ actor_id: 1 }]; }), /no bypass actors/);
  assert.match(failuresWith((state) => { state.provider.requiredStatusChecks = ['verify']; }), /match CI job names/);
  assert.match(failuresWith((state) => { state.provider.repository = 'Wizard-Gang/baseline'; }), /squash-only baseline/);
});

test('RenderLab stays React and TypeScript: no Rust, Cargo or Tauri files, dependencies or scripts', () => {
  assert.deepEqual(validateTrackedFiles(['src/demo/ui/App.tsx', 'scripts/dev.mjs', 'docs/rust-free.md']), []);
  assert.equal(validateTrackedFiles([
    'src-tauri/src/main.rs', 'Cargo.toml', 'src-tauri/Cargo.lock', 'rust-toolchain.toml', 'tauri.conf.json', 'tools/build.rs',
  ]).length, 6);
  assert.match(validateTrackedFiles(['Cargo.toml']).join('\n'), /React and TypeScript only; native toolchain file is tracked: Cargo\.toml/);
  assert.match(failuresWith((state) => { state.pkg.devDependencies['@tauri-apps/cli'] = '2.9.0'; }), /must not include @tauri-apps\/cli/);
  assert.match(failuresWith((state) => { state.pkg.scripts.desktop = 'tauri dev'; }), /package script desktop must not run a native toolchain/);
});

test('credential-bearing files are never tracked', () => {
  assert.deepEqual(validateTrackedFiles(['.env.example', 'src/demo/ui/App.tsx']), []);
  assert.equal(validateTrackedFiles(['.env', 'config/.env.local', 'keys/signing.pem', 'id_rsa']).length, 4);
});
