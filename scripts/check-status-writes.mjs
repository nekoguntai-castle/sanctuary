#!/usr/bin/env node

/**
 * Status-write ownership gate.
 *
 * Each guarded status/state column has a short list of owner modules (its
 * repository or transition module) in scripts/quality/status-write-owners.json.
 * The gate fails when server code writes a guarded column outside its owners,
 * and when an owner entry no longer writes its column (stale entry), so the
 * list stays an exact map of where each state machine moves.
 *
 * Detected writes:
 * - Prisma `create`/`createMany`/`createManyAndReturn`/`update`/`updateMany`/
 *   `upsert` calls on the column's model accessor whose `data` (or upsert
 *   `create`/`update`) object literal names the column;
 * - raw SQL text that UPDATEs or INSERTs INTO the column's table and names
 *   the column.
 * Data the scan cannot read (`data: input`, `data: { ...patch }`, a call)
 * counts as writing every guarded column of that model, so an opaque write
 * to a guarded model must also live in an owner module.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const ownersPath =
  process.env.STATUS_WRITE_OWNERS ??
  path.join(root, 'scripts/quality/status-write-owners.json');

const options = {
  json: process.argv.includes('--json'),
};

const scanRoots = ['server/src'];
const WRITE_METHODS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert']);
const DATA_KEYS = new Set(['data', 'create', 'update']);

function repoPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isScannableFile(filePath) {
  return (
    (filePath.endsWith('.ts') || filePath.endsWith('.mts')) &&
    !filePath.endsWith('.d.ts') &&
    !/\.(test|spec)\.[cm]?ts$/.test(path.basename(filePath)) &&
    !filePath.includes(`${path.sep}tests${path.sep}`) &&
    !filePath.includes(`${path.sep}generated${path.sep}`)
  );
}

function walk(entryPath) {
  if (!existsSync(entryPath)) return [];
  return readdirSync(entryPath, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(entryPath, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && isScannableFile(full) ? [full] : [];
  });
}

function readOwners() {
  if (!existsSync(ownersPath)) return { version: 1, columns: [] };
  return JSON.parse(readFileSync(ownersPath, 'utf8'));
}

function columnKey(column) {
  return `${column.model}.${column.field}`;
}

function validateColumn(column, index) {
  const errors = [];
  for (const key of ['model', 'table', 'field']) {
    if (typeof column[key] !== 'string' || column[key].length === 0) {
      errors.push(`columns[${index}].${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(column.owners) || column.owners.length === 0) {
    errors.push(`columns[${index}].owners must list at least one owner`);
    return errors;
  }
  column.owners.forEach((owner, ownerIndex) => {
    if (typeof owner.file !== 'string' || owner.file.length === 0) {
      errors.push(`columns[${index}].owners[${ownerIndex}].file must be a non-empty string`);
    }
    if (typeof owner.reason !== 'string' || owner.reason.trim().length === 0) {
      errors.push(`columns[${index}].owners[${ownerIndex}].reason must explain the ownership`);
    }
  });
  return errors;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return null;
}

const OPAQUE = Symbol('opaque write data');

/** Field names an object literal sets, or OPAQUE when it cannot be read statically. */
function objectLiteralFields(node) {
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(objectLiteralFields);
  if (!ts.isObjectLiteralExpression(node)) return [OPAQUE];
  return node.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
    if (ts.isPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      return name ? [name] : [OPAQUE];
    }
    return [OPAQUE];
  });
}

/** The fields a Prisma write call sets, keyed by the model accessor it was called on. */
function prismaWrite(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if (!WRITE_METHODS.has(method)) return null;
  const receiver = node.expression.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return null;
  const [argument] = node.arguments;
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
  const fields = argument.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return [];
    const name = propertyNameText(property.name);
    return name && DATA_KEYS.has(name) ? objectLiteralFields(property.initializer) : [];
  });
  return { model: receiver.name.text, fields: new Set(fields) };
}

function sqlText(node, sourceFile) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(sourceFile);
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rawSqlWrites(text, column) {
  const table = escapeRegExp(column.table);
  const writesTable = new RegExp(`\\b(UPDATE|INSERT\\s+INTO)\\s+"?${table}"?`, 'i').test(text);
  return writesTable && new RegExp(`"${escapeRegExp(column.field)}"`).test(text);
}

function collectWrites(filePath, columns) {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const file = repoPath(filePath);
  const writes = [];
  const record = (column, node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    writes.push({ column: columnKey(column), file, line });
  };

  const visit = (node) => {
    const write = prismaWrite(node);
    if (write) {
      for (const column of columns) {
        if (write.model !== column.model) continue;
        if (write.fields.has(column.field) || write.fields.has(OPAQUE)) record(column, node);
      }
    }
    // A template's literal pieces are visited as part of its parent expression.
    if (!ts.isTemplateSpan(node) && !ts.isTemplateHead(node)) {
      const text = sqlText(node, sourceFile);
      if (text) {
        for (const column of columns) {
          if (rawSqlWrites(text, column)) record(column, node);
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writes;
}

function createSummary() {
  const config = readOwners();
  const columns = Array.isArray(config.columns) ? config.columns : [];
  const errors = [
    ...(config.version === 1 ? [] : ['owners file version must be 1']),
    ...columns.flatMap(validateColumn),
  ];

  const files = scanRoots.flatMap((scanRoot) => walk(path.join(root, scanRoot)));
  const writes = files.flatMap((filePath) => collectWrites(filePath, columns));
  const ownersByColumn = new Map(
    columns.map((column) => [columnKey(column), new Set((column.owners ?? []).map((owner) => owner.file))]),
  );

  const unownedWrites = writes.filter((write) => !ownersByColumn.get(write.column)?.has(write.file));
  const staleOwners = columns.flatMap((column) =>
    (column.owners ?? [])
      .filter((owner) => !writes.some((write) => write.column === columnKey(column) && write.file === owner.file))
      .map((owner) => ({ column: columnKey(column), file: owner.file })),
  );

  return {
    scanRoots,
    ownersPath: repoPath(ownersPath),
    guardedColumns: columns.map(columnKey),
    writes,
    unownedWrites,
    staleOwners,
    errors,
  };
}

function printHumanSummary(summary) {
  if (summary.errors.length === 0 && summary.unownedWrites.length === 0 && summary.staleOwners.length === 0) {
    console.log(
      `status-writes: passed (${summary.guardedColumns.length} guarded column(s), ${summary.writes.length} owned write(s))`,
    );
    return;
  }

  console.error('status-writes: failed');
  for (const error of summary.errors) console.error(`- ${error}`);
  for (const write of summary.unownedWrites) {
    console.error(
      `- ${write.file}:${write.line} writes ${write.column} outside its owner modules; move the write into an owner or add an owner entry with a reason`,
    );
  }
  for (const owner of summary.staleOwners) {
    console.error(`- stale owner entry: ${owner.file} no longer writes ${owner.column}`);
  }
}

const summary = createSummary();

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHumanSummary(summary);
}

process.exit(
  summary.errors.length === 0 && summary.unownedWrites.length === 0 && summary.staleOwners.length === 0 ? 0 : 1,
);
