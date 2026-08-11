#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const allowlistPath =
  process.env.BITCOIN_NETWORK_BOUNDARY_ALLOWLIST ??
  path.join(root, 'scripts/quality/bitcoin-network-boundary-allowlist.json');

const options = {
  json: process.argv.includes('--json'),
};

const scanRoots = ['server/src'];

const rules = [
  { name: 'getNodeClient', minArgs: 1, memberObjects: [] },
  { name: 'broadcastTransaction', minArgs: 2, memberObjects: ['blockchain'], memberOnly: true },
  { name: 'getFeeEstimates', minArgs: 1, memberObjects: ['blockchain'] },
  { name: 'getCurrentFeeEstimates', minArgs: 1, memberObjects: [] },
  { name: 'getAdvancedFeeEstimates', minArgs: 1, memberObjects: ['advancedTx'] },
  { name: 'estimateOptimalFee', minArgs: 5, memberObjects: ['advancedTx'] },
  { name: 'getPSBTInfo', minArgs: 2, memberObjects: ['txService'] },
  { name: 'fetchRawTransactionsForLegacy', minArgs: 2, memberObjects: [] },
  { name: 'getRawTransactionHex', minArgs: 2, memberObjects: [] },
  { name: 'canReplaceTransaction', minArgs: 2, memberObjects: ['advancedTx'] },
  {
    name: 'createRBFTransaction',
    minArgs: 4,
    memberObjects: ['advancedTx'],
    forbiddenNetworkLiteralIndexes: [3],
  },
  {
    name: 'createCPFPTransaction',
    minArgs: 6,
    memberObjects: ['advancedTx'],
    forbiddenNetworkLiteralIndexes: [5],
  },
  {
    name: 'createBatchTransaction',
    minArgs: 5,
    memberObjects: ['advancedTx'],
    forbiddenNetworkLiteralIndexes: [4],
  },
];

function repoPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function fullPath(relativePath) {
  return path.join(root, relativePath);
}

function isScannableFile(filePath) {
  return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
}

function walk(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return entry.isFile() && isScannableFile(full) ? [full] : [];
  });
}

function collectFiles() {
  return scanRoots.flatMap((scanRoot) => walk(fullPath(scanRoot)));
}

function readAllowlist() {
  if (!existsSync(allowlistPath)) {
    return { version: 1, entries: [] };
  }

  return JSON.parse(readFileSync(allowlistPath, 'utf8'));
}

function propertyName(node) {
  if (ts.isIdentifier(node.expression)) {
    return {
      kind: 'identifier',
      objectText: null,
      name: node.expression.text,
      callee: node.expression.text,
    };
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    return {
      kind: 'member',
      objectText: node.expression.expression.getText(node.getSourceFile()),
      name: node.expression.name.text,
      callee: node.expression.getText(node.getSourceFile()),
    };
  }

  return null;
}

function shouldInspectCall(call, rule) {
  if (!rule) return false;
  if (call.kind === 'identifier') return !rule.memberOnly;
  return rule.memberObjects.includes(call.objectText);
}

function stringLiteralValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function detectIssue(node, rule) {
  if (node.arguments.length < rule.minArgs) {
    return 'missing-required-network-argument';
  }

  for (const index of rule.forbiddenNetworkLiteralIndexes ?? []) {
    const value = stringLiteralValue(node.arguments[index]);
    if (value === 'mainnet') {
      return 'hardcoded-mainnet-network';
    }
  }

  return null;
}

function enclosingFunctionName(node) {
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

function normalizeCallText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, ' ');
}

function findingKey(finding) {
  return [
    finding.file,
    finding.functionName,
    finding.callee,
    finding.issue,
  ].join('\0');
}

function collectFindingsInFile(filePath) {
  const relativePath = repoPath(filePath);
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings = [];
  const opaqueBroadcastBindings = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const modulePath = statement.moduleSpecifier.text;
    if (!modulePath.endsWith('/blockchain') && modulePath !== '../blockchain') continue;
    for (const element of statement.importClause?.namedBindings?.elements ?? []) {
      if ((element.propertyName?.text ?? element.name.text) === 'broadcastTransaction') {
        opaqueBroadcastBindings.add(element.name.text);
      }
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const call = propertyName(node);
      if (call?.kind === 'identifier' && opaqueBroadcastBindings.has(call.name)) {
        const canonicalFile = 'server/src/services/bitcoin/transactions/broadcasting.ts';
        const valid = relativePath === canonicalFile && node.arguments.length === 1;
        if (!valid) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push({
            file: relativePath,
            line: line + 1,
            functionName: enclosingFunctionName(node),
            callee: call.callee,
            issue: 'opaque-broadcast-boundary-bypass',
            call: normalizeCallText(node, sourceFile),
          });
        }
      }
      const rule = call
        ? rules.find((candidate) => candidate.name === call.name && shouldInspectCall(call, candidate))
        : null;
      if (call && shouldInspectCall(call, rule)) {
        const issue = detectIssue(node, rule);
        if (issue) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push({
            file: relativePath,
            line: line + 1,
            functionName: enclosingFunctionName(node),
            callee: call.callee,
            issue,
            call: normalizeCallText(node, sourceFile),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function validateAllowlistEntry(entry, index) {
  const requiredFields = [
    'file',
    'functionName',
    'callee',
    'issue',
    'reason',
    'owner',
    'targetRemovalSlice',
  ];

  return requiredFields.flatMap((field) => {
    if (typeof entry[field] === 'string' && entry[field].trim() !== '') {
      return [];
    }
    return [`allowlist entry ${index + 1} missing ${field}`];
  });
}

function createSummary() {
  const allowlist = readAllowlist();
  const allowlistEntries = Array.isArray(allowlist.entries) ? allowlist.entries : [];
  const allowlistErrors = [
    ...(allowlist.version === 1 ? [] : ['allowlist version must be 1']),
    ...allowlistEntries.flatMap(validateAllowlistEntry),
  ];

  const findings = collectFiles().flatMap(collectFindingsInFile);
  const findingKeys = new Set(findings.map(findingKey));
  const allowlistKeys = new Set(allowlistEntries.map(findingKey));

  const newFindings = findings.filter((finding) => !allowlistKeys.has(findingKey(finding)));
  const staleAllowlistEntries = allowlistEntries.filter((entry) => !findingKeys.has(findingKey(entry)));
  const allowedFindings = findings.filter((finding) => allowlistKeys.has(findingKey(finding)));

  return {
    scanRoots,
    allowlistPath: repoPath(allowlistPath),
    findings,
    allowedFindings,
    newFindings,
    staleAllowlistEntries,
    errors: [...allowlistErrors],
  };
}

function printHumanSummary(summary) {
  if (summary.errors.length === 0 && summary.newFindings.length === 0 && summary.staleAllowlistEntries.length === 0) {
    console.log(
      `bitcoin-network-boundaries: passed (${summary.allowedFindings.length} allowed finding(s))`,
    );
    return;
  }

  console.error('bitcoin-network-boundaries: failed');

  for (const error of summary.errors) {
    console.error(`- ${error}`);
  }

  for (const finding of summary.newFindings) {
    console.error(
      `- new finding: ${finding.file}:${finding.line} ${finding.issue} in ${finding.functionName}: ${finding.call}`,
    );
  }

  for (const entry of summary.staleAllowlistEntries) {
    console.error(
      `- stale allowlist entry: ${entry.file} ${entry.issue} in ${entry.functionName}: ${entry.callee}`,
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
