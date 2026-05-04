#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error(
    'Usage: node scripts/quality/check-semgrep-baseline.mjs <semgrep-json> <baseline-json>',
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function normalizePath(filePath) {
  if (path.isAbsolute(filePath)) {
    const relativePath = path.relative(process.cwd(), filePath);
    if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
      return relativePath.split(path.sep).join('/');
    }
  }

  return filePath.split(path.sep).join('/').replace(/^\.\//u, '');
}

function keyForFinding({ id, path: filePath, sha256 }) {
  return [id, normalizePath(filePath), sha256].join('\0');
}

function normalizeSource(source) {
  return source.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function sourceForFinding(filePath, startLine, endLine) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source.split(/\r?\n/).slice(startLine - 1, endLine).join('\n');
}

function fingerprint({ id, path: filePath, source }) {
  return crypto
    .createHash('sha256')
    .update([id, normalizePath(filePath), normalizeSource(source)].join('\0'))
    .digest('hex');
}

function semgrepFinding(result) {
  const finding = {
    id: result.check_id,
    path: normalizePath(result.path),
    startLine: result.start?.line,
    endLine: result.end?.line,
    severity: result.extra?.severity ?? 'UNKNOWN',
    message: result.extra?.message ?? '',
  };

  let sha256 = '';
  if (
    typeof finding.id === 'string' &&
    finding.id.length > 0 &&
    typeof finding.path === 'string' &&
    finding.path.length > 0 &&
    Number.isInteger(finding.startLine) &&
    finding.startLine >= 1 &&
    Number.isInteger(finding.endLine) &&
    finding.endLine >= finding.startLine
  ) {
    sha256 = fingerprint({
      id: finding.id,
      path: finding.path,
      source: sourceForFinding(finding.path, finding.startLine, finding.endLine),
    });
  }

  return {
    ...finding,
    sha256,
  };
}

function baselineFinding(entry) {
  return {
    id: entry.id,
    path: normalizePath(entry.path),
    startLine: entry.startLine,
    endLine: entry.endLine,
    reason: entry.reason ?? '',
    sha256: entry.sha256,
  };
}

function formatFinding(finding) {
  return `${finding.id} ${finding.path}:${finding.startLine}-${finding.endLine}`;
}

function validateFindingShape(finding, label) {
  const errors = [];
  if (typeof finding.id !== 'string' || finding.id.length === 0) {
    errors.push(`${label} is missing id`);
  }
  if (typeof finding.path !== 'string' || finding.path.length === 0) {
    errors.push(`${label} is missing path`);
  }
  if (!Number.isInteger(finding.startLine) || finding.startLine < 1) {
    errors.push(`${label} has invalid startLine`);
  }
  if (!Number.isInteger(finding.endLine) || finding.endLine < finding.startLine) {
    errors.push(`${label} has invalid endLine`);
  }
  if (typeof finding.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(finding.sha256)) {
    errors.push(`${label} has invalid sha256`);
  }
  return errors;
}

function main(argv) {
  const [semgrepJsonPath, baselineJsonPath] = argv;
  if (!semgrepJsonPath || !baselineJsonPath) {
    usage();
    return 2;
  }

  const semgrepReport = readJson(semgrepJsonPath);
  const baseline = readJson(baselineJsonPath);
  const results = Array.isArray(semgrepReport.results) ? semgrepReport.results : [];
  const entries = Array.isArray(baseline.entries) ? baseline.entries : [];
  const errors = [];

  if (baseline.version !== 2) {
    errors.push('baseline version must be 2 for source-fingerprint matching');
  }

  const currentFindings = results.map(semgrepFinding);
  const baselineFindings = entries.map(baselineFinding);
  const currentByKey = new Map();
  const baselineByKey = new Map();

  currentFindings.forEach((finding, index) => {
    errors.push(...validateFindingShape(finding, `Semgrep result ${index + 1}`));
    const key = keyForFinding(finding);
    if (currentByKey.has(key)) {
      errors.push(`Duplicate Semgrep finding key: ${formatFinding(finding)}`);
    }
    currentByKey.set(key, finding);
  });

  baselineFindings.forEach((finding, index) => {
    const label = `baseline entry ${index + 1}`;
    errors.push(...validateFindingShape(finding, label));
    const key = keyForFinding(finding);
    if (baselineByKey.has(key)) {
      errors.push(`Duplicate baseline finding key: ${formatFinding(finding)}`);
    }
    baselineByKey.set(key, finding);
  });

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`semgrep-baseline: ${error}`);
    }
    return 1;
  }

  const unbaselined = currentFindings.filter((finding) => !baselineByKey.has(keyForFinding(finding)));
  const stale = baselineFindings.filter((finding) => !currentByKey.has(keyForFinding(finding)));

  for (const finding of unbaselined) {
    console.error(
      `::error file=${finding.path},line=${finding.startLine}::Unbaselined Semgrep finding: ${finding.id}`,
    );
    console.error(`semgrep-baseline: new finding ${formatFinding(finding)}`);
  }

  for (const finding of stale) {
    console.error(
      `::error file=${finding.path},line=${finding.startLine}::Stale Semgrep baseline entry: ${finding.id}`,
    );
    console.error(`semgrep-baseline: stale baseline entry ${formatFinding(finding)}`);
  }

  if (unbaselined.length > 0 || stale.length > 0) {
    console.error(
      `semgrep-baseline: failed with ${unbaselined.length} new finding(s) and ${stale.length} stale baseline entries`,
    );
    return 1;
  }

  console.log(
    `semgrep-baseline: ${currentFindings.length} finding(s), all covered by ${baselineFindings.length} baseline entries`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`semgrep-baseline: ${error.message}`);
  process.exitCode = 1;
}
