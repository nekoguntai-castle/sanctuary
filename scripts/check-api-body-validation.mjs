#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiDir = path.join(root, 'server/src/api');

const routeStartPattern = /^\s*(?:[A-Za-z_$][\w$]*Router|router)\.(?:post|put|patch|delete|all)\s*\(/;
const safeSegmentPatterns = [
  /validate\s*\(\s*\{\s*body/s,
  /\bparse[A-Za-z]*RequestBody\s*\(/s,
  /\bparseNodeConfigBody\s*\(/s,
  /\bparseNodeConfigTestBody\s*\(/s,
  /\bvalidatePermissionInput\s*\(/s,
  /\breadPriority\s*\(/s,
  /\bsafeParse\s*\(\s*req\.body\s*\)/s,
];
const safeWindowPatterns = [
  /\bparse[A-Za-z]*RequestBody\s*\([\s\S]*req\.body/s,
  /\bparseNodeConfigBody\s*\([\s\S]*req\.body/s,
  /\bparseNodeConfigTestBody\s*\([\s\S]*req\.body/s,
  /\bvalidatePermissionInput\s*\(\s*req\.body\s*\)/s,
  /\breadPriority\s*\(\s*req\.body\s*\)/s,
  /\bsafeParse\s*\(\s*req\.body\s*\)/s,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function toRepoPath(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function isCommentOnly(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function hasSafeEvidence(text) {
  return safeSegmentPatterns.some((pattern) => pattern.test(text));
}

function hasSafeWindowEvidence(lines, index) {
  const windowText = lines.slice(Math.max(0, index - 4), index + 2).join('\n');
  return safeWindowPatterns.some((pattern) => pattern.test(windowText));
}

function findRouteStart(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (routeStartPattern.test(lines[cursor])) {
      return cursor;
    }
  }
  return -1;
}

function isDocumentedException(repoPath, lines, index) {
  if (repoPath === 'server/src/api/auth.ts' && /req\.body\?\.username/.test(lines[index])) {
    return true;
  }

  if (repoPath === 'server/src/api/payjoin.ts') {
    const windowText = lines.slice(Math.max(0, index - 3), index + 2).join('\n');
    return /const originalPsbt = typeof req\.body === 'string'/.test(windowText);
  }

  return false;
}

const findings = [];

for (const file of walk(apiDir)) {
  const repoPath = toRepoPath(file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (!/\breq\.body\b/.test(line) || isCommentOnly(line)) {
      return;
    }

    if (isDocumentedException(repoPath, lines, index) || hasSafeWindowEvidence(lines, index)) {
      return;
    }

    const routeStart = findRouteStart(lines, index);
    const routeSegment = routeStart >= 0 ? lines.slice(routeStart, index + 1).join('\n') : '';
    if (hasSafeEvidence(routeSegment)) {
      return;
    }

    findings.push({
      file: repoPath,
      line: index + 1,
      snippet: line.trim(),
    });
  });
}

if (findings.length === 0) {
  console.log('api-body-validation: passed');
  process.exit(0);
}

console.error('api-body-validation: failed');
for (const finding of findings) {
  console.error(`- ${finding.file}:${finding.line} req.body is not covered by body validation or a documented parser-backed exception.`);
  console.error(`  ${finding.snippet}`);
}
process.exit(1);
