#!/usr/bin/env node
/**
 * Validate `click NodeId href "..."` directives in every Mermaid block under
 * the repo:
 *
 * 1. The path component must resolve to an existing file or directory.
 * 2. If the href contains `#symbol`, the symbol must be declared in that file
 *    (function declaration, class, top-level const/let, exported member, or
 *    method on a class for `Class.method` form).
 *
 * Run by `npm run arch:check` and the architecture CI workflow. Catches
 * diagrams that fall out of sync with the code (renames, moves, deletes).
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const require = createRequire(import.meta.url);
let ts = null;
try {
  ts = require('typescript');
} catch {
  // Symbol validation gracefully degrades to file-only checking when TS is
  // missing. The check is enforced in CI where TS is always installed.
}

const SCAN_DIRS = ['docs/architecture'];
const SCAN_FILES = ['server/ARCHITECTURE.md', 'gateway/ARCHITECTURE.md', 'README.md'];
const TS_EXTENSIONS = new Set(['.ts', '.tsx']);

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

const symbolCache = new Map(); // file abs path → Set<symbol>

function collectSymbols(absFile) {
  if (symbolCache.has(absFile)) return symbolCache.get(absFile);
  const symbols = new Set();
  if (!ts) {
    symbolCache.set(absFile, symbols);
    return symbols;
  }
  const content = readFileSync(absFile, 'utf8');
  const sf = ts.createSourceFile(absFile, content, ts.ScriptTarget.Latest, true);

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.add(node.name.text);
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name && ts.isIdentifier(member.name)) {
          symbols.add(`${node.name.text}.${member.name.text}`);
          symbols.add(member.name.text);
        }
      }
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      symbols.add(node.name.text);
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      symbols.add(node.name.text);
    } else if (ts.isEnumDeclaration(node) && node.name) {
      symbols.add(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) symbols.add(decl.name.text);
      }
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) symbols.add(el.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  symbolCache.set(absFile, symbols);
  return symbols;
}

function validateSymbol(absTargetFile, symbol) {
  const ext = path.extname(absTargetFile);
  if (!TS_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `symbol checking is only supported for .ts/.tsx targets (got ${ext || 'no extension'})` };
  }
  const symbols = collectSymbols(absTargetFile);
  if (!ts) {
    return { ok: true, reason: 'typescript not installed; symbol check skipped' };
  }
  if (symbols.has(symbol)) return { ok: true };
  return { ok: false, reason: `symbol '${symbol}' not found among ${symbols.size} declarations` };
}

async function lint() {
  const targets = [...SCAN_FILES];
  for (const dir of SCAN_DIRS) {
    for await (const file of walkMarkdown(dir)) targets.push(file);
  }

  const violations = [];
  let checked = 0;
  let symbolsChecked = 0;

  for (const file of targets) {
    const abs = path.join(repoRoot, file);
    if (!existsSync(abs)) continue;
    const source = await readFile(abs, 'utf8');
    const hrefs = extractClickHrefs(source);
    for (const { href, line, blockStart } of hrefs) {
      checked += 1;
      if (isExternalUrl(href)) continue;
      const [pathPart, symbol] = href.split('#', 2);
      const target = path.resolve(path.dirname(abs), pathPart);
      if (!existsSync(target)) {
        violations.push({ file, line, blockStart, href, kind: 'missing-file', detail: `${path.relative(repoRoot, target)} does not exist` });
        continue;
      }
      if (symbol) {
        symbolsChecked += 1;
        const result = validateSymbol(target, symbol);
        if (!result.ok) {
          violations.push({ file, line, blockStart, href, kind: 'missing-symbol', detail: result.reason });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`lint-diagrams: ${violations.length} broken click href(s)`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} (block at L${v.blockStart}) [${v.kind}]`);
      console.error(`    href: "${v.href}"`);
      console.error(`    ${v.detail}`);
    }
    process.exit(1);
  }

  const tsNote = ts ? '' : ' (typescript not installed; symbol checking disabled)';
  console.log(`lint-diagrams: ${checked} href(s) verified, ${symbolsChecked} symbol(s) cross-checked, across ${targets.length} markdown file(s)${tsNote}`);
}

lint().catch((err) => {
  console.error('lint-diagrams: failed');
  console.error(err);
  process.exit(1);
});
