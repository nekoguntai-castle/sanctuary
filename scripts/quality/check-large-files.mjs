#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.env.QUALITY_ROOT ?? process.cwd();
const configPath = path.join(root, 'scripts/quality/large-file-classification.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const lineLimit = Number(config.lineLimit ?? 1000);
const warningLimit = Number(config.warningLimit ?? 800);
const classifications = config.classifications ?? {};

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
const excludedGeneratedPrefixes = [
  'server/src/generated/prisma/',
];
const codeFilePattern = /\.(?:cjs|js|mjs|ts|tsx)$/;
const allowedCategories = new Set(['proof-harness', 'generated-output', 'test-fixture']);
const reviewDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isScannedCodeFile(filePath) {
  if (!codeFilePattern.test(filePath)) {
    return false;
  }

  return !isExcludedPath(filePath);
}

function isExcludedPath(filePath) {
  return (
    excludedPrefixes.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix)) ||
    excludedSegments.some((segment) => filePath.includes(segment)) ||
    excludedGeneratedPrefixes.some((prefix) => filePath.startsWith(prefix))
  );
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');

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

  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

const trackedFiles = walk(root);

const oversized = trackedFiles
  .map((filePath) => ({ filePath, lines: countLines(filePath) }))
  .filter(({ lines }) => lines > warningLimit)
  .sort((a, b) => b.lines - a.lines);

const oversizedOverLimit = oversized.filter(({ lines }) => lines > lineLimit);
const unclassifiedWarnings = oversized.filter(({ filePath }) => !classifications[filePath]);
const unclassifiedWarningsOverLimit = unclassifiedWarnings.filter(({ lines }) => lines > lineLimit);
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
    errors.push(`classified file has invalid category ${entry.category}: ${filePath}`);
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

  if (typeof entry.lastReviewed !== 'string' || !reviewDatePattern.test(entry.lastReviewed)) {
    errors.push(`classified file needs lastReviewed date YYYY-MM-DD: ${filePath}`);
  }
}

for (const { filePath, lines } of oversizedOverLimit) {
  if (!classifications[filePath]) {
    errors.push(`unclassified oversized file: ${filePath} (${lines} lines > ${lineLimit})`);
  }
}

if (unclassifiedWarnings.length > 0) {
  console.log(`large-files: ${unclassifiedWarningsOverLimit.length} unclassified files over ${lineLimit} lines; ${unclassifiedWarnings.length} unclassified files over warning limit ${warningLimit}`);

  for (const { filePath, lines } of unclassifiedWarnings.slice(0, 12)) {
    console.log(`large-files: ${lines.toString().padStart(5, ' ')} production-or-unclassified ${filePath}`);
  }
}

if (errors.length > 0) {
  console.error('large-files: failed');
  for (const error of errors) {
    console.error(`large-files: ${error}`);
  }
  process.exit(1);
}

console.log('large-files: classification check passed');
