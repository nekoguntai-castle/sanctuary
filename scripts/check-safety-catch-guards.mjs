#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const allowlistPath =
  process.env.SAFETY_CATCH_ALLOWLIST ??
  path.join(root, 'scripts/quality/safety-catch-allowlist.json');

const options = {
  json: process.argv.includes('--json'),
};

const scanRoots = [
  'server/src/api/transactions',
  'server/src/services/bitcoin',
  'server/src/services/walletImport',
  'server/src/services/import',
  'server/src/services/export',
  'server/src/services/backupService',
  'server/src/middleware',
  'server/src/services/accessControl.ts',
  'src/services/hardwareWallet',
  'src/services/deviceParsers',
  'src/hooks/send',
  'src/contexts/send',
  'scripts/release',
];

const issueName = 'non-terminal-catch';
const approvedFailClosedCalls = new Set([
  'failClosed',
  'failClosedResult',
  'failClosedSafetyError',
  'recordFailClosed',
]);

function repoPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function fullPath(relativePath) {
  return path.join(root, relativePath);
}

function isScannableFile(filePath) {
  return (
    (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.mjs')) &&
    !filePath.endsWith('.d.ts') &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path.basename(filePath)) &&
    !filePath.includes(`${path.sep}tests${path.sep}`) &&
    !filePath.includes(`${path.sep}__tests__${path.sep}`) &&
    !filePath.includes(`${path.sep}generated${path.sep}`)
  );
}

function walk(entryPath) {
  if (!existsSync(entryPath)) return [];
  const statEntries = readdirSync(entryPath, { withFileTypes: true });
  return statEntries.flatMap((entry) => {
    const full = path.join(entryPath, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return entry.isFile() && isScannableFile(full) ? [full] : [];
  });
}

function collectFiles() {
  return scanRoots.flatMap((scanRoot) => {
    const full = fullPath(scanRoot);
    if (!existsSync(full)) return [];
    return isScannableFile(full) ? [full] : walk(full);
  });
}

function readAllowlist() {
  if (!existsSync(allowlistPath)) {
    return { version: 1, entries: [] };
  }
  return JSON.parse(readFileSync(allowlistPath, 'utf8'));
}

function functionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && current.name) {
      return current.name.getText(current.getSourceFile());
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return '<module>';
}

function callName(node, sourceFile) {
  if (!ts.isCallExpression(node)) return null;
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return expression.getText(sourceFile);
}

function expressionIsApprovedFailClosedCall(statement, sourceFile) {
  if (!ts.isExpressionStatement(statement)) return false;
  const name = callName(statement.expression, sourceFile);
  return Boolean(name && approvedFailClosedCalls.has(name));
}

function statementGuaranteesExit(statement, sourceFile) {
  if (ts.isThrowStatement(statement) || ts.isReturnStatement(statement)) {
    return true;
  }
  if (expressionIsApprovedFailClosedCall(statement, sourceFile)) {
    return true;
  }
  if (ts.isBlock(statement)) {
    return blockGuaranteesExit(statement, sourceFile);
  }
  if (ts.isIfStatement(statement)) {
    return Boolean(
      statement.elseStatement &&
        statementGuaranteesExit(statement.thenStatement, sourceFile) &&
        statementGuaranteesExit(statement.elseStatement, sourceFile),
    );
  }
  return false;
}

function blockGuaranteesExit(block, sourceFile) {
  return block.statements.some((statement) => statementGuaranteesExit(statement, sourceFile));
}

function catchHasFailClosedExit(catchClause, sourceFile) {
  return blockGuaranteesExit(catchClause.block, sourceFile);
}

function summarizeSnippet(catchClause, sourceFile) {
  return catchClause.block.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 160);
}

function collectFindingsInFile(filePath) {
  const relativePath = repoPath(filePath);
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const findings = [];

  function visit(node) {
    if (ts.isCatchClause(node) && !catchHasFailClosedExit(node, sourceFile)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({
        file: relativePath,
        line: line + 1,
        functionName: functionName(node),
        issue: issueName,
        snippet: summarizeSnippet(node, sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function findingKey(finding) {
  return [finding.file, finding.functionName, finding.issue].join('\0');
}

function groupFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = findingKey(finding);
    const current = groups.get(key) ?? {
      file: finding.file,
      functionName: finding.functionName,
      issue: finding.issue,
      count: 0,
      lines: [],
      snippets: [],
    };
    current.count += 1;
    current.lines.push(finding.line);
    current.snippets.push(finding.snippet);
    groups.set(key, current);
  }
  return [...groups.values()];
}

function validateAllowlistEntry(entry, index) {
  const requiredStringFields = ['file', 'functionName', 'issue', 'reason', 'owner', 'targetRemovalSlice'];
  const stringErrors = requiredStringFields.flatMap((field) => {
    if (typeof entry[field] === 'string' && entry[field].trim() !== '') {
      return [];
    }
    return [`allowlist entry ${index + 1} missing ${field}`];
  });

  if (!Number.isInteger(entry.count) || entry.count < 1) {
    return [...stringErrors, `allowlist entry ${index + 1} count must be a positive integer`];
  }
  return stringErrors;
}

function createSummary() {
  const allowlist = readAllowlist();
  const allowlistEntries = Array.isArray(allowlist.entries) ? allowlist.entries : [];
  const allowlistErrors = [
    ...(allowlist.version === 1 ? [] : ['allowlist version must be 1']),
    ...allowlistEntries.flatMap(validateAllowlistEntry),
  ];

  const findings = collectFiles().flatMap(collectFindingsInFile);
  const groupedFindings = groupFindings(findings);
  const findingByKey = new Map(groupedFindings.map((finding) => [findingKey(finding), finding]));
  const allowlistByKey = new Map(allowlistEntries.map((entry) => [findingKey(entry), entry]));

  const newFindings = groupedFindings.filter((finding) => {
    const allowed = allowlistByKey.get(findingKey(finding));
    return !allowed || finding.count > allowed.count;
  });
  const staleAllowlistEntries = allowlistEntries.filter((entry) => {
    const finding = findingByKey.get(findingKey(entry));
    return !finding || finding.count < entry.count;
  });
  const allowedFindings = groupedFindings.filter((finding) => {
    const allowed = allowlistByKey.get(findingKey(finding));
    return allowed && finding.count <= allowed.count;
  });

  return {
    scanRoots,
    allowlistPath: repoPath(allowlistPath),
    findings: groupedFindings,
    allowedFindings,
    newFindings,
    staleAllowlistEntries,
    errors: allowlistErrors,
  };
}

function printHumanSummary(summary) {
  if (summary.errors.length === 0 && summary.newFindings.length === 0 && summary.staleAllowlistEntries.length === 0) {
    console.log(
      `safety-catch-guards: passed (${summary.allowedFindings.length} allowed finding group(s))`,
    );
    return;
  }

  console.error('safety-catch-guards: failed');
  for (const error of summary.errors) {
    console.error(`- ${error}`);
  }
  for (const finding of summary.newFindings) {
    console.error(
      `- new finding: ${finding.file}:${finding.lines.join(',')} ${finding.issue} in ${finding.functionName} (${finding.count} catch block(s))`,
    );
  }
  for (const entry of summary.staleAllowlistEntries) {
    console.error(
      `- stale allowlist entry: ${entry.file} ${entry.issue} in ${entry.functionName} expected ${entry.count}`,
    );
  }
}

const summary = createSummary();

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHumanSummary(summary);
}

process.exit(
  summary.errors.length === 0 &&
    summary.newFindings.length === 0 &&
    summary.staleAllowlistEntries.length === 0
    ? 0
    : 1,
);
