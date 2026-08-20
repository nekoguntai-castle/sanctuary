#!/usr/bin/env node
/**
 * Regenerate dependency-cruiser Mermaid graphs for every package.
 *
 * Output: docs/architecture/generated/{frontend,server,gateway}.md
 *   — markdown wrapper containing the Mermaid block, so the file renders
 *   inline on GitHub *and* is picked up by Docusaurus as a doc page.
 *
 * Each package is scanned with its explicitly owned dependency-cruiser config.
 * Output is checked for staleness in CI by
 * `.github/workflows/architecture.yml`.
 */

import { glob, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const generatedDir = path.join(repoRoot, 'docs', 'architecture', 'generated');
const frontendDepcruiseConfig = path.join(repoRoot, 'config', 'tooling', 'dependency-cruiser.cjs');

// `--collapse` groups nodes by directory prefix so the rendered Mermaid stays
// readable; without it every individual `.ts` file becomes its own node.
// Patterns avoid alternation/optional groups — depcruise's safety guard refuses
// regexes it considers slow.
const PACKAGES = [
  {
    name: 'frontend',
    title: 'Frontend',
    cwd: repoRoot,
    presenceCheck: ['src'],
    globs: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
    configFile: frontendDepcruiseConfig,
    // Preserve the feature-level groups that were visible before the frontend
    // moved beneath src/. Shared files remain individually visible.
    collapse: '^[^/]+/[^/]+/[^/]+/',
  },
  {
    name: 'server',
    title: 'Server',
    cwd: path.join(repoRoot, 'server'),
    presenceCheck: ['src'],
    globs: ['src/**/*.ts'],
    configFile: path.join(repoRoot, 'server', '.dependency-cruiser.cjs'),
    collapse: '^src/[^/]+/',
  },
  {
    name: 'gateway',
    title: 'Gateway',
    cwd: path.join(repoRoot, 'gateway'),
    presenceCheck: ['src'],
    globs: ['src/**/*.ts'],
    configFile: path.join(repoRoot, 'gateway', '.dependency-cruiser.cjs'),
    collapse: '^src/[^/]+/',
  },
];

const GLOB_PATTERN_CHARS = /[*?[\]{}]/u;

function isGlobPattern(pattern) {
  return GLOB_PATTERN_CHARS.test(pattern);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function expandPattern(cwd, pattern) {
  if (!isGlobPattern(pattern)) {
    return existsSync(path.join(cwd, pattern)) ? [pattern] : [];
  }

  const matches = [];
  for await (const filePath of glob(pattern, { cwd })) {
    matches.push(toPosixPath(filePath));
  }
  return matches.sort();
}

export async function expandPackageGlobs(pkg) {
  const files = [];
  const missingPatterns = [];
  const seen = new Set();

  for (const pattern of pkg.globs) {
    const matches = await expandPattern(pkg.cwd, pattern);
    if (matches.length === 0) {
      missingPatterns.push(pattern);
    }
    for (const filePath of matches) {
      if (!seen.has(filePath)) {
        seen.add(filePath);
        files.push(filePath);
      }
    }
  }

  if (missingPatterns.length > 0) {
    throw new Error(`generate-graphs: ${pkg.name}: no files matched ${missingPatterns.join(', ')}`);
  }
  if (files.length === 0) {
    throw new Error(`generate-graphs: ${pkg.name}: no dependency-cruiser inputs found`);
  }
  return files;
}

export function assertMermaidGraph(pkg, mermaid, inputCount) {
  if (!mermaid.trim().startsWith('flowchart ')) {
    throw new Error(
      `generate-graphs: ${pkg.name}: dependency-cruiser produced no Mermaid graph for ${inputCount} inputs`,
    );
  }
}

async function loadDependencyCruiser() {
  try {
    const dependencyCruiser = await import('dependency-cruiser');
    const extractOptionsModule = await import('dependency-cruiser/config-utl/extract-depcruise-options');
    return {
      cruise: dependencyCruiser.cruise,
      extractOptions: extractOptionsModule.default,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `generate-graphs: dependency-cruiser is not installed. Run "npm install" at the repo root, then retry.\n${message}`,
    );
  }
}

async function getCruiseOptions(pkg, extractOptions) {
  const configFile = pkg.configFile;
  if (!existsSync(configFile)) {
    throw new Error(`generate-graphs: ${pkg.name}: missing ${path.relative(repoRoot, configFile)}`);
  }

  const options = await extractOptions(configFile);
  const tsConfig = options.tsConfig?.fileName
    ? {
        ...options.tsConfig,
        fileName: path.resolve(pkg.cwd, options.tsConfig.fileName),
      }
    : options.tsConfig;
  return {
    ...options,
    tsConfig,
    baseDir: pkg.cwd,
    collapse: pkg.collapse,
    outputType: 'mermaid',
    progress: { type: 'none' },
  };
}

/**
 * Replace dependency-cruiser's positional node ids with ids derived from each
 * node's place in the graph.
 *
 * The emitter names nodes by the order it happens to visit them — `4R`, `4S`,
 * `4T`. Inserting one module renumbers every node after it and every edge that
 * mentions one, so adding a single file rewrote ~700 lines of a 1171-line file:
 * the diff was unreviewable, and any two branches that each added a module
 * conflicted here even when they touched nothing else.
 *
 * A node's path through the subgraph labels is unique and stable, so an id built
 * from it changes only when that node does. Adding a module then adds its own
 * lines and nothing else.
 *
 * Runs before `stabilizeMermaidEdges`, or the sort would order edges by the
 * positional ids this is replacing.
 */
export function stabilizeMermaidIds(mermaid) {
  const subgraphRe = /^(\s*)subgraph\s+([\w-]+)\["(.*)"\]\s*$/;
  const nodeRe = /^(\s*)([\w-]+)\["(.*)"\]\s*$/;
  const endRe = /^\s*end\s*$/;
  const edgeRe = /^(\s*)([\w-]+)-->([\w-]+)\s*$/;

  const lines = mermaid.split('\n');
  const idByOld = new Map();
  const taken = new Set();
  const stack = [];

  const assign = (oldId, label) => {
    // A collapsed group's hidden files are emitted as a blank label; name them
    // for the group they belong to rather than leaving them anonymous.
    const segments = [...stack, label.trim() === '' ? '_collapsed' : label.trim()];
    let candidate = `n_${segments.join('_').replace(/[^A-Za-z0-9_]+/g, '_')}`;
    // Two distinct paths cannot collide, but two labels differing only in
    // punctuation can slug the same. Suffix rather than silently merge nodes.
    if (taken.has(candidate)) {
      let suffix = 2;
      while (taken.has(`${candidate}_${suffix}`)) suffix += 1;
      candidate = `${candidate}_${suffix}`;
    }
    taken.add(candidate);
    idByOld.set(oldId, candidate);
  };

  for (const line of lines) {
    const subgraph = subgraphRe.exec(line);
    if (subgraph) {
      assign(subgraph[2], subgraph[3]);
      stack.push(subgraph[3].trim());
      continue;
    }
    if (endRe.test(line)) {
      stack.pop();
      continue;
    }
    const node = nodeRe.exec(line);
    if (node) assign(node[2], node[3]);
  }

  const rename = (id) => idByOld.get(id) ?? id;
  return lines.map((line) => {
    const subgraph = subgraphRe.exec(line);
    if (subgraph) return `${subgraph[1]}subgraph ${rename(subgraph[2])}["${subgraph[3]}"]`;
    const node = nodeRe.exec(line);
    if (node) return `${node[1]}${rename(node[2])}["${node[3]}"]`;
    const edge = edgeRe.exec(line);
    if (edge) return `${edge[1]}${rename(edge[2])}-->${rename(edge[3])}`;
    return line;
  }).join('\n');
}

// Stabilize edge ordering: dependency-cruiser's Mermaid emitter produces
// edges in a Map-iteration order that's not deterministic across Node
// versions / fs orderings. Sort consecutive `A-->B` lines within each
// source-node group to give a stable diff.
export function stabilizeMermaidEdges(mermaid) {
  const lines = mermaid.split('\n');
  const edgeRe = /^(\s*)([\w-]+)-->([\w-]+)\s*$/;
  const out = [];
  let runStart = -1;
  let runSource = null;
  const flush = (end) => {
    if (runStart < 0 || end - runStart <= 1) {
      runStart = -1;
      runSource = null;
      return;
    }
    const block = out.slice(runStart, end).sort();
    for (let i = 0; i < block.length; i++) out[runStart + i] = block[i];
    runStart = -1;
    runSource = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = edgeRe.exec(line);
    if (m) {
      const source = m[2];
      if (source !== runSource) {
        flush(out.length);
        runSource = source;
        runStart = out.length;
      }
      out.push(line);
    } else {
      flush(out.length);
      out.push(line);
    }
  }
  flush(out.length);
  return out.join('\n');
}

async function cruiseMermaid(pkg, dependencyCruiser) {
  // Pre-expand + sort the file list deterministically; dependency-cruiser
  // assigns node IDs in input order, so passing the original glob patterns
  // (which `cruise()` re-expands via fast-glob in a non-deterministic order
  // on some filesystems) produces different graphs across environments.
  // Passing the sorted file list makes the output reproducible.
  const files = await expandPackageGlobs(pkg);
  const options = await getCruiseOptions(pkg, dependencyCruiser.extractOptions);
  const result = await dependencyCruiser.cruise(files, options);
  const mermaid = String(result.output ?? '');
  assertMermaidGraph(pkg, mermaid, files.length);
  return stabilizeMermaidEdges(stabilizeMermaidIds(mermaid));
}

export function wrap(pkg, mermaid) {
  const title = `${pkg.title} module graph`;
  return `---
title: ${title}
sidebar_label: ${pkg.title}
description: Auto-generated dependency-cruiser module graph for the ${pkg.name} package.
---

# ${title}

Auto-generated by \`npm run arch:graphs\`. Do not edit by hand — the architecture CI workflow regenerates this on every PR and fails the build if the committed file is stale.

## How to read this graph

This is an import-dependency appendix for drift detection. It answers "which source groups import which other source groups?" and does not replace the hand-authored C4 diagrams.

- Nodes are collapsed by directory (\`--collapse '${pkg.collapse}'\`) so the diagram stays readable.
- Blank nodes inside collapsed groups are files hidden by the collapse rule.
- Use this page to spot unexpected dependency direction, then jump back to the service architecture and source files for design intent.

\`\`\`mermaid
${mermaid.trim()}
\`\`\`
`;
}

export async function main() {
  await mkdir(generatedDir, { recursive: true });
  const dependencyCruiser = await loadDependencyCruiser();

  const results = await Promise.all(PACKAGES.map(async (pkg) => {
    if (!pkg.presenceCheck.some((s) => existsSync(path.join(pkg.cwd, s)))) {
      return { pkg, skipped: true };
    }
    const mermaid = await cruiseMermaid(pkg, dependencyCruiser);
    const outFile = path.join(generatedDir, `${pkg.name}.md`);
    const wrapped = wrap(pkg, mermaid);
    await writeFile(outFile, wrapped, 'utf8');
    return { pkg, outFile, bytes: wrapped.length };
  }));

  for (const r of results) {
    if (r.skipped) {
      console.warn(`generate-graphs: ${r.pkg.name}: no source roots present, skipped`);
    } else {
      console.log(`generate-graphs: wrote ${path.relative(repoRoot, r.outFile)} (${r.bytes} bytes)`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
