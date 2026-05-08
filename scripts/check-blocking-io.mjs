#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRODUCTION_DIRS = ['server/src', 'gateway/src'];

const EXCLUDE_GLOBS = [
  '**/*.test.ts',
  '**/*.spec.ts',
  '**/tests/**',
  '**/__tests__/**',
  '**/scripts/**',
];

const BLOCKING_PATTERN = '\\b(readFileSync|writeFileSync|existsSync|readdirSync|statSync|lstatSync|execSync|spawnSync|appendFileSync|unlinkSync|mkdirSync|rmSync|copyFileSync|chmodSync|renameSync)\\b';

const ALLOWLIST = new Set([
  'server/src/api/admin/version.ts',
  'server/src/services/migrationService.ts',
  'server/src/services/push/providers/fcm.ts',
  'server/src/services/push/providers/apns.ts',
  'gateway/src/index.ts',
]);

const runRipgrep = () => {
  const args = [
    '--no-heading',
    '--with-filename',
    '--line-number',
    '--type', 'ts',
    '-e', BLOCKING_PATTERN,
  ];
  for (const ex of EXCLUDE_GLOBS) {
    args.push('--glob', `!${ex}`);
  }
  args.push(...PRODUCTION_DIRS);
  try {
    const out = execFileSync('rg', args, { cwd: repoRoot, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
};

const lines = runRipgrep();
const offenders = new Map();
for (const line of lines) {
  const [filePath] = line.split(':', 1);
  const rel = relative(repoRoot, resolve(repoRoot, filePath));
  if (ALLOWLIST.has(rel)) continue;
  if (!offenders.has(rel)) offenders.set(rel, []);
  offenders.get(rel).push(line);
}

if (offenders.size === 0) {
  console.log(`check-blocking-io: passed (${ALLOWLIST.size} allow-listed production files)`);
  process.exit(0);
}

console.error('check-blocking-io: FAIL');
console.error('');
console.error('New synchronous file/process I/O found in production source paths.');
console.error('Synchronous I/O in request handlers blocks the event loop. Use async');
console.error('fs/promises or child_process exec instead — or add the file to the');
console.error('allow-list in scripts/check-blocking-io.mjs if it runs only at startup.');
console.error('');
for (const [file, hits] of offenders) {
  console.error(`  ${file}`);
  for (const hit of hits.slice(0, 5)) console.error(`    ${hit}`);
  if (hits.length > 5) console.error(`    ... +${hits.length - 5} more`);
}
process.exit(1);
