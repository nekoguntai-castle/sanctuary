#!/usr/bin/env node
// Verify every external import in shared/**/*.ts is declared in shared/package.json.
// Catches the case where a future PR adds a new external import to shared and
// forgets to update its dependency contract — would silently break consumers
// that strip dev deps.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharedDir = join(repoRoot, 'shared');
const pkgPath = join(sharedDir, 'package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);
const declaredDev = new Set(Object.keys(pkg.devDependencies ?? {}));

const importRe = /^\s*import\s+(?:type\s+)?(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/gm;
const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const collected = new Map(); // specifier -> Set<file>

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      const src = readFileSync(full, 'utf8');
      for (const re of [importRe, requireRe, dynamicRe]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
          const spec = m[1];
          if (!collected.has(spec)) collected.set(spec, new Set());
          collected.get(spec).add(full);
        }
      }
    }
  }
}

walk(sharedDir);

function packageNameOf(spec) {
  if (spec.startsWith('@')) {
    const [scope, name] = spec.split('/');
    return name ? `${scope}/${name}` : scope;
  }
  return spec.split('/')[0];
}

const violations = [];
for (const [spec, files] of collected) {
  if (spec.startsWith('.') || spec.startsWith('/')) continue; // relative
  if (isBuiltin(spec) || isBuiltin(spec.replace(/^node:/, ''))) continue;
  const pkgName = packageNameOf(spec);
  if (declared.has(pkgName)) continue;
  if (pkgName.startsWith('@types/') && declaredDev.has(pkgName)) continue;
  violations.push({ spec, pkgName, files: [...files] });
}

if (violations.length > 0) {
  console.error('shared/ imports packages not declared in shared/package.json dependencies:');
  for (const v of violations) {
    console.error(`  - "${v.spec}" (package "${v.pkgName}") imported by:`);
    for (const f of v.files) console.error(`      ${f}`);
  }
  console.error('\nFix: add the package to shared/package.json `dependencies` (or `devDependencies` for type-only).');
  process.exit(1);
}

console.log(`check-shared-deps: OK (${collected.size} unique specifiers checked)`);
