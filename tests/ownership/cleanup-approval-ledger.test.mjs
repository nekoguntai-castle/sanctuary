import assert from 'node:assert/strict';
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';
import {
  clearPreReservationCleanupPointer, createCleanupLedger, finalizeApproval,
  initializeApprovalState, publishActiveCleanupPointer, readActiveCleanupPointer,
  readApprovalState, reserveApproval, tombstoneActiveCleanupPointer,
} from '../../scripts/ownership/cleanup-approval-ledger.mjs';
import {
  assertNoActiveCleanup, inspectDeploymentCleanupState,
} from '../../scripts/ownership/deployment-cleanup-gate.mjs';

const APPROVAL = 'a'.repeat(64);
const GENESIS = 'b'.repeat(64);
const FINAL_JOURNAL = 'c'.repeat(64);
const INVENTORY = 'd'.repeat(64);
const RECEIPT_CORE = 'e'.repeat(64);
const RECEIPT = '1'.repeat(64);
const SIGNATURE = '2'.repeat(64);
const CHECKSUM = '3'.repeat(64);

function fixture(approvalDigest = APPROVAL, runtimeDirectory) {
  const runtime = runtimeDirectory ?? mkdtempSync(path.join(os.tmpdir(), 'cleanup-ledger-'));
  chmodSync(runtime, 0o700);
  return createCleanupLedger({ runtimeDirectory: runtime, deploymentId: 'deploy-1', approvalDigest });
}

test('approval and active pointer follow exact durable lifecycle', () => {
  const ledger = fixture();
  const unused = initializeApprovalState(ledger, { transitionedAt: '2026-08-31T00:00:00.000Z' });
  assert.equal(unused.value.state, 'unused');
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T00:00:01.000Z',
  });
  assert.equal(active.value.journalGenesisDigest, GENESIS);
  assert.equal(Object.hasOwn(active.value, 'headDigest'), false);
  const reserved = reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: '2026-08-31T00:00:02.000Z',
  });
  const finalized = finalizeApproval(ledger, {
    expectedStateDigest: reserved.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, finalJournalDigest: FINAL_JOURNAL,
    inventoryAfterDigest: INVENTORY, receiptCoreDigest: RECEIPT_CORE,
    terminalOutcome: 'cleaned', transitionedAt: '2026-08-31T00:00:03.000Z',
  });
  const tombstone = tombstoneActiveCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, expectedStateDigest: finalized.digest,
    operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    receiptDigest: RECEIPT, signatureDigest: SIGNATURE, checksumDigest: CHECKSUM,
    transitionedAt: '2026-08-31T00:00:04.000Z',
  });
  assert.equal(readApprovalState(ledger).value.state, 'finalized');
  assert.equal(readActiveCleanupPointer(ledger).value.disposition, 'receipt_verified');
  assert.equal(tombstone.value.priorPointerDigest, active.digest);
  assert.equal(lstatSync(ledger.executionRoot).mode & 0o077, 0);
  assert.equal(lstatSync(ledger.approvalCurrentPath).mode & 0o077, 0);
});

test('every transition enforces expected digest and exact operation binding', () => {
  const ledger = fixture();
  const unused = initializeApprovalState(ledger, { transitionedAt: '2026-08-31T01:00:00.000Z' });
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T01:00:01.000Z',
  });
  assert.throws(() => publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-2', journalGenesisDigest: GENESIS,
  }), /compare-and-swap/);
  assert.throws(() => reserveApproval(ledger, {
    expectedStateDigest: 'f'.repeat(64), operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
  }), /compare-and-swap/);
  assert.throws(() => reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: 'cleanup-2', journalGenesisDigest: GENESIS,
  }), /does not bind/);
  const reserved = reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: '2026-08-31T01:00:02.000Z',
  });
  assert.throws(() => clearPreReservationCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
  }), /pre-reservation/);
  assert.throws(() => finalizeApproval(ledger, {
    expectedStateDigest: reserved.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: 'f'.repeat(64), finalJournalDigest: FINAL_JOURNAL,
    inventoryAfterDigest: INVENTORY, receiptCoreDigest: RECEIPT_CORE, terminalOutcome: 'cleaned',
  }), /identity mismatch/);
});

test('recovery can tombstone an exact pre-reservation pointer without receipt material', () => {
  const ledger = fixture();
  initializeApprovalState(ledger, { transitionedAt: '2026-08-31T02:00:00.000Z' });
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T02:00:01.000Z',
  });
  const cleared = clearPreReservationCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: '2026-08-31T02:00:02.000Z',
  });
  assert.equal(cleared.value.state, 'tombstoned');
  assert.equal(cleared.value.disposition, 'pre_reservation');
  assert.equal(cleared.value.receiptDigest, null);

  const nextLedger = fixture('4'.repeat(64), ledger.runtimeDirectory);
  initializeApprovalState(nextLedger, { transitionedAt: '2026-08-31T02:00:03.000Z' });
  const next = publishActiveCleanupPointer(nextLedger, {
    expectedPointerDigest: cleared.digest, operationRunId: 'cleanup-2',
    journalGenesisDigest: '5'.repeat(64), transitionedAt: '2026-08-31T02:00:04.000Z',
  });
  assert.equal(next.value.generation, 3);
  assert.equal(next.value.priorPointerDigest, cleared.digest);
});

test('deployment cleanup gate distinguishes clear, active, incomplete, and tombstoned state', () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-gate-'));
  chmodSync(runtimeDirectory, 0o700);
  assert.deepEqual(
    inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
    { state: 'clear', pointerDigest: null },
  );
  for (const unsafeMode of [0o770, 0o777]) {
    chmodSync(runtimeDirectory, unsafeMode);
    assert.throws(
      () => inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
      /safely owned/,
    );
  }
  chmodSync(runtimeDirectory, 0o755);
  assert.deepEqual(
    inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
    { state: 'clear', pointerDigest: null },
  );
  chmodSync(runtimeDirectory, 0o700);

  const ledger = fixture(APPROVAL, runtimeDirectory);
  initializeApprovalState(ledger, { transitionedAt: '2026-08-31T02:10:00.000Z' });
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T02:10:01.000Z',
  });
  assert.deepEqual(
    inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
    { state: 'active', pointerDigest: active.digest },
  );
  assert.throws(
    () => assertNoActiveCleanup({ runtimeDirectory, deploymentId: 'deploy-1' }),
    /cleanup state is active/,
  );

  unlinkSync(ledger.activePointerPath);
  assert.deepEqual(
    inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
    { state: 'incomplete', pointerDigest: null },
  );
  assert.throws(
    () => assertNoActiveCleanup({ runtimeDirectory, deploymentId: 'deploy-1' }),
    /cleanup state is incomplete/,
  );

  publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T02:10:02.000Z',
  });
  const cleared = clearPreReservationCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T02:10:03.000Z',
  });
  assert.deepEqual(
    inspectDeploymentCleanupState({ runtimeDirectory, deploymentId: 'deploy-1' }),
    { state: 'clear', pointerDigest: cleared.digest },
  );
});

test('canonical structural validation detects current-state tampering and symlink storage', () => {
  const ledger = fixture();
  initializeApprovalState(ledger, { transitionedAt: '2026-08-31T03:00:00.000Z' });
  const value = JSON.parse(readFileSync(ledger.approvalCurrentPath, 'utf8'));
  writeFileSync(ledger.approvalCurrentPath, canonicalJson({ ...value, approvalDigest: 'f'.repeat(64) }));
  assert.throws(() => readApprovalState(ledger), /identity mismatch/);

  const modeLedger = fixture('7'.repeat(64));
  initializeApprovalState(modeLedger, { transitionedAt: '2026-08-31T03:00:01.000Z' });
  chmodSync(modeLedger.approvalCurrentPath, 0o644);
  assert.throws(() => readApprovalState(modeLedger), /owner-only/);

  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-ledger-link-'));
  chmodSync(runtimeDirectory, 0o700);
  const outside = mkdtempSync(path.join(os.tmpdir(), 'cleanup-ledger-outside-'));
  chmodSync(outside, 0o700);
  symlinkSync(outside, path.join(runtimeDirectory, 'ownership'));
  assert.throws(() => fixture('6'.repeat(64), runtimeDirectory), /non-symlink|real/);
});

test('immutable transitions close create-before-pointer crash windows and detect chain tampering', () => {
  const ledger = fixture();
  const stateTime = '2026-08-31T04:00:00.000Z';
  const unused = initializeApprovalState(ledger, { transitionedAt: stateTime });
  unlinkSync(ledger.approvalCurrentPath);
  const recoveredState = initializeApprovalState(ledger, { transitionedAt: stateTime });
  assert.equal(recoveredState.digest, unused.digest);

  const pointerTime = '2026-08-31T04:00:01.000Z';
  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: pointerTime,
  });
  unlinkSync(ledger.activePointerPath);
  const recoveredPointer = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: pointerTime,
  });
  assert.equal(recoveredPointer.digest, active.digest);

  const transitionPath = path.join(ledger.pointerTransitions, '000001.json');
  const transition = JSON.parse(readFileSync(transitionPath, 'utf8'));
  writeFileSync(transitionPath, canonicalJson({ ...transition, operationRunId: 'cleanup-tampered' }));
  assert.throws(() => readActiveCleanupPointer(ledger), /immutable transition/);
});

test('every durable transition is adopted after a crash without reproducing its timestamp', () => {
  const ledger = fixture();
  const unused = initializeApprovalState(ledger, { transitionedAt: '2026-08-31T05:00:00.000Z' });
  unlinkSync(ledger.approvalCurrentPath);
  const recoveredUnused = initializeApprovalState(ledger, { transitionedAt: '2026-08-31T05:00:00.999Z' });
  assert.equal(recoveredUnused.digest, unused.digest);

  const active = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T05:00:01.000Z',
  });
  unlinkSync(ledger.activePointerPath);
  const recoveredActive = publishActiveCleanupPointer(ledger, {
    expectedPointerDigest: null, operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    transitionedAt: '2026-08-31T05:00:01.999Z',
  });
  assert.equal(recoveredActive.digest, active.digest);

  const unusedBytes = readFileSync(ledger.approvalCurrentPath);
  const reserved = reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: '2026-08-31T05:00:02.000Z',
  });
  writeFileSync(ledger.approvalCurrentPath, unusedBytes);
  const recoveredReserved = reserveApproval(ledger, {
    expectedStateDigest: unused.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, transitionedAt: '2026-08-31T05:00:02.999Z',
  });
  assert.equal(recoveredReserved.digest, reserved.digest);

  const reservedBytes = readFileSync(ledger.approvalCurrentPath);
  const finalized = finalizeApproval(ledger, {
    expectedStateDigest: reserved.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, finalJournalDigest: FINAL_JOURNAL,
    inventoryAfterDigest: INVENTORY, receiptCoreDigest: RECEIPT_CORE,
    terminalOutcome: 'cleaned', transitionedAt: '2026-08-31T05:00:03.000Z',
  });
  writeFileSync(ledger.approvalCurrentPath, reservedBytes);
  const recoveredFinalized = finalizeApproval(ledger, {
    expectedStateDigest: reserved.digest, operationRunId: 'cleanup-1',
    journalGenesisDigest: GENESIS, finalJournalDigest: FINAL_JOURNAL,
    inventoryAfterDigest: INVENTORY, receiptCoreDigest: RECEIPT_CORE,
    terminalOutcome: 'cleaned', transitionedAt: '2026-08-31T05:00:03.999Z',
  });
  assert.equal(recoveredFinalized.digest, finalized.digest);

  const activeBytes = readFileSync(ledger.activePointerPath);
  const tombstone = tombstoneActiveCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, expectedStateDigest: finalized.digest,
    operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    receiptDigest: RECEIPT, signatureDigest: SIGNATURE, checksumDigest: CHECKSUM,
    transitionedAt: '2026-08-31T05:00:04.000Z',
  });
  writeFileSync(ledger.activePointerPath, activeBytes);
  const recoveredTombstone = tombstoneActiveCleanupPointer(ledger, {
    expectedPointerDigest: active.digest, expectedStateDigest: finalized.digest,
    operationRunId: 'cleanup-1', journalGenesisDigest: GENESIS,
    receiptDigest: RECEIPT, signatureDigest: SIGNATURE, checksumDigest: CHECKSUM,
    transitionedAt: '2026-08-31T05:00:04.999Z',
  });
  assert.equal(recoveredTombstone.digest, tombstone.digest);
});
