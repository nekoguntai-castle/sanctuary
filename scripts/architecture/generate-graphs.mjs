#!/usr/bin/env node
/**
 * Regenerate dependency-cruiser Mermaid graphs for every package.
 *
 * Output: docs/architecture/generated/{frontend,server,gateway}.md
 *   — markdown wrapper containing the Mermaid block, so the file renders
 *   inline on GitHub *and* is picked up by Docusaurus as a doc page.
 *
 * Each package is scanned with its own `.dependency-cruiser.cjs` config
 * (auto-discovered from the cwd). Output is checked for staleness in CI by
 * `.github/workflows/architecture.yml`.
 */

import { glob, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const generatedDir = path.join(repoRoot, 'docs', 'architecture', 'generated');
const depcruiseConfigName = '.dependency-cruiser.cjs';

// `--collapse` groups nodes by directory prefix so the rendered Mermaid stays
// readable; without it every individual `.ts` file becomes its own node.
// Patterns avoid alternation/optional groups — depcruise's safety guard refuses
// regexes it considers slow.
const PACKAGES = [
  {
    name: 'frontend',
    title: 'Frontend',
    cwd: repoRoot,
    presenceCheck: ['App.tsx', 'src'],
    globs: [
      'App.tsx',
      'components/**/*.{ts,tsx}',
      'contexts/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
      'services/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'themes/**/*.{ts,tsx}',
      'utils/**/*.{ts,tsx}',
      'shared/**/*.ts',
    ],
    collapse: '^[^/]+/[^/]+/',
  },
  {
    name: 'server',
    title: 'Server',
    cwd: path.join(repoRoot, 'server'),
    presenceCheck: ['src'],
    globs: ['src/**/*.ts'],
    collapse: '^src/[^/]+/',
  },
  {
    name: 'gateway',
    title: 'Gateway',
    cwd: path.join(repoRoot, 'gateway'),
    presenceCheck: ['src'],
    globs: ['src/**/*.ts'],
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
  const configFile = path.join(pkg.cwd, depcruiseConfigName);
  if (!existsSync(configFile)) {
    throw new Error(`generate-graphs: ${pkg.name}: missing ${path.relative(repoRoot, configFile)}`);
  }

  const options = await extractOptions(configFile);
  return {
    ...options,
    baseDir: pkg.cwd,
    collapse: pkg.collapse,
    outputType: 'mermaid',
    progress: { type: 'none' },
  };
}

async function cruiseMermaid(pkg, dependencyCruiser) {
  const files = await expandPackageGlobs(pkg);
  const options = await getCruiseOptions(pkg, dependencyCruiser.extractOptions);
  const result = await dependencyCruiser.cruise(pkg.globs, options);
  const mermaid = String(result.output ?? '');
  assertMermaidGraph(pkg, mermaid, files.length);
  return mermaid;
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
