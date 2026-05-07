#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Each entry's "candidate" is the SOLE accepted full-coverage path for that
// package. We deliberately don't fall back to coverage-shards/ — that
// directory holds the per-shard output of frontend-coverage-shard.sh and
// represents partial coverage. Only frontend-coverage-merge.sh emits the
// reconstituted full report, and it writes to coverage/coverage-summary.json.
const packages = [
  { name: 'frontend', candidate: 'coverage/coverage-summary.json' },
  { name: 'server', candidate: 'server/coverage/coverage-summary.json' },
  { name: 'gateway', candidate: 'gateway/coverage/coverage-summary.json' },
];

const readTotals = (file) => {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const t = json.total;
  if (!t) throw new Error(`No "total" key in ${file}`);
  return {
    lines: t.lines.pct,
    statements: t.statements.pct,
    functions: t.functions.pct,
    branches: t.branches.pct,
    linesTotal: t.lines.total,
    linesCovered: t.lines.covered,
    statementsTotal: t.statements.total,
    statementsCovered: t.statements.covered,
    functionsTotal: t.functions.total,
    functionsCovered: t.functions.covered,
    branchesTotal: t.branches.total,
    branchesCovered: t.branches.covered,
  };
};

const rows = [];
const missing = [];
for (const pkg of packages) {
  const file = resolve(repoRoot, pkg.candidate);
  if (!existsSync(file)) {
    missing.push(pkg.name);
    continue;
  }
  rows.push({ pkg: pkg.name, file, totals: readTotals(file) });
}

const aggregate = (key) => {
  const total = rows.reduce((sum, r) => sum + r.totals[`${key}Total`], 0);
  const covered = rows.reduce((sum, r) => sum + r.totals[`${key}Covered`], 0);
  return total === 0 ? 100 : (covered / total) * 100;
};

const fmt = (n) => `${n.toFixed(2)}%`;

console.log('');
console.log('=== Coverage Summary ===');
for (const row of rows) {
  const t = row.totals;
  console.log(
    `  ${row.pkg.padEnd(9)}  lines=${fmt(t.lines)}  statements=${fmt(t.statements)}  functions=${fmt(t.functions)}  branches=${fmt(t.branches)}`,
  );
}
for (const name of missing) {
  console.log(`  ${name.padEnd(9)}  (no coverage-summary.json found — run coverage for this package)`);
}

// Only emit the aggregate COVERAGE: line — the one /grade parses — if every
// package contributed a full coverage report. A partial aggregate would be
// reported as the whole, which is worse than no number at all (grade.sh
// falls back to "unknown" when no COVERAGE: line is present).
if (missing.length === 0 && rows.length === packages.length) {
  const lines = aggregate('lines');
  const statements = aggregate('statements');
  const functions = aggregate('functions');
  const branches = aggregate('branches');
  console.log(
    `COVERAGE: lines=${fmt(lines)} statements=${fmt(statements)} functions=${fmt(functions)} branches=${fmt(branches)}`,
  );
} else {
  console.error(
    `coverage-summary: missing full coverage for ${missing.join(', ')}; refusing to emit aggregate.`,
  );
  process.exit(1);
}
