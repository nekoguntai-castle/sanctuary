import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { verifySignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import {
  createCleanupLedger, readActiveCleanupPointer, readApprovalState,
} from '../../scripts/ownership/cleanup-approval-ledger.mjs';
import { inspectDeploymentCleanupState } from '../../scripts/ownership/deployment-cleanup-gate.mjs';
import { applyCleanupExecution } from '../../scripts/ownership/cleanup-execution.mjs';
import { recoverCleanupExecution } from '../../scripts/ownership/cleanup-recovery.mjs';
import { verifyCleanupJournal } from '../../scripts/ownership/cleanup-journal.mjs';
import { HASH, fixture, inventory, row } from './fixtures/cleanup-execution-fixture.mjs';

// One terminal-state rule (D-16.C2a): the executor, the signed journal, the
// receipt core and the receipt schema must agree on every reachable outcome,
// or a cleanup whose mutations already ran can never be finalized or recovered.
const ID2 = 'e'.repeat(64);

function failedFirstCallbacks(overrides = {}) {
  return {
    reloadAuthority: async ({ action }) => ({
      state: 'eligible', row: row(action.immutableIdentity), derivedFromResultDigest: null,
    }),
    mutate: async () => ({ outcome: 'command_failed' }),
    reconcile: async ({ action }) => ({
      state: 'absent', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: HASH, failureClass: 'none',
    }),
    buildInventoryAfter: async () => inventory([row(ID2)], '2026-08-30T00:00:08.000Z'),
    ...overrides,
  };
}

function ledgerFor(values) {
  return createCleanupLedger({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
    approvalDigest: canonicalSha256(values.approval),
  });
}

function verifyReceipt(values, receiptOutputPath) {
  return verifySignedArtifact({
    inputPath: receiptOutputPath, publicKeyPath: values.signer.publicKeyPath,
    expectedFingerprint: values.signer.signerKeyId, checkoutRoot: values.checkoutRoot,
    now: new Date('2026-08-30T00:02:00.000Z'),
  }).artifact;
}

function assertFinalized(values, state) {
  const ledger = ledgerFor(values);
  assert.equal(readApprovalState(ledger).value.state, 'finalized');
  assert.equal(readApprovalState(ledger).value.terminalOutcome, state);
  assert.equal(readActiveCleanupPointer(ledger).value.state, 'tombstoned');
  assert.equal(inspectDeploymentCleanupState({
    runtimeDirectory: values.runtimeDirectory, deploymentId: 'deploy-1',
  }).state, 'clear');
}

test('a failed first action with refused later actions finalizes as a signed partial receipt', async () => {
  const values = fixture('terminal-failed-then-refused', [row(), row(ID2)]);
  assert.equal(values.plan.actions.length, 2);
  const result = await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...failedFirstCallbacks(),
  });
  const receipt = verifyReceipt(values, result.receiptOutputPath);
  assert.equal(result.state, 'partial');
  assert.equal(receipt.state, 'partial');
  assert.deepEqual(receipt.results.map((entry) => [entry.result, entry.failureClass]), [
    ['failed', 'mutation_failed'], ['refused', 'mutation_failed'],
  ]);
  assert.equal(receipt.refusals.length, 1);
  assertFinalized(values, 'partial');
});

test('recovery finalizes a failed-first-action execution stranded before its terminal checkpoint', async () => {
  // Crashing at inventory_after_persisted leaves exactly the on-disk state the
  // pre-fix receipt validator left on operator hosts: every result journaled,
  // inventory-after persisted, no terminal checkpoint, approval reserved and
  // the cleanup pointer active.
  const values = fixture('terminal-failed-stranded', [row(), row(ID2)]);
  let mutations = 0;
  await assert.rejects(() => applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...failedFirstCallbacks({ mutate: async () => { mutations += 1; return { outcome: 'command_failed' }; } }),
    afterBoundary: async (boundary) => {
      if (boundary === 'inventory_after_persisted') throw new Error('simulated stranded execution');
    },
  }), /simulated stranded execution/);
  const ledger = ledgerFor(values);
  assert.equal(readApprovalState(ledger).value.state, 'reserved');
  assert.equal(readActiveCleanupPointer(ledger).value.state, 'active');
  const recovered = await recoverCleanupExecution({
    ...values, ...values.signer, controllerRunId: 'recover-stranded',
    projectLockObservationDigest: HASH, deploymentLockObservationDigest: HASH,
    reloadAuthority: async () => { throw new Error('terminal recovery cannot reload'); },
    mutate: async () => { throw new Error('terminal recovery cannot mutate'); },
    reconcile: async () => { throw new Error('terminal recovery cannot reconcile'); },
    buildInventoryAfter: async () => { throw new Error('recovery must reuse the persisted inventory'); },
    now: () => new Date('2026-08-30T00:01:30.000Z'),
  });
  assert.equal(mutations, 1);
  assert.equal(recovered.state, 'partial');
  assert.equal(verifyReceipt(values, recovered.receiptOutputPath).state, 'partial');
  assertFinalized(values, 'partial');
});

test('a cancellation observed after a failed action finalizes as cancelled', async () => {
  const values = fixture('terminal-failed-then-cancelled', [row(), row(ID2)]);
  const controller = new AbortController();
  const result = await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    signal: controller.signal,
    ...failedFirstCallbacks({
      buildInventoryAfter: async () => {
        controller.abort(new Error('operator interrupt'));
        return inventory([row(ID2)], '2026-08-30T00:00:08.000Z');
      },
    }),
  });
  const receipt = verifyReceipt(values, result.receiptOutputPath);
  assert.equal(result.state, 'cancelled');
  assert.equal(receipt.state, 'cancelled');
  assert.equal(verifyCleanupJournal({
    runtimeDirectory: values.runtimeDirectory, approvalDigest: canonicalSha256(values.approval),
    publicKey: values.signer.publicKey, expectedSignerKeyId: values.signer.signerKeyId,
  }).protocol.cancellationSeen, true);
  assertFinalized(values, 'cancelled');
});

test('a cancelled mutation with an ambiguous reconciliation finalizes as cancelled', async () => {
  const values = fixture('terminal-cancelled-ambiguous', [row(), row(ID2)]);
  const result = await applyCleanupExecution({
    ...values, ...values.signer, now: () => new Date('2026-08-30T00:01:00.000Z'),
    ...failedFirstCallbacks({
      mutate: async () => ({ outcome: 'cancelled' }),
      reconcile: async ({ action }) => ({
        state: 'ambiguous', resourceClass: action.resourceClass,
        immutableIdentity: action.immutableIdentity, postconditionDigest: null,
        failureClass: 'query_failed',
      }),
      buildInventoryAfter: async () => inventory([row(), row(ID2)], '2026-08-30T00:00:08.000Z'),
    }),
  });
  const receipt = verifyReceipt(values, result.receiptOutputPath);
  assert.equal(result.state, 'cancelled');
  assert.equal(receipt.state, 'cancelled');
  assert.equal(receipt.postconditions[0].state, 'ambiguous');
  assertFinalized(values, 'cancelled');
});

const RULE_RESULTS = [
  ['cleaned', 'none'], ['absent', 'none'], ['failed', 'mutation_failed'], ['failed', 'cancelled'],
  ['refused', 'mutation_failed'], ['refused', 'active'], ['refused', 'cancelled'], ['ambiguous', 'query_failed'],
];

function* resultTuples(length) {
  if (length === 0) { yield []; return; }
  for (const prefix of resultTuples(length - 1)) {
    for (const [result, failureClass] of RULE_RESULTS) yield [...prefix, { result, failureClass }];
  }
}

test('every outcome the executor or journal can choose is a state the receipt accepts', async () => {
  const { cleanupTerminalOutcome, cleanupTerminalStateCandidates } = await import(
    '../../scripts/ownership/cleanup-terminal-state.mjs'
  );
  for (let length = 0; length <= 3; length += 1) {
    for (const results of resultTuples(length)) {
      const candidates = cleanupTerminalStateCandidates(results);
      for (const recovered of [false, true]) {
        for (const cancelled of [false, true]) {
          const outcome = cleanupTerminalOutcome(results, { recovered, cancelled });
          assert.equal(candidates.has(outcome), true, `${JSON.stringify(results)} ${recovered} ${cancelled} -> ${outcome}`);
        }
      }
    }
  }
  assert.equal(cleanupTerminalOutcome([
    { result: 'failed', failureClass: 'mutation_failed' },
    { result: 'refused', failureClass: 'mutation_failed' },
  ]), 'partial');
  assert.equal(cleanupTerminalOutcome([{ result: 'refused', failureClass: 'active' }]), 'refused');
});

test('no cleanup module keeps a private copy of the terminal-state rule', () => {
  for (const file of [
    'cleanup-execution.mjs', 'cleanup-execution-receipt.mjs',
    'execution-receipt-schema.mjs', 'cleanup-journal-protocol.mjs',
  ]) {
    const source = readFileSync(new URL(`../../scripts/ownership/${file}`, import.meta.url), 'utf8');
    assert.match(source, /from '\.\/cleanup-terminal-state\.mjs'/, file);
    assert.doesNotMatch(source, /successful > 0\) return/, file);
  }
});
