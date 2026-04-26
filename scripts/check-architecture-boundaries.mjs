#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { collectImportStatements } from './quality/import-parser.mjs';

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

const notificationDispatchCallerExclusions = [
  'server/src/services/notifications/',
  'server/src/infrastructure/',
  'server/src/worker/',
];

const notificationDispatchTargets = new Set([
  'server/src/services/notifications/notificationService.ts',
  'server/src/infrastructure/notificationDispatcher.ts',
  'server/src/infrastructure/index.ts',
]);

const notificationDispatchSymbols = new Set([
  'notifyNewTransactions',
  'notifyNewDraft',
  'queueTransactionNotification',
  'queueDraftNotification',
]);

function isNotificationDispatchCaller(file) {
  return (
    file.startsWith('server/src/') &&
    !notificationDispatchCallerExclusions.some((prefix) => file.startsWith(prefix))
  );
}

function isNotificationDispatchTarget(target) {
  return notificationDispatchTargets.has(target);
}

function isServerRepositoryPath(file) {
  return file.startsWith('server/src/repositories/');
}

function isServerRuntimeDependency(target) {
  return (
    target.startsWith('server/src/services/') ||
    target.startsWith('server/src/api/') ||
    target.startsWith('server/src/worker/') ||
    target.startsWith('server/src/jobs/') ||
    target.startsWith('server/src/websocket/')
  );
}

function isServerServicePath(file) {
  return file.startsWith('server/src/services/');
}

function isServerApiPath(file) {
  return file.startsWith('server/src/api/');
}

function isServerWorkerPath(file) {
  return file.startsWith('server/src/worker/');
}

function isServerApiTarget(target) {
  return target.startsWith('server/src/api/');
}

function isServerWorkerTarget(target) {
  return target.startsWith('server/src/worker/');
}

function isServerRepositoryTarget(target) {
  return target.startsWith('server/src/repositories/');
}

function isGatewayRuntimePath(file) {
  return file.startsWith('gateway/src/');
}

function isGatewayForbiddenRuntimeTarget(target) {
  return target.startsWith('server/src/') || isBrowserRuntimePath(target);
}

function isBrowserForbiddenRuntimeTarget(target) {
  return target.startsWith('server/') || target.startsWith('gateway/');
}

function isBrowserApiAdapter(file) {
  return file.startsWith('src/api/');
}

function isBrowserApiStateTarget(target) {
  return (
    target.startsWith('components/') ||
    target.startsWith('contexts/') ||
    target.startsWith('hooks/')
  );
}

function isSharedModulePath(file) {
  return file.startsWith('shared/');
}

function isSharedForbiddenRuntimeTarget(target) {
  return target.startsWith('server/') || target.startsWith('gateway/') || isBrowserRuntimePath(target);
}

const rules = [
  {
    id: 'server-repositories-runtime-upward',
    description: 'repositories may not import runtime services, API routes, workers, jobs, or websocket modules',
    from: isServerRepositoryPath,
    forbidden: isServerRuntimeDependency,
    ignoreTypeOnly: true,
  },
  {
    id: 'server-services-runtime-api',
    description: 'services may not import runtime API route modules',
    from: isServerServicePath,
    forbidden: isServerApiTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'server-api-runtime-worker',
    description: 'API routes may not import worker implementation modules',
    from: isServerApiPath,
    forbidden: isServerWorkerTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'server-api-runtime-repositories',
    description: 'API routes may not import repository modules directly; delegate data access through services',
    from: isServerApiPath,
    forbidden: isServerRepositoryTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'server-worker-runtime-api',
    description: 'workers may not import API route modules',
    from: isServerWorkerPath,
    forbidden: isServerApiTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'gateway-runtime-isolated',
    description: 'gateway runtime may only share through shared modules, not server or browser internals',
    from: isGatewayRuntimePath,
    forbidden: isGatewayForbiddenRuntimeTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'browser-runtime-no-server-gateway',
    description: 'browser runtime may not import server or gateway internals',
    from: isBrowserRuntimePath,
    forbidden: isBrowserForbiddenRuntimeTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'browser-api-runtime-no-ui-state',
    description: 'frontend API adapters may not import UI components, contexts, or hooks at runtime',
    from: isBrowserApiAdapter,
    forbidden: isBrowserApiStateTarget,
    ignoreTypeOnly: true,
  },
  {
    id: 'shared-runtime-pure',
    description: 'shared modules may not import app-specific runtime layers',
    from: isSharedModulePath,
    forbidden: isSharedForbiddenRuntimeTarget,
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
    from: isNotificationDispatchCaller,
    // Symbol rule: a violation requires BOTH a forbidden target AND a
    // forbidden symbol — same-named functions in unrelated modules don't
    // count (e.g. services/telegram/notifications.notifyNewTransactions
    // is the channel implementation, not the orchestrator).
    forbidden: isNotificationDispatchTarget,
    forbiddenSymbols: notificationDispatchSymbols,
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
