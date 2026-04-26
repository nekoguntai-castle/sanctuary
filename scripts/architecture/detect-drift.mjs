#!/usr/bin/env node
/**
 * Diagram drift detector.
 *
 * For each PR, builds an index of `{ file → [diagrams that reference it] }`
 * by scanning click hrefs in every Mermaid block under the repo, then compares
 * against the PR's changed-file list. If a code file was modified but the
 * diagrams referencing it were NOT, emit a GitHub Actions warning prompting
 * the author to review the diagram for accuracy.
 *
 * Warn-only — doesn't fail CI. The signal is that a human should look; not
 * every code change to a diagrammed file requires a diagram update (refactors,
 * bug fixes, test additions). Failing-CI on this would be too noisy.
 *
 * Usage:
 *   node scripts/architecture/detect-drift.mjs                  # diff vs origin/main
 *   node scripts/architecture/detect-drift.mjs <ref>            # diff vs <ref>
 *   node scripts/architecture/detect-drift.mjs --files a.ts b.ts # explicit list
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const SCAN_DIRS = ['docs/architecture'];
const SCAN_FILES = ['server/ARCHITECTURE.md', 'gateway/ARCHITECTURE.md', 'README.md'];

async function* walkMarkdown(dir) {
  const abs = path.join(repoRoot, dir);
  if (!existsSync(abs)) return;
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') continue;
      yield* walkMarkdown(full);
    } else if (entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

const CLICK_PATTERN = /^\s*click\s+\S+\s+href\s+"([^"]+)"/;

function extractClickRefs(source) {
  const refs = [];
  const lines = source.split('\n');
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock && /^```mermaid\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^```\s*$/.test(line)) { inBlock = false; continue; }
    if (inBlock) {
      const match = line.match(CLICK_PATTERN);
      if (match) refs.push(match[1]);
    }
  }
  return refs;
}

function isExternal(href) {
  return /^(https?:|mailto:|#)/.test(href);
}

async function buildReferenceIndex() {
  const targets = [...SCAN_FILES];
  for (const dir of SCAN_DIRS) {
    for await (const file of walkMarkdown(dir)) targets.push(file);
  }

  // file → Set<diagram path>
  const index = new Map();
  for (const diagram of targets) {
    const abs = path.join(repoRoot, diagram);
    if (!existsSync(abs)) continue;
    const source = await readFile(abs, 'utf8');
    for (const href of extractClickRefs(source)) {
      if (isExternal(href)) continue;
      const [pathPart] = href.split('#', 2);
      const resolved = path.resolve(path.dirname(abs), pathPart);
      const rel = path.relative(repoRoot, resolved).split(path.sep).join('/');
      if (!index.has(rel)) index.set(rel, new Set());
      index.get(rel).add(diagram);
    }
  }
  return index;
}

function getChangedFiles() {
  const idx = process.argv.indexOf('--files');
  if (idx !== -1) return process.argv.slice(idx + 1);
  const ref = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  try {
    const output = execSync(`git diff --name-only ${ref}...HEAD`, { cwd: repoRoot, encoding: 'utf8' });
    return output.split('\n').filter(Boolean);
  } catch (err) {
    console.error(`detect-drift: could not diff against ${ref}: ${err.message}`);
    return [];
  }
}

function emitWarning(message) {
  // GitHub Actions annotation; on stdout otherwise.
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning::${message}`);
  } else {
    console.warn(`detect-drift: ${message}`);
  }
}

async function main() {
  const index = await buildReferenceIndex();
  const changed = new Set(getChangedFiles());
  if (changed.size === 0) {
    console.log('detect-drift: no changed files to scan');
    return;
  }

  const changedDiagrams = new Set();
  for (const file of changed) {
    if (file.endsWith('.md') && (file.startsWith('docs/architecture/') || file.endsWith('ARCHITECTURE.md') || file === 'README.md')) {
      changedDiagrams.add(file);
    }
  }

  let warningCount = 0;
  const summary = [];
  for (const file of [...changed].sort()) {
    const diagrams = index.get(file);
    if (!diagrams) continue;
    const stale = [...diagrams].filter((d) => !changedDiagrams.has(d));
    if (stale.length === 0) continue;
    warningCount += 1;
    const list = stale.map((d) => `  - ${d}`).join('\n');
    const message = `'${file}' is referenced by ${stale.length} diagram(s); confirm they remain accurate:\n${list}`;
    emitWarning(message);
    summary.push({ file, diagrams: stale });
  }

  if (process.env.GITHUB_STEP_SUMMARY && summary.length > 0) {
    const lines = [
      '## Architecture diagram drift check',
      '',
      `${summary.length} changed file(s) are referenced by hand-authored diagrams that were not modified in this PR. Confirm the diagrams are still accurate.`,
      '',
      '| Changed file | Referencing diagram(s) |',
      '|---|---|',
    ];
    for (const { file, diagrams } of summary) {
      lines.push(`| \`${file}\` | ${diagrams.map((d) => `\`${d}\``).join(', ')} |`);
    }
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  if (warningCount === 0) {
    console.log(`detect-drift: ${changed.size} changed file(s) scanned; no diagram drift detected`);
  } else {
    console.log(`detect-drift: ${warningCount} drift warning(s) emitted (warn-only — does not fail CI)`);
  }
}

main().catch((err) => {
  console.error('detect-drift: failed');
  console.error(err);
  // Warn-only — never fail CI from this script.
  process.exit(0);
});
