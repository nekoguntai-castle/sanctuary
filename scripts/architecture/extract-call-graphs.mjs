#!/usr/bin/env node
/**
 * Function-level call-graph extractor.
 *
 * For each subsystem listed in `docs/architecture/calls.config.json`, parses
 * the TypeScript files with the compiler API (no ts-morph), builds a graph of
 * function-to-function calls within the subsystem, and emits a Mermaid diagram
 * wrapped in markdown so it renders on GitHub *and* as a Docusaurus page.
 *
 * Output: docs/architecture/generated/calls/<subsystem>.md
 *
 * Resolution rules (deliberately simple — perfect symbol resolution is hard
 * and the goal is "make new entry points visible", not "produce a verifiable
 * call graph"):
 *
 *   1. Each subsystem file's top-level function-like declarations become
 *      nodes. We collect: function declarations, methods on classes,
 *      variable bindings whose initializer is an arrow/function expression.
 *   2. For each call expression inside a function body, we resolve the callee
 *      name two ways:
 *      - bare identifier: matched against the file's import map; if the import
 *        resolves to a subsystem file, we draw an edge to that file's function
 *        of the same name.
 *      - property access (`obj.foo()`): we take the property name and link to
 *        any subsystem function with the same name. Marked as "ambiguous"
 *        when multiple matches exist.
 *
 * Limitations to surface on every emitted diagram:
 *   - External callers (callers OUTSIDE the listed files) are not shown. The
 *     subsystem boundary is the diagram boundary — adding a new external
 *     caller means adding the caller's file to the include list.
 *   - Constructor calls (`new Foo()`) are skipped.
 *   - Aliased imports follow the local name; re-exports may misresolve.
 *
 * Treat this output as a high-recall hint, not as a proof of completeness.
 */

import { writeFile, mkdir, glob, readdir, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const configPath = path.join(repoRoot, 'docs', 'architecture', 'calls.config.json');
const outDir = path.join(repoRoot, 'docs', 'architecture', 'generated', 'calls');

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  console.error('extract-call-graphs: typescript is not installed at the repo root.');
  console.error('extract-call-graphs: run "npm install" first.');
  process.exit(1);
}

function readConfig() {
  try {
    return validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`extract-call-graphs: invalid config ${path.relative(repoRoot, configPath)}: ${detail}`);
    process.exit(1);
  }
}

export function validateConfig(rawConfig) {
  const errors = [];
  if (!isPlainObject(rawConfig)) {
    throw new Error('expected root object');
  }

  collectUnknownKeys(rawConfig, new Set(['$schema', '_comment', 'subsystems']), '', errors);
  validateOptionalStringField(rawConfig, '$schema', '', errors);
  validateOptionalStringField(rawConfig, '_comment', '', errors);
  if (!Array.isArray(rawConfig.subsystems)) {
    errors.push('subsystems must be an array');
  } else if (rawConfig.subsystems.length === 0) {
    errors.push('subsystems must contain at least one subsystem');
  } else {
    validateSubsystems(rawConfig.subsystems, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  return rawConfig;
}

function validateSubsystems(subsystems, errors) {
  const names = new Set();
  subsystems.forEach((subsystem, index) => {
    const fieldPath = `subsystems[${index}]`;
    if (!isPlainObject(subsystem)) {
      errors.push(`${fieldPath} must be an object`);
      return;
    }
    collectUnknownKeys(subsystem, new Set(['name', 'title', 'description', 'include']), fieldPath, errors);
    validateSubsystemStrings(subsystem, fieldPath, errors);
    validateIncludeList(subsystem.include, `${fieldPath}.include`, errors);
    if (typeof subsystem.name === 'string' && subsystem.name.trim() !== '') {
      if (names.has(subsystem.name)) errors.push(`${fieldPath}.name must be unique`);
      names.add(subsystem.name);
    }
  });
}

function validateSubsystemStrings(subsystem, fieldPath, errors) {
  validateStringField(subsystem, 'name', fieldPath, errors);
  validateStringField(subsystem, 'title', fieldPath, errors);
  validateStringField(subsystem, 'description', fieldPath, errors);
  if (typeof subsystem.name === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(subsystem.name)) {
    errors.push(`${fieldPath}.name must use lowercase letters, numbers, and hyphens`);
  }
}

function validateStringField(object, key, fieldPath, errors) {
  if (typeof object[key] !== 'string' || object[key].trim() === '') {
    errors.push(`${fieldPath}.${key} must be a non-empty string`);
  }
}

function validateOptionalStringField(object, key, fieldPath, errors) {
  if (object[key] !== undefined && typeof object[key] !== 'string') {
    const prefix = fieldPath ? `${fieldPath}.` : '';
    errors.push(`${prefix}${key} must be a string`);
  }
}

function validateIncludeList(include, fieldPath, errors) {
  if (!Array.isArray(include) || include.length === 0) {
    errors.push(`${fieldPath} must be a non-empty array`);
    return;
  }
  include.forEach((pattern, index) => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      errors.push(`${fieldPath}[${index}] must be a non-empty string`);
    } else if (path.isAbsolute(pattern) || pattern.replaceAll('\\', '/').split('/').includes('..')) {
      errors.push(`${fieldPath}[${index}] must be a repository-relative path`);
    }
  });
}

function collectUnknownKeys(object, allowedKeys, fieldPath, errors) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      const prefix = fieldPath ? `${fieldPath}.` : '';
      errors.push(`${prefix}${key} is not supported`);
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function expandIncludes(patterns) {
  const files = new Set();
  const unmatched = [];
  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      let matched = 0;
      for await (const file of glob(pattern, { cwd: repoRoot })) {
        const normalized = normalizeRepoPath(file);
        if (!isRepoFile(normalized)) continue;
        files.add(normalized);
        matched += 1;
      }
      if (matched === 0) unmatched.push(pattern);
    } else if (isRepoFile(pattern)) {
      files.add(normalizeRepoPath(pattern));
    } else {
      unmatched.push(pattern);
    }
  }
  return { files: [...files].sort(), unmatched };
}

function isGlobPattern(pattern) {
  return ['*', '?', '[', ']', '{', '}'].some((char) => pattern.includes(char));
}

function normalizeRepoPath(file) {
  return path.posix.normalize(file.split(path.sep).join('/'));
}

function isRepoFile(file) {
  const abs = path.join(repoRoot, file);
  return existsSync(abs) && statSync(abs).isFile();
}

function nodeId(file, funcName) {
  // Mermaid node ids must be alphanumeric-ish; use a deterministic hash-free
  // id by joining the sanitized file basename and function name.
  const slug = `${path.basename(file, path.extname(file))}_${funcName}`;
  return slug.replace(/[^A-Za-z0-9_]/g, '_');
}

function fileBucketId(file) {
  return path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_]/g, '_');
}

function getFunctionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function isFunctionLikeInitializer(initializer) {
  return initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
}

function collectFunctions(sourceFile, file) {
  const funcs = [];
  function visit(node, scopeName = null) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      funcs.push({ name: node.name.text, body: node.body, file, line: sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile)).line + 1 });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionLikeInitializer(decl.initializer)) {
          funcs.push({ name: decl.name.text, body: decl.initializer.body, file, line: sourceFile.getLineAndCharacterOfPosition(decl.name.getStart(sourceFile)).line + 1 });
        }
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) && member.body) {
          funcs.push({
            name: `${node.name.text}.${member.name.text}`,
            body: member.body,
            file,
            line: sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile)).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, scopeName));
  }
  visit(sourceFile);
  return funcs;
}

function collectImports(sourceFile, file) {
  // Map local name → resolved subsystem file (or null if external).
  const map = new Map();
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const spec = node.moduleSpecifier.text;
    if (!spec.startsWith('.')) return;
    const resolved = resolveRelativeImport(file, spec);
    if (!resolved) return;
    const clause = node.importClause;
    if (!clause) return;
    if (clause.name && ts.isIdentifier(clause.name)) {
      map.set(clause.name.text, resolved);
    }
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        map.set(clause.namedBindings.name.text, resolved);
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          map.set(el.name.text, resolved);
        }
      }
    }
  });
  return map;
}

function resolveRelativeImport(fromFile, specifier) {
  const baseDir = path.dirname(path.join(repoRoot, fromFile));
  const candidates = [
    `${specifier}.ts`,
    `${specifier}.tsx`,
    path.join(specifier, 'index.ts'),
    path.join(specifier, 'index.tsx'),
    specifier,
  ];
  for (const c of candidates) {
    const abs = path.resolve(baseDir, c);
    if (existsSync(abs)) {
      return path.posix.normalize(path.relative(repoRoot, abs).split(path.sep).join('/'));
    }
  }
  return null;
}

function collectCallSites(body, sourceFile) {
  const calls = [];
  if (!body) return calls;
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        calls.push({ kind: 'identifier', name: expr.text });
      } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
        calls.push({
          kind: 'property',
          name: expr.name.text,
          object: ts.isIdentifier(expr.expression) ? expr.expression.text : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return calls;
}

function buildSubsystemGraph(files) {
  const { functionsByFile, importsByFile, allFunctionsByName } = collectSubsystemMetadata(files);
  const edges = collectGraphEdges(files, functionsByFile, importsByFile, allFunctionsByName);
  return { functionsByFile, edges: [...edges].sort() };
}

function collectSubsystemMetadata(files) {
  const functionsByFile = new Map();
  const importsByFile = new Map();
  const allFunctionsByName = new Map(); // name → array of { file, id }

  for (const file of files) {
    const abs = path.join(repoRoot, file);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

    const funcs = collectFunctions(sf, file);
    functionsByFile.set(file, funcs);
    importsByFile.set(file, collectImports(sf, file));
    indexFunctions(file, funcs, allFunctionsByName);
  }

  return { functionsByFile, importsByFile, allFunctionsByName };
}

function indexFunctions(file, funcs, allFunctionsByName) {
  for (const f of funcs) {
    const id = nodeId(file, f.name);
    if (!allFunctionsByName.has(f.name)) allFunctionsByName.set(f.name, []);
    allFunctionsByName.get(f.name).push({ file, id, line: f.line });
    f.id = id;
  }
}

function collectGraphEdges(files, functionsByFile, importsByFile, allFunctionsByName) {
  const edges = new Set();
  const includedFiles = new Set(files);

  for (const [file, funcs] of functionsByFile) {
    const imports = importsByFile.get(file) ?? new Map();
    for (const fn of funcs) {
      addCallEdges(edges, fn, collectCallSites(fn.body), {
        allFunctionsByName,
        funcs,
        functionsByFile,
        imports,
        includedFiles,
      });
    }
  }

  return edges;
}

function addCallEdges(edges, fn, calls, context) {
  for (const call of calls) {
    for (const target of resolveCallTargets(call, fn, context)) {
      if (target.id !== fn.id) edges.add(`${fn.id}-->${target.id}`);
    }
  }
}

function resolveCallTargets(call, fn, context) {
  if (call.kind === 'identifier') {
    return resolveIdentifierCall(call, fn, context);
  }
  if (call.kind === 'property') {
    return context.allFunctionsByName.get(call.name) ?? [];
  }
  return [];
}

function resolveIdentifierCall(call, fn, context) {
  const importedFrom = context.imports.get(call.name);
  if (importedFrom && context.includedFiles.has(importedFrom)) {
    return (context.functionsByFile.get(importedFrom) ?? []).filter((f) => f.name === call.name);
  }
  if (!importedFrom) {
    return context.funcs.filter((f) => f.name === call.name && f.id !== fn.id);
  }
  return [];
}

function repoUrl(file, line) {
  const sourceRef = process.env.SANCTUARY_ARCH_SOURCE_REF || 'main';
  return `https://github.com/nekoguntai-castle/sanctuary/blob/${sourceRef}/${file}#L${line}`;
}

function renderMermaid(subsystem, files, graph) {
  const lines = ['flowchart LR'];
  for (const file of files) {
    const funcs = graph.functionsByFile.get(file);
    if (!funcs || funcs.length === 0) continue;
    lines.push(`    subgraph ${fileBucketId(file)}["${path.basename(file)}"]`);
    for (const f of funcs) {
      lines.push(`        ${f.id}["${escapeLabel(f.name)}()"]`);
    }
    lines.push('    end');
  }
  for (const edge of graph.edges) lines.push(`    ${edge}`);
  // Click hrefs — point each function at its source line on GitHub.
  for (const file of files) {
    const funcs = graph.functionsByFile.get(file);
    if (!funcs) continue;
    for (const f of funcs) {
      lines.push(`    click ${f.id} href "${repoUrl(file, f.line)}" "View source"`);
    }
  }
  return lines.join('\n');
}

function escapeLabel(s) {
  return s.replace(/"/g, '&quot;');
}

function wrapMarkdown(subsystem, files, mermaid, totals) {
  return `---
title: ${subsystem.title} — function-level call graph
sidebar_label: ${subsystem.title} (calls)
description: ${subsystem.description}
---

# ${subsystem.title} — function-level call graph

${subsystem.description}

Auto-generated by \`npm run arch:calls\`. Do not edit by hand — the architecture CI workflow regenerates this on every PR and fails the build if the committed file is stale.

**Scope:** the graph shows function-to-function calls **within the listed files only**. Callers from outside this subsystem are not shown — adding a new external caller means adding its file to \`docs/architecture/calls.config.json\` so the new edge surfaces in the diagram and in the PR diff.

**Files in scope** (${files.length}):

${files.map((f) => `- [\`${f}\`](https://github.com/nekoguntai-castle/sanctuary/blob/main/${f})`).join('\n')}

**Stats:** ${totals.functions} function nodes, ${totals.edges} call edges.

\`\`\`mermaid
${mermaid}
\`\`\`
`;
}

async function removeStaleOutputs(subsystems) {
  const expected = new Set(subsystems.map((subsystem) => `${subsystem.name}.md`));
  const entries = await readdir(outDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'README.md') continue;
    if (!entry.isFile() || path.extname(entry.name) !== '.md' || expected.has(entry.name)) continue;
    const stalePath = path.join(outDir, entry.name);
    await unlink(stalePath);
    console.log(`extract-call-graphs: removed stale ${path.relative(repoRoot, stalePath)}`);
  }
}

export async function main() {
  if (!existsSync(configPath)) {
    console.error(`extract-call-graphs: missing config ${path.relative(repoRoot, configPath)}`);
    process.exit(1);
  }

  const config = readConfig();
  await mkdir(outDir, { recursive: true });

  let totalSubsystems = 0;
  for (const subsystem of config.subsystems) {
    const { files, unmatched } = await expandIncludes(subsystem.include);
    if (unmatched.length > 0) {
      console.error(`extract-call-graphs: subsystem '${subsystem.name}' includes did not match files: ${unmatched.join(', ')}`);
      process.exit(1);
    }
    const graph = buildSubsystemGraph(files);
    const totalFunctions = [...graph.functionsByFile.values()].reduce((sum, fs) => sum + fs.length, 0);
    const mermaid = renderMermaid(subsystem, files, graph);
    const wrapped = wrapMarkdown(subsystem, files, mermaid, { functions: totalFunctions, edges: graph.edges.length });
    const outFile = path.join(outDir, `${subsystem.name}.md`);
    await writeFile(outFile, wrapped, 'utf8');
    console.log(`extract-call-graphs: wrote ${path.relative(repoRoot, outFile)} (${files.length} files, ${totalFunctions} fns, ${graph.edges.length} edges)`);
    totalSubsystems += 1;
  }

  await removeStaleOutputs(config.subsystems);

  if (totalSubsystems === 0) {
    console.error('extract-call-graphs: no subsystems produced output');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
