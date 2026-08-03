#!/usr/bin/env node
// Phase D: rewrite all shared/ imports to use the @sanctuary/shared workspace.
//
// Two replacement patterns (cover from/import/require/vi.mock/jest.mock
// uniformly because they all reference the path as a quoted string literal):
//   '(?:../)+shared/<rest>'   -> '@sanctuary/shared/<rest>'
//   '@sanctuary/shared/<rest>'          -> '@sanctuary/shared/<rest>'
//
// CLI: node scripts/codemod/rewrite-shared-imports.mjs [--dry-run] [paths...]
// Default paths: server/src, server/tests, gateway/src, gateway/tests, tests
// plus the frontend tree (src and e2e — anywhere @shared/* appears).
//
// One-shot script — delete after Phase D merges.

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pathArgs = args.filter((a) => !a.startsWith('--'));

const DEFAULT_TARGETS = [
  'server/src',
  'server/tests',
  'gateway/src',
  'gateway/tests',
  'tests',
  'src',
  'e2e',
  'scripts',
];

const TARGETS = (pathArgs.length > 0 ? pathArgs : DEFAULT_TARGETS).map((p) =>
  resolve(REPO_ROOT, p),
);

// Anchor on the QUOTE so we don't accidentally rewrite `// foo/shared/bar` etc.
// `(['"])` captures the quote so we restore it.
const RELATIVE = /(['"])((?:\.\.\/)+)shared\/([^'"\n]+?)\1/g;
const ALIAS = /(['"])@shared\/([^'"\n]+?)\1/g;

let totalFiles = 0;
let totalReplacements = 0;

function processFile(file) {
  const src = readFileSync(file, 'utf8');
  let changed = src;
  let count = 0;
  changed = changed.replace(RELATIVE, (_match, quote, _dots, rest) => {
    count += 1;
    return `${quote}@sanctuary/shared/${rest}${quote}`;
  });
  changed = changed.replace(ALIAS, (_match, quote, rest) => {
    count += 1;
    return `${quote}@sanctuary/shared/${rest}${quote}`;
  });
  if (count > 0) {
    totalFiles += 1;
    totalReplacements += count;
    if (!dryRun) {
      writeFileSync(file, changed);
    }
    console.log(`  ${dryRun ? '[would write]' : 'wrote'} ${file} (${count} replacements)`);
  }
}

function walk(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return; // path doesn't exist (some defaults won't apply to all repos)
  }
  if (st.isFile()) {
    if (
      target.endsWith('.ts') ||
      target.endsWith('.tsx') ||
      target.endsWith('.mts') ||
      target.endsWith('.cts') ||
      target.endsWith('.mjs')
    ) {
      processFile(target);
    }
    return;
  }
  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    walk(join(target, entry));
  }
}

console.log(`${dryRun ? 'DRY RUN' : 'REWRITE'} — scanning ${TARGETS.length} target(s)`);
for (const target of TARGETS) {
  walk(target);
}
console.log(`\nDone: ${totalReplacements} replacements across ${totalFiles} file(s).`);
