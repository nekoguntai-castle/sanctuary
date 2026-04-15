#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const routesEntry = 'server/src/routes.ts';
const openApiPathsDir = 'server/src/api/openapi/paths';
const exceptionsPath = 'scripts/quality/openapi-route-coverage-exceptions.json';
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);

const moduleCache = new Map();
const errors = [];

function repoPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function fullPath(relativePath) {
  return path.join(root, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(fullPath(relativePath), 'utf8'));
}

function isNodeStringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function textOfString(node) {
  return isNodeStringLiteral(node) ? node.text : null;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function resolveModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const fromDir = path.dirname(fullPath(fromFile));
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return repoPath(candidate);
    }
  }

  return null;
}

function parseSource(relativePath) {
  const source = readFileSync(fullPath(relativePath), 'utf8');
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function parseModule(relativePath) {
  if (moduleCache.has(relativePath)) {
    return moduleCache.get(relativePath);
  }

  const sourceFile = parseSource(relativePath);
  const moduleInfo = {
    file: relativePath,
    sourceFile,
    imports: new Map(),
    exports: new Map(),
    topLevelCalls: [],
    functionCalls: new Map(),
  };
  moduleCache.set(relativePath, moduleInfo);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && isNodeStringLiteral(statement.moduleSpecifier)) {
      const importPath = resolveModule(relativePath, statement.moduleSpecifier.text);
      if (!importPath || !statement.importClause) {
        continue;
      }

      const { name, namedBindings } = statement.importClause;
      if (name) {
        moduleInfo.imports.set(name.text, { file: importPath, exportName: 'default' });
      }

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          moduleInfo.imports.set(element.name.text, {
            file: importPath,
            exportName: (element.propertyName ?? element.name).text,
          });
        }
      }
    }

    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      moduleInfo.exports.set('default', { kind: 'router', name: statement.expression.text });
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const exported = hasExportModifier(statement);
        if (
          exported &&
          declaration.initializer &&
          ts.isIdentifier(declaration.initializer)
        ) {
          moduleInfo.exports.set(declaration.name.text, {
            kind: 'router',
            name: declaration.initializer.text,
          });
        }
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(statement)) {
      moduleInfo.exports.set(statement.name.text, {
        kind: 'function',
        name: statement.name.text,
      });
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && isNodeStringLiteral(statement.moduleSpecifier)) {
      const exportPath = resolveModule(relativePath, statement.moduleSpecifier.text);
      if (!exportPath || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        continue;
      }

      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        const sourceName = (element.propertyName ?? element.name).text;
        moduleInfo.exports.set(exportedName, {
          kind: 'reexport',
          file: exportPath,
          exportName: sourceName,
        });
      }
    }
  }

  function visit(node, functionName = null) {
    let nextFunctionName = functionName;
    if (ts.isFunctionDeclaration(node) && node.name) {
      nextFunctionName = node.name.text;
    }

    if (ts.isCallExpression(node)) {
      const call = parseRouterCall(node);
      if (call) {
        const collection = nextFunctionName
          ? getFunctionCalls(moduleInfo, nextFunctionName)
          : moduleInfo.topLevelCalls;
        collection.push(call);
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextFunctionName));
  }

  visit(sourceFile);
  return moduleInfo;
}

function getFunctionCalls(moduleInfo, functionName) {
  const existing = moduleInfo.functionCalls.get(functionName);
  if (existing) {
    return existing;
  }

  const calls = [];
  moduleInfo.functionCalls.set(functionName, calls);
  return calls;
}

function parseRouterCall(node) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }

  const method = node.expression.name.text;
  if (method !== 'use' && !httpMethods.has(method)) {
    return null;
  }

  if (!ts.isIdentifier(node.expression.expression)) {
    return null;
  }

  const receiver = node.expression.expression.text;
  const args = node.arguments;

  if (httpMethods.has(method)) {
    const routePath = args[0] ? textOfString(args[0]) : null;
    if (!routePath) {
      return null;
    }
    return { kind: 'route', receiver, method, path: routePath };
  }

  const firstArg = args[0];
  const hasMountPath = firstArg ? textOfString(firstArg) !== null : false;
  const mountPath = hasMountPath ? textOfString(firstArg) : '/';
  const handlerArgs = hasMountPath ? args.slice(1) : args;
  const childRefs = handlerArgs.map(parseRouteSourceExpression).filter(Boolean);

  if (childRefs.length === 0) {
    return null;
  }

  return { kind: 'use', receiver, path: mountPath, childRefs };
}

function parseRouteSourceExpression(node) {
  if (ts.isIdentifier(node)) {
    return { kind: 'identifier', name: node.text };
  }

  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return { kind: 'call', name: node.expression.text };
  }

  return null;
}

function collectRoutesFromExport(relativePath, exportName, prefix = '/', visited = new Set()) {
  const visitKey = `${relativePath}:${exportName}:${prefix}`;
  if (visited.has(visitKey)) {
    return [];
  }
  visited.add(visitKey);

  const moduleInfo = parseModule(relativePath);
  const exported = moduleInfo.exports.get(exportName);
  if (!exported) {
    errors.push(`Unable to resolve export ${exportName} from ${relativePath}`);
    return [];
  }

  if (exported.kind === 'reexport') {
    return collectRoutesFromExport(exported.file, exported.exportName, prefix, visited);
  }

  const calls = exported.kind === 'function'
    ? moduleInfo.functionCalls.get(exported.name) ?? []
    : moduleInfo.topLevelCalls.filter((call) => call.receiver === exported.name);

  return collectRoutesFromCalls(moduleInfo, calls, prefix, visited);
}

function collectRoutesFromCalls(moduleInfo, calls, prefix, visited) {
  const routes = [];

  for (const call of calls) {
    if (call.kind === 'route') {
      routes.push({
        method: call.method.toUpperCase(),
        path: joinPaths(prefix, call.path),
        source: moduleInfo.file,
      });
      continue;
    }

    const nextPrefix = joinPaths(prefix, call.path);
    for (const childRef of call.childRefs) {
      const imported = moduleInfo.imports.get(childRef.name);
      if (!imported) {
        continue;
      }

      if (childRef.kind === 'call') {
        routes.push(...collectRoutesFromExport(imported.file, imported.exportName, nextPrefix, visited));
      } else {
        routes.push(...collectRoutesFromExport(imported.file, imported.exportName, nextPrefix, visited));
      }
    }
  }

  return routes;
}

function collectApplicationRoutes() {
  const moduleInfo = parseModule(routesEntry);
  const routes = [];

  for (const statement of moduleInfo.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'routes') {
        continue;
      }
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
        continue;
      }

      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          continue;
        }

        const route = parseRouteDefinitionObject(element);
        if (!route) {
          continue;
        }

        if (route.method === 'GET') {
          routes.push({
            method: route.method,
            path: route.path,
            source: routesEntry,
          });
          continue;
        }

        const imported = moduleInfo.imports.get(route.handler);
        if (!imported) {
          continue;
        }

        routes.push(...collectRoutesFromExport(imported.file, imported.exportName, route.path, new Set()));
      }
    }
  }

  return dedupeRoutes(routes);
}

function parseRouteDefinitionObject(objectNode) {
  const fields = new Map();

  for (const property of objectNode.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const key = propertyNameText(property.name);
    if (!key) {
      continue;
    }

    if (key === 'method' || key === 'path') {
      const value = textOfString(property.initializer);
      if (value) {
        fields.set(key, value);
      }
    }

    if (key === 'handler' && ts.isIdentifier(property.initializer)) {
      fields.set(key, property.initializer.text);
    }
  }

  const method = fields.get('method');
  const routePath = fields.get('path');
  const handler = fields.get('handler');
  if (!method || !routePath || !handler) {
    return null;
  }

  return { method: method.toUpperCase(), path: routePath, handler };
}

function collectOpenApiRoutes() {
  return dedupeRoutes(
    walkOpenApiPathFiles(fullPath(openApiPathsDir)).flatMap(collectOpenApiRoutesFromFile)
  );
}

function collectOpenApiRoutesFromFile(relativePath) {
  return parseSource(relativePath).statements.flatMap((statement) => (
    collectOpenApiRoutesFromStatement(statement, relativePath)
  ));
}

function collectOpenApiRoutesFromStatement(statement, relativePath) {
  if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
    return [];
  }

  return statement.declarationList.declarations.flatMap((declaration) => (
    collectOpenApiRoutesFromDeclaration(declaration, relativePath)
  ));
}

function collectOpenApiRoutesFromDeclaration(declaration, relativePath) {
  if (!isOpenApiPathsDeclaration(declaration)) {
    return [];
  }

  const objectLiteral = objectLiteralInitializer(declaration.initializer);
  if (!objectLiteral) {
    return [];
  }

  return objectLiteral.properties.flatMap((property) => (
    collectOpenApiRoutesFromPathProperty(property, relativePath)
  ));
}

function isOpenApiPathsDeclaration(declaration) {
  return (
    ts.isIdentifier(declaration.name) &&
    declaration.name.text.endsWith('Paths') &&
    Boolean(declaration.initializer)
  );
}

function collectOpenApiRoutesFromPathProperty(property, relativePath) {
  if (!ts.isPropertyAssignment(property)) {
    return [];
  }

  const pathKey = propertyNameText(property.name);
  if (!pathKey?.startsWith('/')) {
    return [];
  }

  const pathObject = objectLiteralInitializer(property.initializer);
  if (!pathObject) {
    return [];
  }

  return collectOpenApiMethods(pathObject, pathKey, relativePath);
}

function collectOpenApiMethods(pathObject, pathKey, relativePath) {
  return pathObject.properties.flatMap((methodProperty) => {
    if (!ts.isPropertyAssignment(methodProperty)) {
      return [];
    }

    const method = propertyNameText(methodProperty.name);
    if (!method || !httpMethods.has(method)) {
      return [];
    }

    return [{
      method: method.toUpperCase(),
      path: openApiPathToApplicationPath(pathKey),
      source: relativePath,
    }];
  });
}

function objectLiteralInitializer(initializer) {
  if (!initializer) {
    return null;
  }

  const node = unwrapAsConst(initializer);
  return ts.isObjectLiteralExpression(node) ? node : null;
}

function unwrapAsConst(node) {
  if (ts.isAsExpression(node)) {
    return unwrapAsConst(node.expression);
  }
  return node;
}

function walkOpenApiPathFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkOpenApiPathFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(repoPath(entryPath));
    }
  }
  return files;
}

function dedupeRoutes(routes) {
  const seen = new Map();

  for (const route of routes) {
    const normalized = normalizeRoute(route);
    const key = routeKey(normalized);
    if (!seen.has(key)) {
      seen.set(key, normalized);
    }
  }

  return Array.from(seen.values()).sort(compareRoutes);
}

function compareRoutes(a, b) {
  return a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
}

function normalizeRoute(route) {
  return {
    ...route,
    path: normalizePath(route.path),
    method: route.method.toUpperCase(),
  };
}

function normalizePath(routePath) {
  const normalized = routePath
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/:([A-Za-z_$][\w$]*)/g, '{$1}');
  return normalized === '' ? '/' : normalized;
}

function joinPaths(prefix, suffix) {
  if (!suffix || suffix === '/') {
    return normalizePath(prefix);
  }
  if (!prefix || prefix === '/') {
    return normalizePath(suffix);
  }
  return normalizePath(`${prefix}/${suffix}`);
}

function openApiPathToApplicationPath(pathKey) {
  if (pathKey.startsWith('/internal/')) {
    return normalizePath(pathKey);
  }
  return normalizePath(`/api/v1${pathKey}`);
}

function routeKey(route) {
  return `${route.method} ${canonicalRoutePath(route.path)}`;
}

function canonicalRoutePath(routePath) {
  return normalizePath(routePath).replace(/\{[^}]+\}/g, '{param}');
}

function exceptionSet(entries, sectionName) {
  const set = new Set();

  for (const entry of entries ?? []) {
    if (!entry.method || !entry.path || !entry.reason || entry.reason.trim().length < 20) {
      errors.push(`Invalid ${sectionName} exception; method, path, and concrete reason are required`);
      continue;
    }
    set.add(routeKey(normalizeRoute(entry)));
  }

  return set;
}

const exceptions = readJson(exceptionsPath);
const undocumentedExceptions = exceptionSet(exceptions.undocumentedRoutes, 'undocumentedRoutes');
const documentedOnlyExceptions = exceptionSet(exceptions.documentedOnlyRoutes, 'documentedOnlyRoutes');

const applicationRoutes = collectApplicationRoutes();
const openApiRoutes = collectOpenApiRoutes();

const applicationRouteKeys = new Set(applicationRoutes.map(routeKey));
const openApiRouteKeys = new Set(openApiRoutes.map(routeKey));

const missingFromOpenApi = applicationRoutes.filter((route) => (
  !openApiRouteKeys.has(routeKey(route)) && !undocumentedExceptions.has(routeKey(route))
));
const documentedOnly = openApiRoutes.filter((route) => (
  !applicationRouteKeys.has(routeKey(route)) && !documentedOnlyExceptions.has(routeKey(route))
));

if (missingFromOpenApi.length > 0) {
  errors.push('Routes missing from OpenAPI:');
  for (const route of missingFromOpenApi) {
    errors.push(`  ${routeKey(route)} (${route.source})`);
  }
}

if (documentedOnly.length > 0) {
  errors.push('OpenAPI operations without matching Express routes:');
  for (const route of documentedOnly) {
    errors.push(`  ${routeKey(route)} (${route.source})`);
  }
}

for (const exceptionKey of undocumentedExceptions) {
  if (!applicationRouteKeys.has(exceptionKey)) {
    errors.push(`Unused undocumentedRoutes exception: ${exceptionKey}`);
  }
}

for (const exceptionKey of documentedOnlyExceptions) {
  if (!openApiRouteKeys.has(exceptionKey)) {
    errors.push(`Unused documentedOnlyRoutes exception: ${exceptionKey}`);
  }
}

if (errors.length > 0) {
  console.error('openapi-route-coverage: failed');
  for (const error of errors) {
    console.error(`openapi-route-coverage: ${error}`);
  }
  process.exit(1);
}

console.log(
  `openapi-route-coverage: passed (${applicationRoutes.length} Express routes, ${openApiRoutes.length} OpenAPI operations, ${undocumentedExceptions.size} documented exceptions)`
);
