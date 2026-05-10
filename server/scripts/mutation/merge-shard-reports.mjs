#!/usr/bin/env node
/**
 * Merge per-shard Stryker JSON reports into the canonical report path that
 * `check-critical-mutation-gate.mjs` expects.
 *
 * Stryker's mutation-testing-elements JSON schema (top-level keys: `schemaVersion`,
 * `thresholds`, `projectRoot`, `framework`, `system`, `files`, `testFiles`,
 * `performance`, `config`) is union-able by file path because each shard mutates a
 * disjoint set of source files. We re-use the first shard's metadata fields and
 * union the `files` and `testFiles` maps; collisions throw because they would
 * indicate a shard-definition bug (overlapping `mutate` patterns).
 *
 * Usage:
 *   node scripts/mutation/merge-shard-reports.mjs \
 *     reports/mutation/critical-mutation-report.shard-1.json \
 *     reports/mutation/critical-mutation-report.shard-2.json \
 *     reports/mutation/critical-mutation-report.shard-3.json \
 *     [--out reports/mutation/critical-mutation-report.json]
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const inputs = [];
  let out = 'reports/mutation/critical-mutation-report.json';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      out = argv[index + 1];
      if (!out) {
        throw new Error('--out requires a path argument');
      }
      index += 1;
      continue;
    }
    inputs.push(arg);
  }
  if (inputs.length === 0) {
    throw new Error('No input report paths provided');
  }
  return { inputs, out };
}

function readJson(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Report not found: ${absolute}`);
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function mergeReports(reports) {
  if (reports.length === 0) {
    throw new Error('No reports to merge');
  }
  const [first] = reports;
  const merged = {
    ...first,
    files: { ...(first.files ?? {}) },
    testFiles: { ...(first.testFiles ?? {}) },
  };
  for (let index = 1; index < reports.length; index += 1) {
    const next = reports[index];
    for (const [filePath, fileData] of Object.entries(next.files ?? {})) {
      if (filePath in merged.files) {
        throw new Error(
          `Shard report collision on source file ${filePath}; shards must mutate disjoint sets.`,
        );
      }
      merged.files[filePath] = fileData;
    }
    for (const [filePath, fileData] of Object.entries(next.testFiles ?? {})) {
      // Test files can legitimately overlap (every shard runs the same tests).
      // Keep the first occurrence; downstream code only reads `files`.
      if (!(filePath in merged.testFiles)) {
        merged.testFiles[filePath] = fileData;
      }
    }
  }
  return merged;
}

function main() {
  const { inputs, out } = parseArgs(process.argv.slice(2));
  const reports = inputs.map(readJson);
  const merged = mergeReports(reports);
  const outAbsolute = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(outAbsolute), { recursive: true });
  fs.writeFileSync(outAbsolute, JSON.stringify(merged, null, 2));
  const fileCount = Object.keys(merged.files ?? {}).length;
  // eslint-disable-next-line no-console
  console.log(
    `merge-shard-reports: merged ${reports.length} shard report(s) covering ${fileCount} source file(s) -> ${out}`,
  );
}

try {
  main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(`merge-shard-reports: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
