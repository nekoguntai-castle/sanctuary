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
  return filePath.split(path.sep).join('/');
}

function keyForFinding({ id, path: filePath, startLine, endLine }) {
  return [id, normalizePath(filePath), startLine, endLine].join('\0');
}

function fingerprint(finding) {
  return crypto.createHash('sha256').update(keyForFinding(finding)).digest('hex');
}

function semgrepFinding(result) {
  return {
    id: result.check_id,
    path: normalizePath(result.path),
    startLine: result.start?.line,
    endLine: result.end?.line,
    severity: result.extra?.severity ?? 'UNKNOWN',
    message: result.extra?.message ?? '',
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
    const expectedHash = fingerprint(finding);
    if (finding.sha256 !== expectedHash) {
      errors.push(
        `${label} has invalid sha256 for ${formatFinding(finding)}; expected ${expectedHash}`,
      );
    }
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
