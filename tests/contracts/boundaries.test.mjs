import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { checkBoundaries, moduleSpecifiers, sourceFiles } from '../../scripts/check-boundaries.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixtures = [];
const failuresOf = (path, source) => checkBoundaries([{ path, source }]).join('\n');

test('the repository source satisfies its architecture boundaries', () => {
  const files = sourceFiles(root);
  assert.ok(files.some((file) => file.path === 'src/core/index.ts'));
  assert.deepEqual(checkBoundaries(files), []);
});

test('specifiers are read from static, multi-line, type, re-export, side-effect and dynamic imports', () => {
  const source = 'import {\n  a,\n} from "./a";\nimport type { B } from "../b";\nexport * from "./c";\nimport "./d.css";\nawait import("e");\nexport { f } from "f";';
  assert.deepEqual(moduleSpecifiers(source).sort(), ['../b', './a', './c', './d.css', 'e', 'f']);
});

test('src/core/ imports only modules inside src/core/', () => {
  assert.equal(failuresOf('src/core/scene/store.ts', 'import { x } from "./model";\nimport { y } from "../contracts/ids";'), '');
  assert.match(failuresOf('src/core/scene/store.ts', 'import { Sprite } from "pixi.js";'), /may import only modules inside src\/core\/; found "pixi\.js"/);
  assert.match(failuresOf('src/core/scene/store.ts', 'import { useState } from "react";'), /found "react"/);
  assert.match(failuresOf('src/core/scene/store.ts', 'import { draw } from "../../render/pixi/adapter";'), /found "\.\.\/\.\.\/render\/pixi\/adapter"/);
  assert.match(failuresOf('src/core/scene/store.ts', 'import { App } from "../../demo/ui/App";'), /found "\.\.\/\.\.\/demo\/ui\/App"/);
  assert.match(failuresOf('src/core/scene/store.ts', 'const pixi = await import("pixi.js");'), /found "pixi\.js"/);
  assert.match(failuresOf('src/core/scene/store.ts', 'import { readFile } from "node:fs";'), /found "node:fs"/);
  assert.match(failuresOf('src/core/view.tsx', 'export const View = () => null;'), /holds no JSX/);
});

test('src/assets/ imports only modules inside src/assets/ or src/core/', () => {
  assert.equal(failuresOf('src/assets/bundle.ts', 'import { parseJson } from "./json";\nimport type { ResourceId } from "../core/contracts/ids";'), '');
  assert.match(failuresOf('src/assets/bundle.ts', 'import { Assets } from "pixi.js";'), /src\/assets\/ may import only modules inside src\/assets\/ or src\/core\/; found "pixi\.js"/);
  assert.match(failuresOf('src/assets/bundle.ts', 'import { readFile } from "node:fs";'), /found "node:fs"/);
  assert.match(failuresOf('src/assets/bundle.ts', 'import { draw } from "../render/pixi/runtime";'), /found "\.\.\/render\/pixi\/runtime"/);
});

test('src/adapters/maplab/ imports only itself, src/assets/, src/core/ and the pinned MapLab schemas', () => {
  const allowed = [
    'import { readBundle } from "../../assets";',
    'import { canonicalJson } from "../../core";',
    'import { MapLabError } from "./errors";',
    'import map from "../../../fixtures/maplab/schemas/maplab.map.v1.schema.json";',
  ].join('\n');
  assert.equal(failuresOf('src/adapters/maplab/index.ts', allowed), '');
  const refused = /src\/adapters\/maplab\/ may import only modules inside src\/adapters\/maplab\/, src\/assets\/ or src\/core\/, or fixtures\/maplab\/schemas\/\*\.json; found/;
  assert.match(failuresOf('src/adapters/maplab/index.ts', 'import { readFile } from "node:fs";'), refused);
  assert.match(failuresOf('src/adapters/maplab/scene.ts', 'import { draw } from "../../render/pixi/runtime";'), /found "\.\.\/\.\.\/render\/pixi\/runtime"/);
  assert.match(failuresOf('src/adapters/maplab/scene.ts', 'import { readRig } from "../riglab";'), /found "\.\.\/riglab"/);
  assert.match(failuresOf('src/adapters/maplab/scene.ts', 'import { read } from "../../../../MapLab/src/export/bundle";'), refused);
  assert.match(failuresOf('src/adapters/maplab/schemas.ts', 'import forest from "../../../fixtures/maplab/forest-export/manifest.json";'), refused);
  assert.match(failuresOf('src/adapters/maplab/schemas.ts', 'import helper from "../../../fixtures/maplab/schemas/helper.ts";'), refused);
});

test('PixiJS stays in src/render/ and React in src/demo/', () => {
  assert.equal(failuresOf('src/render/pixi/adapter.ts', 'import { Application } from "pixi.js";'), '');
  assert.equal(failuresOf('src/demo/ui/App.tsx', 'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";'), '');
  assert.match(failuresOf('src/demo/ui/App.tsx', 'import { Application } from "pixi.js";'), /PixiJS may be imported only under src\/render\//);
  assert.match(failuresOf('src/assets/atlas.ts', 'import { Texture } from "@pixi/core";'), /PixiJS may be imported only under src\/render\//);
  assert.match(failuresOf('src/render/pixi/adapter.ts', 'import { useEffect } from "react";'), /React may be imported only under src\/demo\//);
  assert.match(failuresOf('src/adapters/maplab/read.ts', 'import { renderToString } from "react-dom/server";'), /React may be imported only under src\/demo\//);
});

test('no source reads the user agent', () => {
  assert.match(failuresOf('src/render/backends/probe.ts', 'const safari = navigator.userAgent.includes("Safari");'), /never read the user agent/);
  assert.match(failuresOf('src/demo/ui/App.tsx', 'const brands = navigator.userAgentData?.brands;'), /never read the user agent/);
  assert.equal(failuresOf('src/render/backends/probe.ts', 'const gpu = navigator.gpu;'), '');
});

test('the core TypeScript project refuses DOM and Node globals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'renderlab-core-'));
  fixtures.push(dir);
  writeFileSync(join(dir, 'probe.ts'), 'export const width: number = document.body.clientWidth;\nconsole.log(width);\n');
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: join(root, 'tsconfig.core.json'), include: [join(dir, 'probe.ts')] }));
  const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Cannot find name 'document'/);
  assert.match(result.stdout, /Cannot find name 'console'/);
});

after(() => { for (const dir of fixtures) rmSync(dir, { recursive: true, force: true }); });
