import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CANARY_RECEIPT_MAX_BYTES,
  CANARY_RECEIPT_SCHEMA_VERSION,
  CANARY_RECEIPT_V2_SCHEMA_VERSION,
  validateCanaryReceipt,
  verifyReleaseCandidateCanary,
} from '../../scripts/release/verify-release-candidate-canary.mjs';

const TAG = 'v0.8.68-rc2';
const V2_TAG = 'v0.8.69-rc14';
const COMMIT = 'a'.repeat(40);
const NOW = new Date('2026-08-27T12:00:00.000Z');
const SCRIPT = fileURLToPath(new URL(
  '../../scripts/release/verify-release-candidate-canary.mjs',
  import.meta.url,
));

function validReceipt() {
  return {
    schemaVersion: CANARY_RECEIPT_SCHEMA_VERSION,
    releaseCandidate: { tag: TAG, commit: COMMIT },
    canaryWindow: {
      startedAt: '2026-08-27T09:00:00.000Z',
      completedAt: '2026-08-27T10:00:00.000Z',
    },
    fleet: {
      total: 12,
      outcomes: { success: 10, retrying: 1, actionRequired: 1 },
      actionRequiredWithExplicitReason: 1,
      previouslyStaleRepeat: { outcome: 'success', stranded: false },
    },
    progressEvidence: {
      phaseObserved: true,
      liveElapsedObserved: true,
      knownCountsObserved: { addresses: true, candidates: true, batches: true },
      liveSyncLogObserved: true,
    },
    diagnosticsEvidence: {
      versionsObserved: [1, 2],
      preflightActiveObserved: true,
      addressHistoryActiveObserved: true,
      redisLockAgreementObserved: true,
      terminalActiveTotal: 0,
    },
    metricEvidence: {
      activeStageAgeObserved: true,
      counterFamiliesObserved: [
        'abort_grace_exhausted', 'budget_expiry', 'candidates', 'cleanup',
        'fallback', 'lock_loss', 'terminal',
      ],
    },
    boundedErrorEvidence: {
      candidateBatch: { startCompleted: 1, endCompleted: 25, total: 100 },
      outcome: 'advanced',
      withinBudgetAndGrace: true,
      silentHang: false,
    },
    signoff: {
      decision: 'accepted',
      signedAt: '2026-08-27T10:30:00.000Z',
      operatorId: 'release-operator-01',
    },
  };
}

function validV2Receipt(rawEvidence) {
  return {
    ...validReceipt(),
    schemaVersion: CANARY_RECEIPT_V2_SCHEMA_VERSION,
    releaseCandidate: {
      tag: V2_TAG,
      commit: COMMIT,
      imageIds: [`sha256:${'b'.repeat(64)}`],
    },
    remoteEvidence: {
      probeWindowMs: 600_000,
      postTerminalWindowMs: 300_000,
      endpoints: Object.fromEntries(['live', 'ready', 'metricsPrometheus'].map(name => [name, {
        samples: 600, postTerminalSamples: 300, failures: 0, p99Ms: 125, maxMs: 500,
      }])),
      runtime: {
        peakBytes: 670_466_048, memoryLimitBytes: 1_073_741_824,
        oomKilled: false, restartCount: 0, exitCode: 0, fallbackCount: 0,
      },
      lifecycle: {
        leaseLockAgreement: true, leasesAndLocksCleared: true,
        generationsConverged: true, formerlyStaleRepeatConverged: true,
        uiHealthyThroughoutPostTerminal: true,
      },
      rawEvidence,
    },
  };
}

function validate(receipt) {
  return validateCanaryReceipt(receipt, { tag: TAG, commit: COMMIT, now: NOW });
}

function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), 'sanctuary-canary-'));
  const repo = path.join(base, 'checkout');
  const evidence = path.join(base, 'private-evidence');
  mkdirSync(repo);
  mkdirSync(evidence);
  return { base, repo, evidence, receipt: path.join(evidence, 'receipt.json') };
}

function writeReceipt(target, receipt = validReceipt()) {
  writeFileSync(target, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}

test('accepts a complete strict receipt for the exact RC identity', () => {
  const receipt = validReceipt();
  assert.deepEqual(validate(receipt), receipt);
  receipt.diagnosticsEvidence.versionsObserved = [2];
  receipt.fleet.previouslyStaleRepeat.outcome = 'retrying';
  receipt.boundedErrorEvidence.outcome = 'retryable';
  receipt.boundedErrorEvidence.candidateBatch.endCompleted = 1;
  assert.deepEqual(validate(receipt), receipt);
});

test('v2 requires strict remote summaries and rejects v1 for v0.8.69', () => {
  const receipt = validV2Receipt({ sha256: 'c'.repeat(64), bytes: 1024 });
  assert.deepEqual(validateCanaryReceipt(receipt, {
    tag: V2_TAG, commit: COMMIT, now: NOW,
  }), receipt);
  for (const mutate of [
    value => { value.remoteEvidence.endpoints.live.failures = 1; },
    value => { value.remoteEvidence.endpoints.ready.p99Ms = 251; },
    value => { value.remoteEvidence.endpoints.metricsPrometheus.postTerminalSamples = 299; },
    value => { value.remoteEvidence.endpoints.live.samples = 300; },
    value => { value.remoteEvidence.probeWindowMs = 300_000; },
    value => { value.canaryWindow.startedAt = '2026-08-27T09:55:00.000Z'; },
    value => { value.remoteEvidence.runtime.peakBytes = 0; },
    value => { value.remoteEvidence.runtime.oomKilled = true; },
    value => { value.remoteEvidence.lifecycle.leasesAndLocksCleared = false; },
    value => { value.remoteEvidence.rawEvidence.sha256 = 'not-a-digest'; },
  ]) {
    const invalid = structuredClone(receipt);
    mutate(invalid);
    assert.throws(() => validateCanaryReceipt(invalid, {
      tag: V2_TAG, commit: COMMIT, now: NOW,
    }));
  }
  assert.throws(() => validateCanaryReceipt({
    ...validReceipt(), releaseCandidate: { tag: V2_TAG, commit: COMMIT },
  }, { tag: V2_TAG, commit: COMMIT, now: NOW }), /v2/);
  assert.throws(() => validateCanaryReceipt({
    ...validReceipt(), releaseCandidate: { tag: 'v0.8.70-rc1', commit: COMMIT },
  }, { tag: 'v0.8.70-rc1', commit: COMMIT, now: NOW }), /v2/);
});

test('v2 verification binds the receipt to a private raw evidence sidecar', (context) => {
  const files = fixture();
  context.after(() => rmSync(files.base, { recursive: true, force: true }));
  const rawEvidencePath = path.join(files.evidence, 'raw.jsonl');
  const rawEvidence = '{"event":"probe","status":200}\n';
  writeFileSync(rawEvidencePath, rawEvidence, { mode: 0o600 });
  const receipt = validV2Receipt({
    sha256: createHash('sha256').update(rawEvidence).digest('hex'),
    bytes: Buffer.byteLength(rawEvidence),
  });
  writeReceipt(files.receipt, receipt);
  assert.deepEqual(verifyReleaseCandidateCanary({
    repo: files.repo, receipt: files.receipt, evidence: rawEvidencePath,
    tag: V2_TAG, commit: COMMIT, now: NOW,
  }), receipt);
  writeFileSync(rawEvidencePath, `${rawEvidence}{"event":"drift"}\n`);
  assert.throws(() => verifyReleaseCandidateCanary({
    repo: files.repo, receipt: files.receipt, evidence: rawEvidencePath,
    tag: V2_TAG, commit: COMMIT, now: NOW,
  }), /identity/);
});

test('rejects unknown and missing keys at every schema depth', () => {
  const cases = [
    (value) => { value.walletId = 'private-wallet'; },
    (value) => { delete value.metricEvidence; },
    (value) => { value.releaseCandidate.txid = 'b'.repeat(64); },
    (value) => { delete value.canaryWindow.completedAt; },
    (value) => { value.fleet.outcomes.other = 0; },
    (value) => { value.progressEvidence.knownCountsObserved.names = true; },
    (value) => { value.diagnosticsEvidence.endpoint = 'private.example'; },
    (value) => { value.boundedErrorEvidence.notes = 'secret'; },
    (value) => { value.signoff.name = 'Operator Name'; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt), /schema/);
  }
});

test('rejects schema, tag, commit, and expected identity drift', () => {
  const cases = [
    (value, options) => { value.schemaVersion = 'old'; },
    (value, options) => { value.releaseCandidate.tag = 'v0.8.69'; },
    (value, options) => { value.releaseCandidate.tag = 'v0.8.69-rc.2'; },
    (value, options) => { value.releaseCandidate.commit = 'A'.repeat(40); },
    (value, options) => { options.tag = 'v0.8.69-rc3'; },
    (value, options) => { options.commit = 'b'.repeat(40); },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    const options = { tag: TAG, commit: COMMIT, now: NOW };
    mutate(receipt, options);
    assert.throws(() => validateCanaryReceipt(receipt, options));
  }
});

test('rejects malformed, inconsistent, and future timestamps', () => {
  const cases = [
    (value) => { value.canaryWindow.startedAt = '2026-08-27'; },
    (value) => { value.canaryWindow.startedAt = '2026-08-27T10:00:01.000Z'; },
    (value) => { value.signoff.signedAt = '2026-08-27T09:59:59.000Z'; },
    (value) => { value.signoff.signedAt = '2026-08-27T13:00:00.000Z'; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt));
  }
});

test('rejects fleet count and stale-repeat failures', () => {
  const cases = [
    (value) => { value.fleet.total = 11; },
    (value) => { value.fleet.total = 12.5; },
    (value) => { value.fleet.outcomes.success = -1; },
    (value) => { value.fleet.outcomes.success = 9; },
    (value) => { value.fleet.actionRequiredWithExplicitReason = 0; },
    (value) => { value.fleet.actionRequiredWithExplicitReason = 1.5; },
    (value) => { value.fleet.previouslyStaleRepeat.outcome = 'unknown'; },
    (value) => { value.fleet.previouslyStaleRepeat.stranded = true; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt));
  }
});

test('rejects every incomplete progress and diagnostics assertion', () => {
  const cases = [
    (value) => { value.progressEvidence.phaseObserved = false; },
    (value) => { value.progressEvidence.liveElapsedObserved = false; },
    (value) => { value.progressEvidence.knownCountsObserved.addresses = false; },
    (value) => { value.progressEvidence.knownCountsObserved.candidates = false; },
    (value) => { value.progressEvidence.knownCountsObserved.batches = false; },
    (value) => { value.progressEvidence.liveSyncLogObserved = false; },
    (value) => { value.diagnosticsEvidence.versionsObserved = [1]; },
    (value) => { value.diagnosticsEvidence.versionsObserved = [2, 2]; },
    (value) => { value.diagnosticsEvidence.preflightActiveObserved = false; },
    (value) => { value.diagnosticsEvidence.addressHistoryActiveObserved = false; },
    (value) => { value.diagnosticsEvidence.redisLockAgreementObserved = false; },
    (value) => { value.diagnosticsEvidence.terminalActiveTotal = 1; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt));
  }
});

test('rejects incomplete metrics and bounded-error evidence', () => {
  const cases = [
    (value) => { value.metricEvidence.activeStageAgeObserved = false; },
    (value) => { value.metricEvidence.counterFamiliesObserved.pop(); },
    (value) => { value.metricEvidence.counterFamiliesObserved[0] = 'terminal'; },
    (value) => { value.boundedErrorEvidence.candidateBatch.startCompleted = 0; },
    (value) => { value.boundedErrorEvidence.candidateBatch.endCompleted = 26; },
    (value) => { value.boundedErrorEvidence.candidateBatch.total = 99; },
    (value) => { value.boundedErrorEvidence.outcome = 'silent'; },
    (value) => { value.boundedErrorEvidence.candidateBatch.endCompleted = 1; },
    (value) => { value.boundedErrorEvidence.withinBudgetAndGrace = false; },
    (value) => { value.boundedErrorEvidence.silentHang = true; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt));
  }
});

test('rejects absent or invalid complete signoff', () => {
  const cases = [
    (value) => { value.signoff.decision = 'rejected'; },
    (value) => { value.signoff.operatorId = 'Operator Name'; },
    (value) => { value.signoff.operatorId = 'x'; },
  ];
  for (const mutate of cases) {
    const receipt = validReceipt();
    mutate(receipt);
    assert.throws(() => validate(receipt));
  }
});

test('reads a bounded regular receipt only from outside the checkout', (context) => {
  const files = fixture();
  context.after(() => rmSync(files.base, { recursive: true, force: true }));
  writeReceipt(files.receipt);
  assert.deepEqual(verifyReleaseCandidateCanary({
    repo: files.repo, receipt: files.receipt, tag: TAG, commit: COMMIT, now: NOW,
  }), validReceipt());

  const inside = path.join(files.repo, 'receipt.json');
  writeReceipt(inside);
  assert.throws(() => verifyReleaseCandidateCanary({
    repo: files.repo, receipt: inside, tag: TAG, commit: COMMIT, now: NOW,
  }), /outside/);
  assert.throws(() => verifyReleaseCandidateCanary({
    repo: files.repo, receipt: 'relative.json', tag: TAG, commit: COMMIT, now: NOW,
  }), /absolute/);
});

test('rejects symlinks, directories, missing, oversized, and invalid JSON receipts', (context) => {
  const files = fixture();
  context.after(() => rmSync(files.base, { recursive: true, force: true }));
  const inside = path.join(files.repo, 'inside.json');
  writeReceipt(inside);
  const link = path.join(files.evidence, 'linked.json');
  symlinkSync(inside, link);
  const options = { repo: files.repo, receipt: link, tag: TAG, commit: COMMIT, now: NOW };
  assert.throws(() => verifyReleaseCandidateCanary(options), /non-symlink/);
  assert.throws(() => verifyReleaseCandidateCanary({ ...options, receipt: files.evidence }), /regular/);
  assert.throws(() => verifyReleaseCandidateCanary({
    ...options, receipt: path.join(files.evidence, 'missing.json'),
  }), /safely/);
  writeFileSync(files.receipt, 'x'.repeat(CANARY_RECEIPT_MAX_BYTES + 1));
  assert.throws(() => verifyReleaseCandidateCanary({ ...options, receipt: files.receipt }), /large/);
  writeFileSync(files.receipt, '{private-wallet-secret');
  assert.throws(() => verifyReleaseCandidateCanary({ ...options, receipt: files.receipt }), (error) => (
    /invalid JSON/.test(error.message) && !error.message.includes('private-wallet-secret')
  ));
});

test('CLI requires exact arguments and reports acceptance without receipt contents', (context) => {
  const files = fixture();
  context.after(() => rmSync(files.base, { recursive: true, force: true }));
  writeReceipt(files.receipt);
  const args = [
    SCRIPT, '--repo', files.repo, '--receipt', files.receipt,
    '--tag', TAG, '--commit', COMMIT,
  ];
  assert.match(execFileSync(process.execPath, args, { encoding: 'utf8' }), /accepted/);
  const duplicate = spawnSync(process.execPath, [...args, '--tag', TAG], { encoding: 'utf8' });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /invalid arguments/);
  assert.doesNotMatch(duplicate.stderr, /release-operator-01/);
});
