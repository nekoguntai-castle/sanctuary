#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRODUCTION_DIRS = ['server/src', 'gateway/src'];

const EXCLUDED_BASENAMES = new Set(['__tests__', 'tests']);
const EXCLUDED_SUFFIXES = ['.test.ts', '.spec.ts'];

const BLOCKING_PATTERN = /\b(readFileSync|writeFileSync|existsSync|readdirSync|statSync|lstatSync|execSync|spawnSync|appendFileSync|unlinkSync|mkdirSync|rmSync|copyFileSync|chmodSync|renameSync)\b/;

const ALLOWLIST = new Set([
  'server/src/config/packageInfo.ts',
  'server/src/services/migrationService.ts',
  'server/src/services/push/providers/fcm.ts',
  'server/src/services/push/providers/apns.ts',
  'gateway/src/index.ts',
  'gateway/src/config/env.ts',
]);

async function listTsSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_BASENAMES.has(entry.name)) continue;
      out.push(...(await listTsSources(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      out.push(full);
    }
  }
  return out;
}

async function findOffendingLines(file) {
  const text = await readFile(file, 'utf8');
  const hits = [];
  text.split('\n').forEach((line, idx) => {
    if (BLOCKING_PATTERN.test(line)) {
      hits.push(`${file}:${idx + 1}:${line.trimEnd()}`);
    }
  });
  return hits;
}

const offenders = new Map();

for (const dir of PRODUCTION_DIRS) {
  const files = await listTsSources(resolve(repoRoot, dir));
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (ALLOWLIST.has(rel)) continue;
    const hits = await findOffendingLines(file);
    if (hits.length > 0) offenders.set(rel, hits);
  }
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
