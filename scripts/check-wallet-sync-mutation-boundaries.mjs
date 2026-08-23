#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const INVENTORY_PATH = 'config/wallet-sync-mutation-boundaries.json';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const PRISMA_MODULE_PATTERN = /(?:^|\/)(?:models\/prisma|generated\/prisma\/client)$|^@prisma\/client$/;

const normalize = value => value.split(path.sep).join('/');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireObject(value, context) {
  if (!isObject(value)) throw new Error(`${context} must be an object`);
  return value;
}

function requireString(value, context) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function requireArray(value, context) {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function assertSortedUnique(values, context) {
  const canonical = [...new Set(values)].sort();
  if (JSON.stringify(values) !== JSON.stringify(canonical)) {
    throw new Error(`${context} must be sorted and contain no duplicates`);
  }
}

function requireArgumentIndex(value, context) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
}

function validateMutationCallsite(item, context) {
  const units = requireArray(item.mutationUnits, `${context}.mutationUnits`)
    .map((unit, unitIndex) => requireString(unit, `${context}.mutationUnits[${unitIndex}]`));
  assertSortedUnique(units, `${context}.mutationUnits`);
  if (units.length === 0) throw new Error(`${context}.mutationUnits must not be empty`);
  requireArgumentIndex(item.transactionClientArgument, `${context}.transactionClientArgument`);
}

function validateFencedLifecycleCallsite(item, context, repository, method) {
  requireArgumentIndex(item.fenceArgument, `${context}.fenceArgument`);
  if ('mutationUnits' in item || 'transactionClientArgument' in item) {
    throw new Error(`fenced lifecycle callsite ${repository}.${method} must not declare mutation metadata`);
  }
}

function validateReadCallsite(item, repository, method) {
  if ('mutationUnits' in item || 'transactionClientArgument' in item || 'fenceArgument' in item) {
    throw new Error(`read callsite ${repository}.${method} must not declare mutation metadata`);
  }
}

function validateCallsite(entry, index) {
  const context = `inventory.callsites[${index}]`;
  const item = requireObject(entry, context);
  const file = requireString(item.file, `${context}.file`);
  const enclosingFunction = requireString(item.enclosingFunction, `${context}.enclosingFunction`);
  const repository = requireString(item.repository, `${context}.repository`);
  const method = requireString(item.method, `${context}.method`);
  if (!['read', 'mutation', 'fenced_lifecycle'].includes(item.kind)) {
    throw new Error(`${context}.kind must be read, mutation, or fenced_lifecycle`);
  }
  if (!Number.isSafeInteger(item.count) || item.count < 1) {
    throw new Error(`${context}.count must be a positive safe integer`);
  }
  if (item.kind === 'mutation') validateMutationCallsite(item, context);
  if (item.kind === 'fenced_lifecycle') {
    validateFencedLifecycleCallsite(item, context, repository, method);
  }
  if (item.kind === 'read') validateReadCallsite(item, repository, method);
  return [file, enclosingFunction, repository, method].join('\0');
}

function validateCallsites(value) {
  const identities = requireArray(value, 'inventory.callsites').map(validateCallsite);
  if (new Set(identities).size !== identities.length) {
    throw new Error('inventory.callsites identities must be unique');
  }
  return value;
}

export function parseWalletSyncMutationBoundaryInventory(source) {
  const inventory = requireObject(JSON.parse(source), 'inventory');
  if (inventory.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const scopes = requireArray(inventory.canonicalScopes, 'inventory.canonicalScopes')
    .map((value, index) => requireString(value, `inventory.canonicalScopes[${index}]`));
  assertSortedUnique(scopes, 'inventory.canonicalScopes');

  const architecture = requireObject(inventory.architecture, 'inventory.architecture');
  const fence = requireObject(architecture.fence, 'inventory.architecture.fence');
  requireString(fence.file, 'inventory.architecture.fence.file');
  requireString(fence.symbol, 'inventory.architecture.fence.symbol');
  const fields = requireArray(fence.readonlyFields, 'inventory.architecture.fence.readonlyFields')
    .map((value, index) => requireString(value, `inventory.architecture.fence.readonlyFields[${index}]`));
  if (JSON.stringify(fields) !== JSON.stringify(['generation', 'leaseToken', 'walletId'])) {
    throw new Error('inventory.architecture.fence.readonlyFields must be generation, leaseToken, walletId');
  }
  const boundary = requireObject(architecture.boundary, 'inventory.architecture.boundary');
  requireString(boundary.file, 'inventory.architecture.boundary.file');
  requireString(boundary.symbol, 'inventory.architecture.boundary.symbol');
  const contextProperties = requireArray(
    boundary.requiredContextProperties,
    'inventory.architecture.boundary.requiredContextProperties',
  ).map((value, index) => requireString(
    value,
    `inventory.architecture.boundary.requiredContextProperties[${index}]`,
  ));
  if (JSON.stringify(contextProperties) !== JSON.stringify(['mutationFence', 'walletId'])) {
    throw new Error('boundary required context properties must be mutationFence and walletId');
  }
  const parameters = requireArray(
    boundary.callbackParameters,
    'inventory.architecture.boundary.callbackParameters',
  );
  if (JSON.stringify(parameters) !== JSON.stringify(['tx', 'deferPostCommit'])) {
    throw new Error('boundary callback parameters must be tx and deferPostCommit');
  }

  const units = requireArray(inventory.approvedMutationUnits, 'inventory.approvedMutationUnits')
    .map((value, index) => requireString(value, `inventory.approvedMutationUnits[${index}]`));
  assertSortedUnique(units, 'inventory.approvedMutationUnits');
  validateCallsites(inventory.callsites);
  const callsiteUnits = new Set(
    inventory.callsites
      .filter(entry => entry.kind === 'mutation')
      .flatMap(entry => entry.mutationUnits),
  );
  for (const unit of callsiteUnits) {
    if (!units.includes(unit)) throw new Error(`mutation callsite uses unapproved unit ${unit}`);
  }
  return inventory;
}

function walk(root, relativePath, files = []) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) return files;
  const stats = statSync(absolute);
  if (stats.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(relativePath))) files.push(normalize(relativePath));
    return files;
  }
  for (const entry of readdirSync(absolute).sort()) walk(root, path.join(relativePath, entry), files);
  return files;
}

function matchesScope(file, scope) {
  return scope.endsWith('/**') ? file.startsWith(scope.slice(0, -2)) : file === scope;
}

function sourceFiles(root, scopes) {
  const roots = new Set(scopes.map(scope => scope.endsWith('/**') ? scope.slice(0, -3) : scope));
  return [...new Set([...roots].flatMap(relativePath => walk(root, relativePath)))]
    .filter(file => scopes.some(scope => matchesScope(file, scope)))
    .sort();
}

function parseSource(root, file) {
  const source = readFileSync(path.join(root, file), 'utf8');
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function functionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return current.parent.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
  }
  return '<module>';
}

function enclosingNamedFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return { name: current.name.text, node: current };
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return { name: current.parent.name.text, node: current };
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return { name: current.name.text, node: current };
    }
  }
  return undefined;
}

function repositoryBindings(sourceFile) {
  const bindings = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/(?:^|\/)repositories(?:\/|$)/.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported.endsWith('Repository')) bindings.set(element.name.text, imported);
    }
  }
  return bindings;
}

function repositoryCall(node, bindings) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const receiver = node.expression.expression;
  if (!ts.isIdentifier(receiver)) return undefined;
  const repository = bindings.get(receiver.text)
    ?? (receiver.text.endsWith('Repository') ? receiver.text : undefined);
  return repository ? { repository, method: node.expression.name.text } : undefined;
}

function callIdentity(call) {
  return [call.file, call.enclosingFunction, call.repository, call.method].join('\0');
}

function collectRepositoryCalls(files) {
  const calls = [];
  for (const [file, sourceFile] of files) {
    const bindings = repositoryBindings(sourceFile);
    const visit = node => {
      const repository = repositoryCall(node, bindings);
      if (repository) {
        calls.push({ file, enclosingFunction: functionName(node), node, ...repository });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return calls;
}

function repositoryImportClause(statement) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return undefined;
  }
  if (!/(?:^|\/)repositories(?:\/|$)/.test(statement.moduleSpecifier.text)) return undefined;
  return statement.importClause;
}
function validateNamedRepositoryImports(file, clause, boundaryFile) {
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return [];
  return clause.namedBindings.elements.flatMap(element => {
    if (element.isTypeOnly) return [];
    const imported = element.propertyName?.text ?? element.name.text;
    return !imported.endsWith('Repository') && file !== boundaryFile
      ? [`${file}: direct repository function import ${imported} bypasses the mutation inventory`]
      : [];
  });
}
function validateRepositoryImportStatement(file, statement, boundaryFile) {
  const clause = repositoryImportClause(statement);
  if (!clause || clause.isTypeOnly) return [];
  const errors = [];
  if (clause.name && file !== boundaryFile) {
    errors.push(`${file}: default repository imports are forbidden`);
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    errors.push(`${file}: namespace repository imports are forbidden`);
    return errors;
  }
  errors.push(...validateNamedRepositoryImports(file, clause, boundaryFile));
  return errors;
}
function repositoryBindingUseIsAllowed(node) {
  if (ts.isImportSpecifier(node.parent)) return true;
  if (findAncestor(node, ts.isTypeQueryNode)) return true;
  if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node) return false;
  return ts.isCallExpression(node.parent.parent) && node.parent.parent.expression === node.parent;
}
function validateRepositoryBindingUses(file, sourceFile, bindings) {
  const errors = [];
  const visit = node => {
    if (
      ts.isIdentifier(node)
      && bindings.has(node.text)
      && !repositoryBindingUseIsAllowed(node)
    ) {
      errors.push(`${file}: repository binding ${node.text} may only be used as a direct method receiver`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return errors;
}
function validateRepositoryImports(files, boundary) {
  const errors = [];
  for (const [file, sourceFile] of files) {
    for (const statement of sourceFile.statements) {
      errors.push(...validateRepositoryImportStatement(file, statement, boundary.file));
    }
    errors.push(...validateRepositoryBindingUses(file, sourceFile, repositoryBindings(sourceFile)));
  }
  return errors;
}

function namedFunctionDefinition(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && ts.isVariableDeclaration(node.parent)
    && ts.isIdentifier(node.parent.name)
  ) return node.parent.name.text;
  return undefined;
}

function recordFunctionDefinition(definitions, definitionsByFile, file, name, node) {
  const entry = { file, name, node };
  const entries = definitions.get(name) ?? [];
  entries.push(entry);
  definitions.set(name, entries);
  const fileDefinitions = definitionsByFile.get(file) ?? new Map();
  const namedDefinitions = fileDefinitions.get(name) ?? [];
  namedDefinitions.push(entry);
  fileDefinitions.set(name, namedDefinitions);
  definitionsByFile.set(file, fileDefinitions);
}

function recordFunctionCall(calls, file, node) {
  const entries = calls.get(node.expression.text) ?? [];
  entries.push({ file, node });
  calls.set(node.expression.text, entries);
}

function storeImportedHelperBinding(file, name, binding, helpers, namespaces) {
  const key = `${file}\0${name}`;
  if (binding?.namespace && !namespaces.has(key)) {
    namespaces.set(key, binding.file);
    return true;
  }
  if (binding && !binding.namespace && !helpers.has(key)) {
    helpers.set(key, binding);
    return true;
  }
  return false;
}

function storeDestructuredHelperBindings(file, pattern, binding, helpers) {
  if (!binding?.namespace || !ts.isObjectBindingPattern(pattern)) return false;
  let changed = false;
  for (const element of pattern.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const importedName = element.propertyName?.getText() ?? element.name.text;
    const key = `${file}\0${element.name.text}`;
    if (!helpers.has(key)) {
      helpers.set(key, { file: binding.file, name: importedName });
      changed = true;
    }
  }
  return changed;
}

function propagateHelperNode(file, node, resolve, helpers, namespaces) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const binding = resolve(file, node.initializer);
    if (ts.isIdentifier(node.name)) {
      return storeImportedHelperBinding(file, node.name.text, binding, helpers, namespaces);
    }
    return storeDestructuredHelperBindings(file, node.name, binding, helpers);
  }
  if (!ts.isBinaryExpression(node)
    || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || !ts.isIdentifier(node.left)) return false;
  return storeImportedHelperBinding(
    file,
    node.left.text,
    resolve(file, node.right),
    helpers,
    namespaces,
  );
}

function collectFunctionGraph(files, callFiles = new Set(files.keys())) {
  const definitions = new Map();
  const definitionsByFile = new Map();
  const calls = new Map();
  for (const [file, sourceFile] of files) {
    const visit = node => {
      const definition = namedFunctionDefinition(node);
      if (definition) recordFunctionDefinition(
        definitions,
        definitionsByFile,
        file,
        definition,
        node,
      );
      if (callFiles.has(file) && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        recordFunctionCall(calls, file, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const importedHelpers = new Map();
  const importedNamespaces = new Map();
  const resolveImportFile = (file, specifier) => {
    if (!specifier.startsWith('.')) return undefined;
    const base = normalize(path.join(path.dirname(file), specifier));
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
      .find(candidate => files.has(candidate));
  };
  for (const [file, sourceFile] of files) {
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const targetFile = resolveImportFile(file, statement.moduleSpecifier.text);
      const bindings = statement.importClause?.namedBindings;
      if (!targetFile) continue;
      if (statement.importClause?.name) {
        importedHelpers.set(`${file}\0${statement.importClause.name.text}`, {
          file: targetFile,
          name: null,
        });
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        importedNamespaces.set(`${file}\0${bindings.name.text}`, targetFile);
        continue;
      }
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        importedHelpers.set(`${file}\0${element.name.text}`, {
          file: targetFile,
          name: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
  const unwrapHelperExpression = node => {
    let current = node;
    while (current && (
      ts.isAwaitExpression(current)
      || ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isNonNullExpression(current)
    )) current = current.expression;
    return current;
  };
  const resolveHelperBinding = (file, expression) => {
    const current = unwrapHelperExpression(expression);
    if (!current) return undefined;
    if (ts.isIdentifier(current)) {
      return importedHelpers.get(`${file}\0${current.text}`)
        ?? (importedNamespaces.has(`${file}\0${current.text}`)
          ? { file: importedNamespaces.get(`${file}\0${current.text}`), namespace: true }
          : undefined);
    }
    if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = current.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) return undefined;
      const targetFile = resolveImportFile(file, specifier.text);
      return targetFile ? { file: targetFile, namespace: true } : undefined;
    }
    if (!ts.isPropertyAccessExpression(current)) return undefined;
    const receiver = resolveHelperBinding(file, current.expression);
    if (!receiver?.namespace) return undefined;
    return { file: receiver.file, name: current.name.text };
  };
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (const [file, sourceFile] of files) {
      const visit = node => {
        changed = propagateHelperNode(
          file,
          node,
          resolveHelperBinding,
          importedHelpers,
          importedNamespaces,
        ) || changed;
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    if (!changed) break;
  }
  return {
    definitions,
    definitionsByFile,
    calls,
    importedHelpers,
    importedNamespaces,
    repositoryBindingsByFile: new Map(
      [...files].map(([file, sourceFile]) => [file, repositoryBindings(sourceFile)]),
    ),
    externalStaticErrorsByFile: new Map([...files].map(([file, sourceFile]) => [
      file,
      [
        ...sourceFile.statements.flatMap(statement => (
          validateRepositoryImportStatement(file, statement, '')
        )),
        ...validateDirectPrismaAccess(new Map([[file, sourceFile]])),
      ],
    ])),
  };
}

function findAncestor(node, predicate) {
  for (let current = node.parent; current; current = current.parent) {
    if (predicate(current)) return current;
  }
  return undefined;
}

function runnerFor(node, boundarySymbol) {
  return findAncestor(node, current => {
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) return false;
    const parent = current.parent;
    return ts.isCallExpression(parent)
      && ts.isIdentifier(parent.expression)
      && parent.expression.text === boundarySymbol
      && parent.arguments[2] === current;
  });
}

function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function runnerUnit(node, boundary) {
  const callback = runnerFor(node, boundary.symbol);
  return callback ? literalText(callback.parent.arguments[1]) : undefined;
}

function traceMutationFunction(definition, expected, boundary, graph, seen = new Set()) {
  const key = `${definition.file}\0${definition.name}`;
  if (seen.has(key)) return { errors: [], nodes: [], reachedUnits: new Set() };
  const nextSeen = new Set(seen).add(key);
  const txIndex = definition.node.parameters.findIndex(parameter => parameter.name.getText() === 'tx');
  if (txIndex < 0) {
    return {
      errors: [`${definition.file}: mutation helper ${definition.name} must declare explicit tx`],
      nodes: [],
      reachedUnits: new Set(),
    };
  }
  const callers = graph.calls.get(definition.name) ?? [];
  const errors = [];
  const nodes = [definition.node];
  const reachedUnits = new Set();
  for (const caller of callers) {
    const argument = caller.node.arguments[txIndex];
    if (!argument || !ts.isIdentifier(argument) || argument.text !== 'tx') {
      continue;
    }
    const unit = runnerUnit(caller.node, boundary);
    if (unit !== undefined) {
      if (!expected.mutationUnits.includes(unit)) {
        errors.push(
          `${caller.file}: ${definition.name} reached from mutation unit ${unit}, expected one of `
          + expected.mutationUnits.join(', '),
        );
      }
      reachedUnits.add(unit);
      continue;
    }
    const owner = enclosingNamedFunction(caller.node);
    if (!owner) {
      errors.push(`${caller.file}: ${definition.name} is callable outside ${boundary.symbol}`);
      continue;
    }
    const ownerDefinitions = graph.definitionsByFile.get(caller.file)?.get(owner.name) ?? [];
    if (ownerDefinitions.length !== 1 || ownerDefinitions[0].node !== owner.node) {
      errors.push(`${caller.file}: mutation helper ${owner.name} is ambiguous`);
      continue;
    }
    const traced = traceMutationFunction(ownerDefinitions[0], expected, boundary, graph, nextSeen);
    errors.push(...traced.errors);
    nodes.push(...traced.nodes);
    for (const reached of traced.reachedUnits) reachedUnits.add(reached);
  }
  return { errors, nodes, reachedUnits };
}

function validateMutationCall(call, expected, boundary, graph) {
  const errors = [];
  const runnerCallback = runnerFor(call.node, boundary.symbol);
  if (runnerCallback) {
    const runnerCall = runnerCallback.parent;
    const unit = literalText(runnerCall.arguments[1]);
    if (!expected.mutationUnits.includes(unit)) {
      errors.push(
        `${call.file}: ${call.repository}.${call.method} expected mutation unit `
        + `${expected.mutationUnits.join(' or ')}, found ${unit ?? 'a non-literal unit'}`,
      );
    }
  } else {
    const owner = enclosingNamedFunction(call.node);
    const definitions = owner
      ? graph.definitionsByFile.get(call.file)?.get(owner.name) ?? []
      : [];
    const definition = definitions.find(candidate => candidate.node === owner?.node);
    if (!definition) {
      errors.push(`${call.file}: ${call.repository}.${call.method} is outside ${boundary.symbol}`);
    } else {
      const traced = traceMutationFunction(definition, expected, boundary, graph);
      errors.push(...traced.errors);
      for (const unit of expected.mutationUnits) {
        if (!traced.reachedUnits.has(unit)) {
          errors.push(
            `${call.file}: ${call.repository}.${call.method} has no explicit tx path from unit ${unit}`,
          );
        }
      }
    }
  }
  const argument = call.node.arguments[expected.transactionClientArgument];
  if (!argument || !ts.isIdentifier(argument) || argument.text !== 'tx') {
    errors.push(
      `${call.file}: ${call.repository}.${call.method} argument `
      + `${expected.transactionClientArgument + 1} must be the explicit tx client`,
    );
  }
  return errors;
}

function validateFencedLifecycleCall(call, expected) {
  const argument = call.node.arguments[expected.fenceArgument];
  return argument && ts.isIdentifier(argument) && argument.text === 'fence'
    ? []
    : [
      `${call.file}: ${call.repository}.${call.method} argument `
      + `${expected.fenceArgument + 1} must be the explicit immutable fence`,
    ];
}

function isWithinDeferredEffect(node, runnerCallback) {
  for (let current = node.parent; current && current !== runnerCallback; current = current.parent) {
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isCallExpression(current.parent)
      && ts.isIdentifier(current.parent.expression)
      && current.parent.expression.text === 'deferPostCommit'
      && current.parent.arguments[0] === current
    ) return true;
  }
  const effectFunction = findAncestor(node, current => (
    (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
    && ts.isVariableDeclaration(current.parent)
    && ts.isIdentifier(current.parent.name)
  ));
  if (effectFunction && ts.isVariableDeclaration(effectFunction.parent)) {
    const effectName = effectFunction.parent.name.getText();
    let found = false;
    const visit = current => {
      if (
        ts.isCallExpression(current)
        && ts.isIdentifier(current.expression)
        && current.expression.text === 'deferPostCommit'
        && current.arguments.some(argument => (
          ts.isIdentifier(argument) && argument.text === effectName
        ))
      ) found = true;
      ts.forEachChild(current, visit);
    };
    visit(runnerCallback.body);
    if (found) return true;
  }
  return false;
}

function isLegacyDeferredFallback(node, name, callback) {
  for (let current = node.parent; current && current !== callback; current = current.parent) {
    if (!ts.isIfStatement(current) || !current.elseStatement) continue;
    if (current.expression.getText() !== 'deferPostCommit') continue;
    if (node.pos < current.elseStatement.pos || node.end > current.elseStatement.end) continue;
    let deferred = false;
    const visit = child => {
      if (
        ts.isCallExpression(child)
        && ts.isIdentifier(child.expression)
        && child.expression.text === 'deferPostCommit'
        && child.arguments.some(argument => ts.isIdentifier(argument) && argument.text === name)
      ) deferred = true;
      ts.forEachChild(child, visit);
    };
    visit(current.thenStatement);
    if (deferred) return true;
  }
  return false;
}

function isLegacyOnlyEffect(node, callback) {
  if (!callback.parameters.some(parameter => parameter.name.getText() === 'tx')) return false;
  if (!ts.isBlock(callback.body)) return false;
  return callback.body.statements.some(statement => {
    if (!ts.isIfStatement(statement) || statement.end >= node.pos) return false;
    if (statement.expression.getText() !== 'tx') return false;
    let returns = false;
    const visit = current => {
      if (ts.isReturnStatement(current)) returns = true;
      ts.forEachChild(current, visit);
    };
    visit(statement.thenStatement);
    return returns;
  });
}

function validateRunnerCallbacks(files, boundary, approvedUnits, graph) {
  const errors = [];
  const actualUnits = new Set();
  for (const [file, sourceFile] of files) {
    const visit = node => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === boundary.symbol
      ) {
        if (!provesWalletBoundContext(node.arguments[0], boundary.requiredContextProperties)) {
          errors.push(
            `${file}: ${boundary.symbol} first argument must prove walletId and mutationFence`,
          );
        }
        const unit = literalText(node.arguments[1]);
        if (!unit || !approvedUnits.includes(unit)) {
          errors.push(`${file}: ${boundary.symbol} uses unapproved or non-literal unit ${unit ?? '<dynamic>'}`);
        } else {
          actualUnits.add(unit);
        }
        const callback = node.arguments[2];
        if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
          errors.push(`${file}: ${boundary.symbol} requires an inline callback`);
        } else {
          const parameterNames = callback.parameters.map(parameter => parameter.name.getText());
          const validParameters = parameterNames.length >= 1
            && parameterNames.length <= boundary.callbackParameters.length
            && parameterNames.every((name, index) => name === boundary.callbackParameters[index]);
          if (!validParameters) {
            errors.push(`${file}: ${boundary.symbol} callback parameters must begin with tx, deferPostCommit`);
          }
          inspectCallback(file, callback, errors, graph);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (const unit of approvedUnits) {
    if (!actualUnits.has(unit)) errors.push(`approved mutation unit ${unit} has no canonical runner callsite`);
  }
  return errors;
}

function unquotePropertyName(name) {
  const first = name.at(0);
  const last = name.at(-1);
  return name.length >= 2 && first === last && (first === "'" || first === '"')
    ? name.slice(1, -1)
    : name;
}
function contextPropertyName(property) {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
    return unquotePropertyName(property.name.getText());
  }
  return undefined;
}
function provesWalletBoundContext(node, requiredProperties) {
  if (!node) return false;
  if (ts.isIdentifier(node)) return node.text === 'ctx';
  if (!ts.isObjectLiteralExpression(node)) return false;
  const properties = new Set(node.properties.map(contextPropertyName).filter(Boolean));
  return requiredProperties.every(property => properties.has(property));
}

function pickedPropertyNames(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return [];
  if (typeNode.typeName.getText() !== 'Pick' || typeNode.typeArguments?.length !== 2) return [];
  const names = [];
  const visit = node => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      names.push(node.literal.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(typeNode.typeArguments[1]);
  return names;
}

function literalTypePropertyNames(typeNode) {
  if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return [];
  return typeNode.members
    .filter(ts.isPropertySignature)
    .map(member => member.name.getText().replace(/^['"]|['"]$/g, ''));
}

function validateBoundarySignature(root, boundary) {
  const absolute = path.join(root, boundary.file);
  if (!existsSync(absolute)) return [`missing boundary file: ${boundary.file}`];
  const sourceFile = parseSource(root, boundary.file);
  let declaration;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === boundary.symbol) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!declaration) return [`${boundary.file}: missing ${boundary.symbol}`];
  const contextType = declaration.parameters[0]?.type;
  const properties = new Set([
    ...pickedPropertyNames(contextType),
    ...literalTypePropertyNames(contextType),
  ]);
  const missing = boundary.requiredContextProperties.filter(property => !properties.has(property));
  const errors = missing.length === 0
    ? []
    : [
      `${boundary.file}: ${boundary.symbol} context type must include `
      + boundary.requiredContextProperties.join(' and '),
    ];
  let rejectsMismatch = false;
  const inspectAuthorityCheck = node => {
    if (
      ts.isBinaryExpression(node)
      && [ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
        .includes(node.operatorToken.kind)
    ) {
      const operands = new Set([node.left.getText(), node.right.getText()]);
      const comparesWallet = operands.has('ctx.walletId')
        && operands.has('ctx.mutationFence.walletId');
      const owner = findAncestor(node, ts.isIfStatement);
      if (comparesWallet && owner) {
        const findThrow = current => {
          if (ts.isThrowStatement(current)) rejectsMismatch = true;
          ts.forEachChild(current, findThrow);
        };
        findThrow(owner.thenStatement);
      }
    }
    ts.forEachChild(node, inspectAuthorityCheck);
  };
  if (declaration.body) inspectAuthorityCheck(declaration.body);
  if (!rejectsMismatch) {
    errors.push(
      `${boundary.file}: ${boundary.symbol} must reject a fence walletId that differs from ctx.walletId`,
    );
  }
  return errors;
}

function isMutationNetworkCall(text) {
  return /^(?:getNodeClient|getBlockHeight|getElectrumPool)$/.test(text)
    || /(?:^|\.)client\./.test(text);
}
function isCommitSensitiveEffect(text) {
  return text === 'walletLog' || /^(?:log|logger)\./.test(text);
}

function inspectExternalRepositoryCall(file, node, errors, graph) {
  const repository = repositoryCall(node, graph.repositoryBindingsByFile.get(file) ?? new Map());
  if (repository && !graph.canonicalFiles.has(file)) {
    errors.push(
      `${file}: imported mutation helper reaches uninventoried repository call `
      + `${repository.repository}.${repository.method}`,
    );
  }
}

function inspectForbiddenMutationCall(file, node, callback, errors) {
  const text = node.expression.getText();
  if (/\$transaction$/.test(text)) {
    errors.push(`${file}: nested transaction inside runWalletSyncMutation is forbidden`);
  }
  if (isMutationNetworkCall(text)) {
    errors.push(`${file}: network work inside runWalletSyncMutation is forbidden (${text})`);
  }
  if (
    isCommitSensitiveEffect(text)
    && !isWithinDeferredEffect(node, callback)
    && !isLegacyOnlyEffect(node, callback)
  ) {
    errors.push(`${file}: ${text} must be buffered with deferPostCommit`);
  }
}

function inspectIdentifierHelper(node, callback, inspectHelper) {
  if (
    ts.isIdentifier(node.expression)
    && node.expression.text !== 'deferPostCommit'
    && !isWithinDeferredEffect(node, callback)
    && !isLegacyDeferredFallback(node, node.expression.text, callback)
  ) {
    inspectHelper(node.expression.text, node);
  }
}

function inspectImportedPropertyHelper(file, node, errors, inspectHelper, graph) {
  if (!ts.isPropertyAccessExpression(node.expression)) return;
  let receiver = node.expression.expression;
  while (
    ts.isAwaitExpression(receiver)
    || ts.isParenthesizedExpression(receiver)
    || ts.isAsExpression(receiver)
    || ts.isNonNullExpression(receiver)
  ) receiver = receiver.expression;
  if (ts.isIdentifier(receiver)) {
    const targetFile = graph.importedNamespaces.get(`${file}\0${receiver.text}`);
    if (targetFile) {
      const definitions = graph.definitionsByFile.get(targetFile)
        ?.get(node.expression.name.text) ?? [];
      inspectHelper(`${receiver.text}.${node.expression.name.text}`, node, definitions);
    }
  }
  if (/\bimport\s*\(/.test(receiver.getText())) {
    errors.push(`${file}: dynamic imported mutation helpers are forbidden`);
  }
}

function inspectMutationCall(file, node, callback, errors, inspectHelper, graph) {
  inspectExternalRepositoryCall(file, node, errors, graph);
  inspectForbiddenMutationCall(file, node, callback, errors);
  inspectIdentifierHelper(node, callback, inspectHelper);
  inspectImportedPropertyHelper(file, node, errors, inspectHelper, graph);
}

function inspectCallback(file, callback, errors, graph, active = new Set(), inspected = new Set()) {
  const resolveHelper = (name, callNode) => {
    const imported = graph.importedHelpers.get(`${file}\0${name}`);
    if (imported) {
      const importedDefinitions = graph.definitionsByFile.get(imported.file)?.get(imported.name) ?? [];
      return imported.name !== null && importedDefinitions.length === 1
        ? importedDefinitions[0]
        : null;
    }
    const definitions = graph.definitions.get(name);
    if (!definitions) return undefined;
    if (definitions.length === 1) return definitions[0];
    const local = definitions.filter(definition => definition.file === file);
    if (local.length === 1) return local[0];
    const callOwner = enclosingNamedFunction(callNode);
    const lexical = local.filter(definition => {
      const definitionOwner = enclosingNamedFunction(definition.node);
      return definitionOwner?.node === callOwner?.node;
    });
    return lexical.length === 1 ? lexical[0] : null;
  };
  const inspectHelper = (name, callNode, candidates) => {
    const definition = candidates
      ? (candidates.length === 1 ? candidates[0] : null)
      : resolveHelper(name, callNode);
    if (definition === undefined) return;
    if (definition === null) {
      errors.push(`${file}: mutation helper ${name} is ambiguous`);
      return;
    }
    const identity = `${definition.file}\0${definition.name}`;
    if (active.has(identity)) {
      errors.push(`${file}: recursive mutation helper cycle reaches ${name}`);
      return;
    }
    if (inspected.has(identity)) return;
    inspected.add(identity);
    if (!graph.canonicalFiles.has(definition.file)) {
      errors.push(...(graph.externalStaticErrorsByFile.get(definition.file) ?? []));
    }
    inspectCallback(
      definition.file,
      definition.node,
      errors,
      graph,
      new Set(active).add(identity),
      inspected,
    );
  };
  const visit = node => {
    if (ts.isCallExpression(node)) {
      inspectMutationCall(file, node, callback, errors, inspectHelper, graph);
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
}

function validateForbiddenArchitecture(files, boundary) {
  const errors = [];
  for (const [file, sourceFile] of files) {
    const visit = node => {
      if (ts.isIdentifier(node) && node.text === 'AsyncLocalStorage') {
        errors.push(`${file}: AsyncLocalStorage is forbidden in canonical sync code`);
      }
      if (
        file !== boundary.file
        && ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === '$transaction'
      ) errors.push(`${file}: direct transaction boundary is forbidden; use ${boundary.symbol}`);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return errors;
}

function propertyAccessRoot(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function isPrismaTransactionIdentifier(identifier) {
  const isTransactionType = node => {
    if (!node) return false;
    if (ts.isTypeReferenceNode(node)) return node.typeName.getText() === 'PrismaTxClient';
    if (ts.isUnionTypeNode(node)) return node.types.some(isTransactionType);
    if (ts.isParenthesizedTypeNode(node)) return isTransactionType(node.type);
    return false;
  };
  for (let current = identifier.parent; current; current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    const parameterIndex = current.parameters.findIndex(parameter => (
      ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text
    ));
    if (parameterIndex < 0) continue;
    const parameter = current.parameters[parameterIndex];
    if (isTransactionType(parameter.type)) return true;
    const parent = current.parent;
    return parameterIndex === 0
      && ts.isCallExpression(parent)
      && ts.isIdentifier(parent.expression)
      && parent.expression.text === 'runWalletSyncMutation'
      && parent.arguments[2] === current;
  }
  return false;
}

function isDirectPrismaExpression(node, prismaBindings) {
  const root = propertyAccessRoot(node);
  return Boolean(root && (
    prismaBindings.has(root.text)
    || isPrismaTransactionIdentifier(root)
  ));
}

function validateDirectPrismaAccess(files) {
  const errors = [];
  for (const [file, sourceFile] of files) {
    const prismaBindings = new Set();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!PRISMA_MODULE_PATTERN.test(statement.moduleSpecifier.text)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) {
        prismaBindings.add(clause.name.text);
        errors.push(`${file}: default Prisma value import ${clause.name.text} is forbidden`);
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        prismaBindings.add(clause.namedBindings.name.text);
        errors.push(`${file}: namespace Prisma value imports are forbidden`);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly) continue;
          prismaBindings.add(element.name.text);
          errors.push(`${file}: named Prisma value import ${element.name.text} is forbidden`);
        }
      }
    }

    const visit = node => {
      if (ts.isCallExpression(node) && isDirectPrismaExpression(node.expression, prismaBindings)) {
        errors.push(`${file}: direct Prisma/model call ${node.expression.getText()} is forbidden`);
      }
      if (
        ts.isVariableDeclaration(node)
        && node.initializer
        && isDirectPrismaExpression(node.initializer, prismaBindings)
      ) {
        errors.push(`${file}: local Prisma/model aliases are forbidden`);
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && isDirectPrismaExpression(node.right, prismaBindings)
      ) {
        errors.push(`${file}: Prisma/model reassignment aliases are forbidden`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return errors;
}

function validateFence(root, fence) {
  if (!existsSync(path.join(root, fence.file))) return [`missing fence file: ${fence.file}`];
  const sourceFile = parseSource(root, fence.file);
  let declaration;
  const interfaces = new Map();
  const visit = node => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && node.name.text === fence.symbol
    ) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!declaration) return [`${fence.file}: missing ${fence.symbol}`];
  const members = [];
  const appendMembers = (current, seen = new Set()) => {
    if (seen.has(current.name.text)) return;
    seen.add(current.name.text);
    members.push(...current.members);
    for (const heritage of current.heritageClauses ?? []) {
      for (const type of heritage.types) {
        const parent = interfaces.get(type.expression.getText());
        if (parent) appendMembers(parent, seen);
      }
    }
  };
  if (ts.isInterfaceDeclaration(declaration)) appendMembers(declaration);
  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    members.push(...declaration.type.members);
  }
  const actual = members
    .filter(ts.isPropertySignature)
    .map(member => ({
      name: member.name.getText(),
      readonly: Boolean(member.modifiers?.some(
        modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
      )),
      type: member.type?.getText(),
    }));
  const names = actual.map(field => field.name).sort();
  const errors = [];
  if (JSON.stringify(names) !== JSON.stringify(fence.readonlyFields)) {
    errors.push(`${fence.file}: ${fence.symbol} fields must exactly match ${fence.readonlyFields.join(', ')}`);
  }
  for (const field of actual) {
    if (!field.readonly) errors.push(`${fence.file}: ${fence.symbol}.${field.name} must be readonly`);
  }
  const expectedTypes = { generation: 'number', leaseToken: 'string', walletId: 'string' };
  for (const field of actual) {
    if (field.type !== expectedTypes[field.name]) {
      errors.push(
        `${fence.file}: ${fence.symbol}.${field.name} must be ${expectedTypes[field.name]}`,
      );
    }
  }
  return errors;
}

export function checkWalletSyncMutationBoundaries(root = process.cwd()) {
  const inventoryFile = path.join(root, INVENTORY_PATH);
  if (!existsSync(inventoryFile)) {
    return { errors: [`missing required file: ${INVENTORY_PATH}`] };
  }
  let inventory;
  try {
    inventory = parseWalletSyncMutationBoundaryInventory(readFileSync(inventoryFile, 'utf8'));
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
  const files = new Map(sourceFiles(root, inventory.canonicalScopes).map(file => [
    file,
    parseSource(root, file),
  ]));
  const graphFiles = new Map(walk(root, 'server/src')
    .filter(file => !file.startsWith('server/src/generated/'))
    .map(file => [file, files.get(file) ?? parseSource(root, file)]));
  const errors = [];
  const actualCalls = collectRepositoryCalls(files);
  const canonicalFiles = new Set(files.keys());
  const functionGraph = collectFunctionGraph(graphFiles, canonicalFiles);
  functionGraph.canonicalFiles = canonicalFiles;
  const actualByIdentity = Map.groupBy(actualCalls, callIdentity);
  const expectedByIdentity = new Map(inventory.callsites.map(call => [callIdentity(call), call]));

  for (const [identity, calls] of actualByIdentity) {
    const expected = expectedByIdentity.get(identity);
    const sample = calls[0];
    if (!expected) {
      errors.push(
        `${sample.file}: uninventoried repository call `
        + `${sample.enclosingFunction} -> ${sample.repository}.${sample.method} (${calls.length})`,
      );
      continue;
    }
    if (calls.length !== expected.count) {
      errors.push(`${sample.file}: ${sample.repository}.${sample.method} count changed (${calls.length} != ${expected.count})`);
    }
    if (expected.kind === 'mutation') {
      for (const call of calls) {
        errors.push(...validateMutationCall(
          call,
          expected,
          inventory.architecture.boundary,
          functionGraph,
        ));
      }
    } else if (expected.kind === 'fenced_lifecycle') {
      for (const call of calls) errors.push(...validateFencedLifecycleCall(call, expected));
    }
  }
  for (const [identity, expected] of expectedByIdentity) {
    if (!actualByIdentity.has(identity)) {
      errors.push(
        `${expected.file}: inventoried repository call disappeared: `
        + `${expected.enclosingFunction} -> ${expected.repository}.${expected.method}`,
      );
    }
  }
  errors.push(...validateFence(root, inventory.architecture.fence));
  errors.push(...validateBoundarySignature(root, inventory.architecture.boundary));
  errors.push(...validateRepositoryImports(files, inventory.architecture.boundary));
  errors.push(...validateDirectPrismaAccess(files));
  errors.push(...validateForbiddenArchitecture(files, inventory.architecture.boundary));
  errors.push(...validateRunnerCallbacks(
    files,
    inventory.architecture.boundary,
    inventory.approvedMutationUnits,
    functionGraph,
  ));
  return { errors: [...new Set(errors)], inventory, repositoryCallCount: actualCalls.length };
}

function main() {
  const result = checkWalletSyncMutationBoundaries();
  if (result.errors.length > 0) {
    for (const error of result.errors) process.stderr.write(`wallet-sync-mutation-boundaries: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `wallet-sync-mutation-boundaries: verified ${result.repositoryCallCount} repository callsites\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
