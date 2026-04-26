#!/usr/bin/env node
/**
 * Validate `click NodeId href "..."` directives in every Mermaid block under
 * the repo: each href must resolve to an existing file (or directory).
 *
 * Run by `npm run arch:check` and the architecture CI workflow. Catches
 * diagrams that fall out of sync with the code (renames, moves, deletes).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

function extractClickHrefs(source) {
  const hrefs = [];
  const lines = source.split('\n');
  let inBlock = false;
  let blockStartLine = 0;
  lines.forEach((line, idx) => {
    if (!inBlock && /^```mermaid\s*$/.test(line)) {
      inBlock = true;
      blockStartLine = idx + 1;
      return;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false;
      return;
    }
    if (inBlock) {
      const match = line.match(CLICK_PATTERN);
      if (match) hrefs.push({ href: match[1], line: idx + 1, blockStart: blockStartLine });
    }
  });
  return hrefs;
}

function isExternalUrl(href) {
  return /^(https?:|mailto:|#)/.test(href);
}

async function lint() {
  const targets = [...SCAN_FILES];
  for (const dir of SCAN_DIRS) {
    for await (const file of walkMarkdown(dir)) targets.push(file);
  }

  const violations = [];
  let checked = 0;

  for (const file of targets) {
    const abs = path.join(repoRoot, file);
    if (!existsSync(abs)) continue;
    const source = await readFile(abs, 'utf8');
    const hrefs = extractClickHrefs(source);
    for (const { href, line, blockStart } of hrefs) {
      checked += 1;
      if (isExternalUrl(href)) continue;
      const target = path.resolve(path.dirname(abs), href);
      if (!existsSync(target)) {
        violations.push({ file, line, blockStart, href, target: path.relative(repoRoot, target) });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`lint-diagrams: ${violations.length} broken click href(s) in ${targets.length} file(s)`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} (block at L${v.blockStart})`);
      console.error(`    href: "${v.href}"`);
      console.error(`    resolves to: ${v.target} (does not exist)`);
    }
    process.exit(1);
  }

  console.log(`lint-diagrams: ${checked} click href(s) verified across ${targets.length} markdown file(s)`);
}

lint().catch((err) => {
  console.error('lint-diagrams: failed');
  console.error(err);
  process.exit(1);
});
