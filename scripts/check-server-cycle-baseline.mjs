#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import extractOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'server');
const baselinePath = path.join(repoRoot, 'scripts/quality/server-cycle-baseline.json');

export function canonicalCycleKeys(modules) {
  const keys = new Set();
  for (const module of modules) {
    for (const dependency of module.dependencies ?? []) {
      if (!dependency.circular) continue;
      const members = [
        module.source,
        ...(dependency.cycle ?? []).map(entry => entry.name),
      ];
      keys.add([...new Set(members)].sort().join(' -> '));
    }
  }
  return [...keys].sort();
}

export function canonicalCircularEdges(modules) {
  const edges = new Set();
  for (const module of modules) {
    for (const dependency of module.dependencies ?? []) {
      if (dependency.circular) edges.add(`${module.source} -> ${dependency.resolved}`);
    }
  }
  return [...edges].sort();
}

export function compareCycleInventory(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    added: actual.filter(cycle => !expectedSet.has(cycle)),
    removed: expected.filter(cycle => !actualSet.has(cycle)),
  };
}

async function loadServerModules() {
  const configPath = path.join(serverRoot, '.dependency-cruiser.cjs');
  const options = await extractOptions(configPath);
  const result = await cruise(['src'], {
    ...options,
    baseDir: serverRoot,
    outputType: 'json',
    progress: { type: 'none' },
    tsConfig: {
      ...options.tsConfig,
      fileName: path.resolve(serverRoot, options.tsConfig.fileName),
    },
  });
  return JSON.parse(result.output).modules ?? [];
}

async function main() {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!Array.isArray(baseline.cycles) || !Array.isArray(baseline.edges)) {
    throw new Error('server cycle baseline must contain cycles and edges arrays');
  }
  const modules = await loadServerModules();
  const cycleDiff = compareCycleInventory(baseline.cycles, canonicalCycleKeys(modules));
  const edgeDiff = compareCycleInventory(baseline.edges, canonicalCircularEdges(modules));
  if (cycleDiff.added.length > 0 || cycleDiff.removed.length > 0
    || edgeDiff.added.length > 0 || edgeDiff.removed.length > 0) {
    console.error('server-cycle-baseline: dependency cycle inventory changed');
    for (const cycle of cycleDiff.added) console.error(`server-cycle-baseline: added set: ${cycle}`);
    for (const cycle of cycleDiff.removed) console.error(`server-cycle-baseline: removed set: ${cycle}`);
    for (const edge of edgeDiff.added) console.error(`server-cycle-baseline: added edge: ${edge}`);
    for (const edge of edgeDiff.removed) console.error(`server-cycle-baseline: removed edge: ${edge}`);
    console.error('Remove cycles when possible; update the baseline only in the same reviewed change.');
    process.exit(1);
  }
  console.log(
    `server-cycle-baseline: passed (${baseline.cycles.length} known cycle sets, ${baseline.edges.length} circular edges)`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('server-cycle-baseline: failed');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
