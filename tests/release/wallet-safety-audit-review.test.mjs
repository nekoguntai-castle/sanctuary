import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchesClassifierPath } from '../../scripts/ci/check-wallet-safety-classifier.mjs';
import {
  AUDIT_SCHEMA_VERSION,
  REVIEW_SCHEMA_VERSION,
  isWalletSafetyRelevantPath,
  loadWalletSafetyCriticalPaths,
  validateReviewEvidence,
  verifyWalletSafetyReview,
} from '../../scripts/release/verify-wallet-safety-audit-review.mjs';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-08-09T12:00:00.000Z');
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function validEvidence() {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourceCommit: HEAD,
    audit: {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      generatedAt: '2026-08-08T10:00:00.000Z',
      result: 'clean',
      exitCode: 0,
      findingCount: 0,
      reportSha256: 'b'.repeat(64),
      operatorId: 'audit-operator',
    },
    review: {
      decision: 'approved',
      reviewedAt: '2026-08-08T11:00:00.000Z',
      reviewerId: 'independent-reviewer',
      reference: 'release-review-123',
    },
  };
}

function validate(evidence) {
  return validateReviewEvidence(evidence, {
    headCommit: HEAD,
    maxAgeDays: 7,
    now: NOW,
  });
}

function assertReleaseCandidateRequiresEvidence(context, changedPath) {
  const fixture = mkdtempSync(resolve(tmpdir(), 'sanctuary-wallet-safety-rc-'));
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(resolve(fixture, 'config'), { recursive: true });
  writeFileSync(
    resolve(fixture, 'config/wallet-safety-critical-paths.json'),
    readFileSync(resolve(REPO_ROOT, 'config/wallet-safety-critical-paths.json')),
  );
  writeFileSync(resolve(fixture, 'README.md'), 'fixture\n');
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: fixture });
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: fixture });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8' }).trim();
  mkdirSync(resolve(fixture, changedPath, '..'), { recursive: true });
  writeFileSync(resolve(fixture, changedPath), 'export {};\n');
  execFileSync('git', ['add', '.'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'wallet-safety change'], { cwd: fixture });

  assert.throws(() => verifyWalletSafetyReview({
    repo: fixture,
    base,
    head: 'HEAD',
    maxAgeDays: 7,
    now: NOW,
  }), /review evidence is required/);
}

test('accepts fresh independent clean-audit review evidence', () => {
  assert.deepEqual(validate(validEvidence()), validEvidence());
});

test('pins review receipts to the current v2 audit schema', () => {
  assert.equal(AUDIT_SCHEMA_VERSION, 'sanctuary.wallet-safety-audit.v2');
  const evidence = validEvidence();
  evidence.audit.schemaVersion = 'sanctuary.wallet-safety-audit.v1';
  assert.throws(() => validate(evidence), /unsupported audit schema version/);
});

test('root audit command invokes the CLI directly so npm forwards arguments once', () => {
  const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['audit:wallet-safety'],
    'tsx server/scripts/audit-wallet-safety.ts',
  );
});

test('accepts explicitly reviewed findings with audit exit code 2', () => {
  const evidence = validEvidence();
  evidence.audit.result = 'findings_reviewed';
  evidence.audit.exitCode = 2;
  evidence.audit.findingCount = 4;
  assert.deepEqual(validate(evidence), evidence);
});

test('rejects schema, commit, result, reviewer, and freshness drift', () => {
  const cases = [
    (evidence) => { evidence.schemaVersion = 'old'; },
    (evidence) => { evidence.sourceCommit = 'c'.repeat(40); },
    (evidence) => { evidence.audit.exitCode = 2; },
    (evidence) => { evidence.review.reviewerId = evidence.audit.operatorId; },
    (evidence) => { evidence.review.decision = 'rejected'; },
    (evidence) => {
      evidence.audit.generatedAt = '2026-07-01T10:00:00.000Z';
      evidence.review.reviewedAt = '2026-07-01T11:00:00.000Z';
    },
  ];
  for (const mutate of cases) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.throws(() => validate(evidence));
  }
});

test('rejects unreviewed, future, malformed hash, and unexpected sensitive fields', () => {
  const cases = [
    (evidence) => { evidence.review.reviewedAt = '2026-08-08T09:00:00.000Z'; },
    (evidence) => { evidence.audit.generatedAt = '2026-08-10T10:00:00.000Z'; },
    (evidence) => { evidence.audit.reportSha256 = 'not-a-hash'; },
    (evidence) => { evidence.audit.descriptor = 'wpkh(recovery-material)'; },
  ];
  for (const mutate of cases) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.throws(() => validate(evidence));
  }
});

test('every canonical critical-path pattern is release-relevant', () => {
  const criticalPaths = loadWalletSafetyCriticalPaths(REPO_ROOT);
  const repositoryFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  for (const pattern of criticalPaths) {
    const representative = repositoryFiles.find((path) => matchesClassifierPath(path, pattern));
    assert.ok(representative, `canonical pattern does not resolve: ${pattern}`);
    assert.equal(
      isWalletSafetyRelevantPath(representative, criticalPaths),
      true,
      `${pattern} is absent from release scope`,
    );
  }
});

test('independent funds-safety inventory is present and covered by canonical scope', () => {
  const inventory = JSON.parse(readFileSync(
    resolve(REPO_ROOT, 'tests/fixtures/wallet-safety-required-files.json'),
    'utf8',
  ));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.pr2aCommit, '1bfbaaf9a0fdc99e61c7ee5030fe569624c55ce2');
  assert.equal(inventory.pr2aFundsSafetyFiles.length, 32);
  assert.equal(inventory.existingFundsSafetyFiles.length, 52);

  const criticalPaths = loadWalletSafetyCriticalPaths(REPO_ROOT);
  const repositoryFiles = new Set(execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).split('\n').filter(Boolean));
  const requiredFiles = [
    ...inventory.pr2aFundsSafetyFiles,
    ...inventory.existingFundsSafetyFiles,
  ];
  assert.equal(new Set(requiredFiles).size, requiredFiles.length, 'inventory files must be unique');

  for (const path of requiredFiles) {
    assert.ok(repositoryFiles.has(path), `required funds-safety file does not exist: ${path}`);
    assert.equal(
      isWalletSafetyRelevantPath(path, criticalPaths),
      true,
      `required funds-safety file is outside canonical scope: ${path}`,
    );
  }
});

test('covers representative repository, root-router, capability, and signing paths', () => {
  const criticalPaths = loadWalletSafetyCriticalPaths(REPO_ROOT);
  const expectedPatterns = [
    'server/src/services/deviceAccountConflicts.ts',
    'server/src/services/draftSigning.ts',
    'src/components/send/**',
    'src/components/qr/**',
    'src/contexts/send/**',
    'src/services/deviceParsers/**',
    'src/components/AgentManagement/**',
    'src/api/walletXpub.ts',
    'src/api/wallets.ts',
    'src/api/devices.ts',
    'shared/schemas/deviceIdentity.ts',
  ];
  for (const pattern of expectedPatterns) assert.ok(criticalPaths.includes(pattern), pattern);
  const relevant = [
    'server/src/repositories/walletRepository.ts',
    'server/src/api/transactions.ts',
    'server/src/api/bitcoin.ts',
    'server/src/api/wallets.ts',
    'server/src/api/devices.ts',
    'shared/constants/hardwareWalletCapabilities.ts',
    'src/hooks/send/useUsbSigning.ts',
    'src/components/send/steps/review/SigningFlow.tsx',
    'src/components/qr/QRSigningModal/useQRSigningModalController.ts',
    'src/contexts/send/reducerParts/signing.ts',
    'server/src/services/deviceAccountRegistration.ts',
    'server/src/services/deviceAccountConflicts.ts',
    'server/src/services/draftSigning.ts',
  ];
  for (const path of relevant) {
    assert.equal(isWalletSafetyRelevantPath(path, criticalPaths), true, path);
  }
  assert.equal(isWalletSafetyRelevantPath('src/components/Dashboard.tsx', criticalPaths), false);
  assert.equal(isWalletSafetyRelevantPath('docs/reference/release-gates.md', criticalPaths), false);
});

test('release-candidate scope blocks USB-signing changes without review evidence', (context) => {
  assertReleaseCandidateRequiresEvidence(context, 'src/hooks/send/useUsbSigning.ts');
});

test('release-candidate scope blocks SigningFlow changes without review evidence', (context) => {
  assertReleaseCandidateRequiresEvidence(
    context,
    'src/components/send/steps/review/SigningFlow/SigningMethodControls.tsx',
  );
});

test('release-candidate scope blocks raw operational-xpub changes without review evidence', (context) => {
  assertReleaseCandidateRequiresEvidence(context, 'src/api/walletXpub.ts');
});

// --- single-maintainer attestation -------------------------------------------------
//
// A two-person review is unsatisfiable on a single-maintainer repository. What that rule
// actually prevents is rubber-stamping: approving your own audit in the same breath as
// producing it. The single-maintainer path keeps that protection by requiring the review
// to be a separate, explicitly attested act, separated in time.

function selfReviewedEvidence(overrides = {}) {
  const evidence = validEvidence();
  evidence.audit.operatorId = 'solo-maintainer';
  evidence.review.reviewerId = 'solo-maintainer';
  evidence.review.selfReviewAttestation = 'No second maintainer exists for this repository.';
  return { ...evidence, ...overrides };
}

test('rejects a self-review with no attestation', () => {
  const evidence = selfReviewedEvidence();
  delete evidence.review.selfReviewAttestation;

  assert.throws(() => validate(evidence), /reviewer must be independent/);
});

test('accepts a self-review carrying an explicit attestation and a real interval', () => {
  const evidence = selfReviewedEvidence();
  // Generated 10:00, reviewed 11:00 — an hour apart.
  assert.equal(validate(evidence).review.reviewerId, 'solo-maintainer');
});

test('rejects a self-review approved in the same breath as the audit', () => {
  const evidence = selfReviewedEvidence();
  evidence.review.reviewedAt = evidence.audit.generatedAt;

  assert.throws(() => validate(evidence), /separate review/);
});

test('rejects an empty or whitespace attestation', () => {
  const evidence = selfReviewedEvidence();
  evidence.review.selfReviewAttestation = '   ';

  assert.throws(() => validate(evidence), /attestation/);
});

test('ignores the attestation when the reviewer is genuinely independent', () => {
  // Two identities remain the preferred path and must not require the extra field.
  const evidence = validEvidence();
  assert.equal(validate(evidence).review.reviewerId, 'independent-reviewer');
});
