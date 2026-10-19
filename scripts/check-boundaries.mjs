#!/usr/bin/env node
// Enforces the specification's §5 dependency rules on every module under src/ (tracked or not):
// - src/core/ is self-contained: only relative imports that stay inside src/core/, and no JSX;
// - PixiJS is imported only under src/render/, so GPU-specific code stays inside renderer implementations;
// - React is imported only under src/demo/, so React stays application UI.
// tsconfig.core.json separately compiles src/core/ without the DOM library or Node types.
// Specifiers are read with regular expressions over RenderLab's own source; this is not a general JavaScript parser.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SPECIFIERS = [
  /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const PIXI = /^(?:pixi\.js|@pixi\/.+)(?:\/.*)?$/;
const REACT = /^(?:react|react-dom)(?:\/.*)?$/;

export function moduleSpecifiers(source) {
  const found = new Set();
  for (const pattern of SPECIFIERS) for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

/** `files` are `{ path, source }` with repository-relative POSIX paths. Returns every boundary failure. */
export function checkBoundaries(files) {
  const failures = [];
  for (const { path, source } of files) {
    const inCore = path.startsWith('src/core/');
    if (inCore && /\.(?:tsx|jsx)$/.test(path)) failures.push(`${path}: src/core/ holds no JSX; React belongs to src/demo/`);
    for (const specifier of moduleSpecifiers(source)) {
      if (inCore) {
        const relativeImport = specifier.startsWith('./') || specifier.startsWith('../');
        const target = relativeImport ? posix.normalize(posix.join(posix.dirname(path), specifier)) : null;
        if (!target?.startsWith('src/core/')) {
          failures.push(`${path}: src/core/ may import only modules inside src/core/; found ${JSON.stringify(specifier)}`);
          continue;
        }
      }
      if (PIXI.test(specifier) && !path.startsWith('src/render/')) {
        failures.push(`${path}: PixiJS may be imported only under src/render/; found ${JSON.stringify(specifier)}`);
      }
      if (REACT.test(specifier) && !path.startsWith('src/demo/')) {
        failures.push(`${path}: React may be imported only under src/demo/; found ${JSON.stringify(specifier)}`);
      }
    }
  }
  return failures;
}

export function sourceFiles(base = root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SOURCE.test(entry.name)) files.push({ path: relative(base, path).split(sep).join('/'), source: readFileSync(path, 'utf8') });
    }
  };
  walk(join(base, 'src'));
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = sourceFiles();
  const failures = checkBoundaries(files);
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Architecture boundaries passed in ${files.length} source files.`);
  }
}
