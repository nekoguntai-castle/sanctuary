#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const configPath = path.join(
  root,
  'scripts/quality/large-file-classification.json',
);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const lineLimit = Number(config.lineLimit ?? 1000);
const warningLimit = Number(config.warningLimit ?? 800);
const classifications = config.classifications ?? {};
const outputJson =
  process.argv.includes('--json') ||
  process.env.QUALITY_LARGE_FILES_FORMAT === 'json';

const excludedPrefixes = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  'reports/',
  '.tmp/',
  '.tmp-gh/',
  'playwright-report/',
  'test-results/',
];
const excludedSegments = [
  '/node_modules/',
  '/dist/',
  '/build/',
  '/coverage/',
  '/reports/',
  '/playwright-report/',
  '/test-results/',
];
const excludedGeneratedPrefixes = ['server/src/generated/prisma/'];
const codeFilePattern = /\.(?:cjs|js|mjs|ts|tsx)$/;
const allowedCategories = new Set([
  'proof-harness',
  'generated-output',
  'test-fixture',
]);
const reviewDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const testDirectoryPattern = /(^|\/)(?:tests|e2e)\//;
const testFilePattern = /(?:\.test|\.spec)\.(?:cjs|js|mjs|ts|tsx)$/;

function isScannedCodeFile(filePath) {
  if (!codeFilePattern.test(filePath)) {
    return false;
  }

  return !isExcludedPath(filePath);
}

function isExcludedPath(filePath) {
  return (
    excludedPrefixes.some(
      (prefix) =>
        filePath === prefix.slice(0, -1) || filePath.startsWith(prefix),
    ) ||
    excludedSegments.some((segment) => filePath.includes(segment)) ||
    excludedGeneratedPrefixes.some((prefix) => filePath.startsWith(prefix))
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path
      .relative(root, fullPath)
      .split(path.sep)
      .join('/');

    if (isExcludedPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (entry.isFile() && isScannedCodeFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

function countLines(filePath) {
  const content = readFileSync(path.join(root, filePath), 'utf8');
  if (content.length === 0) {
    return 0;
  }

  return content.endsWith('\n')
    ? content.split('\n').length - 1
    : content.split('\n').length;
}

function fileRole(filePath) {
  if (classifications[filePath]) {
    return 'classified';
  }
  if (testDirectoryPattern.test(filePath) || testFilePattern.test(filePath)) {
    return 'test';
  }
  return 'source';
}

const trackedFiles = walk(root);

const scannedFileStats = trackedFiles
  .map((filePath) => ({
    filePath,
    lines: countLines(filePath),
    role: fileRole(filePath),
  }))
  .sort((a, b) => b.lines - a.lines);
const oversized = scannedFileStats.filter(({ lines }) => lines > warningLimit);
const sourceFiles = scannedFileStats.filter(({ role }) => role === 'source');
const testFiles = scannedFileStats.filter(({ role }) => role === 'test');
const classifiedFiles = scannedFileStats.filter(
  ({ role }) => role === 'classified',
);

const sourceWarnings = oversized.filter(({ role }) => role === 'source');
const sourceWarningsOverLimit = sourceWarnings.filter(
  ({ lines }) => lines > lineLimit,
);
const testWarnings = oversized.filter(({ role }) => role === 'test');
const testWarningsOverLimit = testWarnings.filter(
  ({ lines }) => lines > lineLimit,
);
const classifiedWarnings = oversized.filter(
  ({ role }) => role === 'classified',
);
const classifiedWarningsOverLimit = classifiedWarnings.filter(
  ({ lines }) => lines > lineLimit,
);
const errors = [];

for (const [filePath, entry] of Object.entries(classifications)) {
  const fullPath = path.join(root, filePath);

  try {
    if (!statSync(fullPath).isFile()) {
      errors.push(`classified file is not a file: ${filePath}`);
      continue;
    }
  } catch {
    errors.push(`classified file does not exist: ${filePath}`);
    continue;
  }

  if (!allowedCategories.has(entry.category)) {
    errors.push(
      `classified file has invalid category ${entry.category}: ${filePath}`,
    );
  }

  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
    errors.push(`classified file needs a concrete reason: ${filePath}`);
  }

  if (typeof entry.owner !== 'string' || entry.owner.trim().length < 3) {
    errors.push(`classified file needs a concrete owner: ${filePath}`);
  }

  if (typeof entry.reviewWhenTouched !== 'boolean') {
    errors.push(`classified file needs reviewWhenTouched boolean: ${filePath}`);
  }

  if (
    typeof entry.lastReviewed !== 'string' ||
    !reviewDatePattern.test(entry.lastReviewed)
  ) {
    errors.push(
      `classified file needs lastReviewed date YYYY-MM-DD: ${filePath}`,
    );
  }
}

for (const { filePath, lines } of sourceWarningsOverLimit) {
  errors.push(
    `oversized production source file: ${filePath} (${lines} lines > ${lineLimit})`,
  );
}

for (const { filePath, lines } of testWarningsOverLimit) {
  errors.push(
    `oversized unclassified test file: ${filePath} (${lines} lines > ${lineLimit})`,
  );
}

function classifiedFileSummary({ filePath, lines }) {
  const classification = classifications[filePath];
  return {
    filePath,
    lines,
    category: classification?.category ?? null,
    owner: classification?.owner ?? null,
    reviewWhenTouched: classification?.reviewWhenTouched ?? null,
    lastReviewed: classification?.lastReviewed ?? null,
  };
}

function emitJsonSummary() {
  console.log(
    JSON.stringify(
      {
        lineLimit,
        warningLimit,
        scannedFiles: trackedFiles.length,
        source: {
          largest: sourceFiles[0] ?? null,
          warningCount: sourceWarnings.length,
          overLimitCount: sourceWarningsOverLimit.length,
          files: sourceWarnings,
        },
        tests: {
          largest: testFiles[0] ?? null,
          warningCount: testWarnings.length,
          overLimitCount: testWarningsOverLimit.length,
          files: testWarnings,
        },
        classified: {
          largest: classifiedFiles[0]
            ? classifiedFileSummary(classifiedFiles[0])
            : null,
          warningCount: classifiedWarnings.length,
          overLimitCount: classifiedWarningsOverLimit.length,
          files: classifiedWarnings.map(classifiedFileSummary),
        },
        errors,
      },
      null,
      2,
    ),
  );
}

function emitTextSummary() {
  if (
    sourceWarnings.length === 0 &&
    testWarnings.length === 0 &&
    classifiedWarnings.length === 0
  ) {
    return;
  }

  console.log(
    `large-files: ${sourceWarningsOverLimit.length} production source files over ${lineLimit} lines; ${sourceWarnings.length} production source files over warning limit ${warningLimit}`,
  );

  for (const { filePath, lines } of sourceWarnings.slice(0, 12)) {
    console.log(
      `large-files: ${lines.toString().padStart(5, ' ')} production-source ${filePath}`,
    );
  }

  console.log(
    `large-files: ${testWarningsOverLimit.length} test files over ${lineLimit} lines; ${testWarnings.length} test files over warning limit ${warningLimit}`,
  );

  for (const { filePath, lines } of testWarnings.slice(0, 12)) {
    console.log(
      `large-files: ${lines.toString().padStart(5, ' ')} test ${filePath}`,
    );
  }

  if (classifiedWarnings.length > 0) {
    console.log(
      `large-files: ${classifiedWarningsOverLimit.length} classified files over ${lineLimit} lines; ${classifiedWarnings.length} classified files over warning limit ${warningLimit}`,
    );
    for (const { filePath, lines } of classifiedWarnings.slice(0, 12)) {
      const entry = classifications[filePath];
      console.log(
        `large-files: ${lines.toString().padStart(5, ' ')} classified ${entry.category} ${filePath}`,
      );
    }
  }
}

if (outputJson) {
  emitJsonSummary();
} else {
  emitTextSummary();
}

if (errors.length > 0) {
  if (!outputJson) {
    console.error('large-files: failed');
    for (const error of errors) {
      console.error(`large-files: ${error}`);
    }
  }
  process.exit(1);
}

if (!outputJson) {
  console.log('large-files: classification check passed');
}
