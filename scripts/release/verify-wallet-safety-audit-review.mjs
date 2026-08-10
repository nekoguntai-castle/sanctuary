#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesClassifierPath } from '../ci/check-wallet-safety-classifier.mjs';

export const REVIEW_SCHEMA_VERSION = 'sanctuary.wallet-safety-release-review.v1';
export const AUDIT_SCHEMA_VERSION = 'sanctuary.wallet-safety-audit.v1';

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) throw new Error(`${label} has an invalid schema`);
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

export function loadWalletSafetyCriticalPaths(repo) {
  const manifestPath = resolve(repo, 'config/wallet-safety-critical-paths.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('wallet-safety critical-path manifest is unreadable');
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.paths)
    || manifest.paths.length === 0
    || manifest.paths.some((path) => typeof path !== 'string' || path.length === 0)
    || new Set(manifest.paths).size !== manifest.paths.length) {
    throw new Error('wallet-safety critical-path manifest has an invalid schema');
  }
  return manifest.paths;
}

export function isWalletSafetyRelevantPath(path, criticalPaths) {
  return criticalPaths.some((pattern) => matchesClassifierPath(path, pattern));
}

function validateEvidenceIdentity(evidence, headCommit) {
  if (evidence.schemaVersion !== REVIEW_SCHEMA_VERSION) throw new Error('unsupported review schema version');
  if (evidence.audit.schemaVersion !== AUDIT_SCHEMA_VERSION) throw new Error('unsupported audit schema version');
  if (evidence.sourceCommit !== headCommit) throw new Error('audit evidence is for a different source commit');
  if (!/^[a-f0-9]{64}$/i.test(evidence.audit.reportSha256)) throw new Error('audit report SHA-256 is invalid');
  requireString(evidence.audit.operatorId, 'audit operator');
  requireString(evidence.review.reviewerId, 'reviewer');
  requireString(evidence.review.reference, 'review reference');
  if (evidence.audit.operatorId === evidence.review.reviewerId) throw new Error('audit reviewer must be independent');
  if (evidence.review.decision !== 'approved') throw new Error('audit review is not approved');
}

function validateAuditResult(audit) {
  const clean = audit.result === 'clean'
    && audit.exitCode === 0
    && audit.findingCount === 0;
  const reviewedFindings = audit.result === 'findings_reviewed'
    && audit.exitCode === 2
    && Number.isInteger(audit.findingCount)
    && audit.findingCount > 0;
  if (!clean && !reviewedFindings) throw new Error('audit result fields are inconsistent');
}

function validateEvidenceFreshness(evidence, options) {
  const now = options.now.getTime();
  const maximumAge = options.maxAgeDays * 24 * 60 * 60 * 1000;
  const generatedAt = parseTimestamp(evidence.audit.generatedAt, 'audit generatedAt');
  const reviewedAt = parseTimestamp(evidence.review.reviewedAt, 'review reviewedAt');
  if (reviewedAt < generatedAt) throw new Error('audit was reviewed before it was generated');
  if (generatedAt > now || reviewedAt > now) throw new Error('audit evidence timestamp is in the future');
  if (now - generatedAt > maximumAge || now - reviewedAt > maximumAge) {
    throw new Error('audit review evidence is stale');
  }
}

export function validateReviewEvidence(evidence, options) {
  exactKeys(evidence, ['schemaVersion', 'sourceCommit', 'audit', 'review'], 'review evidence');
  exactKeys(evidence.audit, [
    'schemaVersion', 'generatedAt', 'result', 'exitCode', 'findingCount',
    'reportSha256', 'operatorId',
  ], 'audit evidence');
  exactKeys(evidence.review, [
    'decision', 'reviewedAt', 'reviewerId', 'reference',
  ], 'reviewer evidence');
  validateEvidenceIdentity(evidence, options.headCommit);
  validateAuditResult(evidence.audit);
  validateEvidenceFreshness(evidence, options);
  return evidence;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('invalid arguments');
    values.set(key, value);
  }
  return {
    base: values.get('--base'),
    head: values.get('--head') ?? 'HEAD',
    evidence: values.get('--evidence'),
    maxAgeDays: Number(values.get('--max-age-days') ?? '7'),
    now: values.get('--now') ? new Date(values.get('--now')) : new Date(),
  };
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

export function verifyWalletSafetyReview(options) {
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays <= 0) throw new Error('max age must be positive');
  const repo = options.repo ?? process.cwd();
  const headCommit = git(repo, ['rev-parse', `${options.head}^{commit}`]);
  const baseCommit = options.base
    ? git(repo, ['rev-parse', `${options.base}^{commit}`])
    : '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const changed = git(repo, ['diff', '--name-only', baseCommit, headCommit])
    .split('\n').filter(Boolean);
  const criticalPaths = loadWalletSafetyCriticalPaths(repo);
  const relevant = changed.filter((path) => isWalletSafetyRelevantPath(path, criticalPaths));
  if (relevant.length === 0) return { required: false, relevantCount: 0 };
  if (!options.evidence) throw new Error('wallet-safety audit review evidence is required');
  const serialized = readFileSync(resolve(repo, options.evidence), 'utf8');
  let evidence;
  try {
    evidence = JSON.parse(serialized);
  } catch {
    throw new Error('wallet-safety audit review evidence is invalid JSON');
  }
  validateReviewEvidence(evidence, {
    headCommit,
    maxAgeDays: options.maxAgeDays,
    now: options.now,
  });
  return { required: true, relevantCount: relevant.length };
}

function main() {
  try {
    const result = verifyWalletSafetyReview({ ...parseArguments(process.argv.slice(2)) });
    const status = result.required ? 'accepted' : 'not required';
    process.stdout.write(`Wallet-safety audit review: ${status} (${result.relevantCount} relevant files).\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown verification error';
    process.stderr.write(`Wallet-safety release gate failed: ${message}.\n`);
    process.exitCode = 1;
    return;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
