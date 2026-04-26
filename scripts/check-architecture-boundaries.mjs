#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const codeFilePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const sourceRoots = [
  'App.tsx',
  'components',
  'contexts',
  'hooks',
  'services',
  'src',
  'themes',
  'utils',
  'shared',
  'server/src',
  'gateway/src',
];
const excludedSegments = [
  '/node_modules/',
  '/dist/',
  '/build/',
  '/coverage/',
  '/reports/',
  '/playwright-report/',
  '/test-results/',
  '/server/src/generated/',
];
const exceptionFile = 'scripts/quality/architecture-boundary-exceptions.json';

const browserRootPrefixes = [
  'components/',
  'contexts/',
  'hooks/',
  'services/',
  'src/',
  'themes/',
  'utils/',
];

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function isBrowserRuntimePath(relativePath) {
  return relativePath === 'App.tsx' || browserRootPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function isExcluded(relativePath) {
  return (
    relativePath.includes('.test.') ||
    relativePath.includes('.spec.') ||
    relativePath.includes('/__tests__/') ||
    relativePath.includes('/fixtures/') ||
    excludedSegments.some((segment) => relativePath.includes(segment))
  );
}

function walk(relativePath, files = []) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    return files;
  }

  const stats = statSync(fullPath);
  const normalized = normalize(relativePath);

  if (isExcluded(normalized)) {
    return files;
  }

  if (stats.isFile()) {
    if (codeFilePattern.test(normalized)) {
      files.push(normalized);
    }
    return files;
  }

  if (!stats.isDirectory()) {
    return files;
  }

  for (const entry of readdirSync(fullPath)) {
    walk(path.join(relativePath, entry), files);
  }

  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractNamedSymbols(statement) {
  // Pulls out the locally-bound names from import-clause forms:
  //   import { a, b as c } from '...'         → ['a', 'b']
  //   import def, { a } from '...'            → ['def', 'a']
  //   import * as ns from '...'               → ['ns']
  //   import def from '...'                   → ['def']
  // Used for symbol-level forbidden-import rules.
  const symbols = new Set();
  const named = statement.match(/\{([^}]+)\}/);
  if (named) {
    for (const part of named[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
      if (name) symbols.add(name);
    }
  }
  const namespace = statement.match(/\*\s+as\s+(\w+)/);
  if (namespace) symbols.add(namespace[1]);
  const defaultImport = statement.match(/^import\s+(?:type\s+)?(\w+)\s*(?:,|from)/);
  if (defaultImport) symbols.add(defaultImport[1]);
  return symbols;
}

function collectImportStatements(source) {
  const executableSource = stripComments(source);
  const imports = [];
  const staticPattern = /(^|\n)\s*(import|export)\s+[\s\S]*?;/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of executableSource.matchAll(staticPattern)) {
    const statement = match[0].trim();
    const sideEffect = statement.match(/^import\s+['"]([^'"]+)['"]/);
    const from = statement.match(/\sfrom\s+['"]([^'"]+)['"]/);
    const specifier = from?.[1] ?? sideEffect?.[1];

    if (!specifier) {
      continue;
    }

    imports.push({
      specifier,
      typeOnly: /^(?:import|export)\s+type\b/.test(statement),
      dynamic: false,
      symbols: extractNamedSymbols(statement),
    });
  }

  for (const match of executableSource.matchAll(dynamicPattern)) {
    imports.push({
      specifier: match[1],
      typeOnly: false,
      dynamic: true,
      symbols: new Set(),
    });
  }

  return imports;
}

function loadExceptions() {
  const fullPath = path.join(root, exceptionFile);
  if (!existsSync(fullPath)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${exceptionFile} must contain a JSON array`);
  }

  return parsed.map((exception, index) => {
    const context = `${exceptionFile}[${index}]`;
    for (const field of ['rule', 'file', 'target', 'reason', 'removeWhen']) {
      if (typeof exception[field] !== 'string' || exception[field].trim() === '') {
        throw new Error(`${context}.${field} must be a non-empty string`);
      }
    }
    if (exception.specifier !== undefined && typeof exception.specifier !== 'string') {
      throw new Error(`${context}.specifier must be a string when present`);
    }
    if (exception.owner !== undefined && typeof exception.owner !== 'string') {
      throw new Error(`${context}.owner must be a string when present`);
    }
    return exception;
  });
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const basePath = path.resolve(root, path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.mjs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalize(path.relative(root, candidate));
    }
  }

  return null;
}

const rules = [
  {
    id: 'server-repositories-runtime-upward',
    description: 'repositories may not import runtime services, API routes, workers, jobs, or websocket modules',
    from: (file) => file.startsWith('server/src/repositories/'),
    forbidden: (target) => (
      target.startsWith('server/src/services/') ||
      target.startsWith('server/src/api/') ||
      target.startsWith('server/src/worker/') ||
      target.startsWith('server/src/jobs/') ||
      target.startsWith('server/src/websocket/')
    ),
    ignoreTypeOnly: true,
  },
  {
    id: 'server-services-runtime-api',
    description: 'services may not import runtime API route modules',
    from: (file) => file.startsWith('server/src/services/'),
    forbidden: (target) => target.startsWith('server/src/api/'),
    ignoreTypeOnly: true,
  },
  {
    id: 'server-api-runtime-worker',
    description: 'API routes may not import worker implementation modules',
    from: (file) => file.startsWith('server/src/api/'),
    forbidden: (target) => target.startsWith('server/src/worker/'),
    ignoreTypeOnly: true,
  },
  {
    id: 'server-api-runtime-repositories',
    description: 'API routes may not import repository modules directly; delegate data access through services',
    from: (file) => file.startsWith('server/src/api/'),
    forbidden: (target) => target.startsWith('server/src/repositories/'),
    ignoreTypeOnly: true,
  },
  {
    id: 'server-worker-runtime-api',
    description: 'workers may not import API route modules',
    from: (file) => file.startsWith('server/src/worker/'),
    forbidden: (target) => target.startsWith('server/src/api/'),
    ignoreTypeOnly: true,
  },
  {
    id: 'gateway-runtime-isolated',
    description: 'gateway runtime may only share through shared modules, not server or browser internals',
    from: (file) => file.startsWith('gateway/src/'),
    forbidden: (target) => target.startsWith('server/src/') || isBrowserRuntimePath(target),
    ignoreTypeOnly: true,
  },
  {
    id: 'browser-runtime-no-server-gateway',
    description: 'browser runtime may not import server or gateway internals',
    from: (file) => isBrowserRuntimePath(file),
    forbidden: (target) => target.startsWith('server/') || target.startsWith('gateway/'),
    ignoreTypeOnly: true,
  },
  {
    id: 'browser-api-runtime-no-ui-state',
    description: 'frontend API adapters may not import UI components, contexts, or hooks at runtime',
    from: (file) => file.startsWith('src/api/'),
    forbidden: (target) => (
      target.startsWith('components/') ||
      target.startsWith('contexts/') ||
      target.startsWith('hooks/')
    ),
    ignoreTypeOnly: true,
  },
  {
    id: 'shared-runtime-pure',
    description: 'shared modules may not import app-specific runtime layers',
    from: (file) => file.startsWith('shared/'),
    forbidden: (target) => target.startsWith('server/') || target.startsWith('gateway/') || isBrowserRuntimePath(target),
    ignoreTypeOnly: true,
  },
  {
    // Symbol-level rule: dispatchXxxNotification (services/notifications/dispatch.ts)
    // is the only public entry point for sending notifications. Direct imports of
    // notifyNewXxx (sync path) or queueXxx (queued path) hide the reliability
    // semantics behind the import — that's exactly the dual-path bug we just
    // fixed. Block the symbols, not the modules, because legitimate imports
    // (e.g. Redis from infrastructure barrel) share the same files.
    id: 'server-notification-dispatch-only',
    description:
      'callers must use dispatchXxxNotification from services/notifications/dispatch — direct imports of notifyNewXxx or queueXxx hide reliability semantics',
    from: (file) =>
      file.startsWith('server/src/') &&
      !file.startsWith('server/src/services/notifications/') &&
      !file.startsWith('server/src/infrastructure/') &&
      !file.startsWith('server/src/worker/'),
    // Symbol rule: a violation requires BOTH a forbidden target AND a
    // forbidden symbol — same-named functions in unrelated modules don't
    // count (e.g. services/telegram/notifications.notifyNewTransactions
    // is the channel implementation, not the orchestrator).
    forbidden: (target) =>
      target === 'server/src/services/notifications/notificationService.ts' ||
      target === 'server/src/infrastructure/notificationDispatcher.ts' ||
      target === 'server/src/infrastructure/index.ts',
    forbiddenSymbols: new Set([
      'notifyNewTransactions',
      'notifyNewDraft',
      'queueTransactionNotification',
      'queueDraftNotification',
    ]),
    ignoreTypeOnly: true,
  },
];

const exceptions = loadExceptions();
const usedExceptions = new Set();
const files = sourceRoots.flatMap((sourceRoot) => walk(sourceRoot));
const violations = [];
let importCount = 0;

function exceptionKey(exception) {
  return [
    exception.rule,
    exception.file,
    exception.target,
    exception.specifier ?? '*',
  ].join('\u0000');
}

function matchingException(violation) {
  return exceptions.find((exception) => (
    exception.rule === violation.rule.id &&
    exception.file === violation.file &&
    exception.target === violation.target &&
    (exception.specifier === undefined || exception.specifier === violation.specifier)
  ));
}

for (const file of files) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const imports = collectImportStatements(source);
  importCount += imports.length;

  for (const imported of imports) {
    const target = resolveRelativeImport(file, imported.specifier);
    if (!target) {
      continue;
    }

    for (const rule of rules) {
      if (!rule.from(file)) {
        continue;
      }
      if (rule.ignoreTypeOnly && imported.typeOnly) {
        continue;
      }

      // Symbol-level rules (forbiddenSymbols) require BOTH a target match
      // and a forbidden symbol — same-named functions in unrelated modules
      // don't count. Each forbidden symbol becomes its own violation.
      if (rule.forbiddenSymbols) {
        if (!rule.forbidden(target)) continue;
        for (const symbol of imported.symbols) {
          if (!rule.forbiddenSymbols.has(symbol)) continue;
          const violation = {
            rule,
            file,
            target,
            specifier: `${imported.specifier} :: ${symbol}`,
            dynamic: imported.dynamic,
          };
          const exception = matchingException(violation);
          if (exception) {
            usedExceptions.add(exceptionKey(exception));
            continue;
          }
          violations.push(violation);
        }
        continue;
      }

      // File-level rules (forbidden(target)) match on the resolved file path.
      if (rule.forbidden(target)) {
        const violation = {
          rule,
          file,
          target,
          specifier: imported.specifier,
          dynamic: imported.dynamic,
        };
        const exception = matchingException(violation);
        if (exception) {
          usedExceptions.add(exceptionKey(exception));
          continue;
        }
        violations.push(violation);
      }
    }
  }
}

const staleExceptions = exceptions.filter((exception) => !usedExceptions.has(exceptionKey(exception)));

if (violations.length > 0 || staleExceptions.length > 0) {
  console.error('architecture-boundaries: failed');
  for (const violation of violations) {
    const importKind = violation.dynamic ? 'dynamic import' : 'import';
    console.error(
      `architecture-boundaries: ${violation.rule.id}: ${violation.file} ${importKind} ${violation.specifier} -> ${violation.target}`
    );
    console.error(`architecture-boundaries:   ${violation.rule.description}`);
  }
  for (const exception of staleExceptions) {
    console.error(
      `architecture-boundaries: stale exception: ${exception.rule}: ${exception.file} -> ${exception.target}`
    );
  }
  process.exit(1);
}

console.log(
  `architecture-boundaries: passed (${files.length} files, ${importCount} imports scanned, ${rules.length} rules, ${exceptions.length} exceptions)`
);
