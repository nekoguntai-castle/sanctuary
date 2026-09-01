import {
  adoptCleanupCurrent, inspectCleanupTransitions,
  readActiveCleanupPointer, readApprovalState,
} from './cleanup-approval-ledger.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function binding(value, operationRunId, journalGenesisDigest, label) {
  if (value.state !== 'unused' && (value.operationRunId !== operationRunId
      || value.journalGenesisDigest !== journalGenesisDigest)) {
    throw new Error(`${label} orphan transition does not bind the verified journal`);
  }
}

function onePending(transitions, current, label) {
  const generation = current?.value.generation ?? 0;
  const pending = transitions.filter((entry) => entry.value.generation > generation);
  if (pending.length === 0) return null;
  if (pending.length !== 1 || pending[0].value.generation !== generation + 1) {
    throw new Error(`${label} has ambiguous orphan transitions`);
  }
  return pending[0];
}

function approvalNext(next, current, operationRunId, journalGenesisDigest) {
  const generation = (current?.value.generation ?? 0) + 1;
  const expectedState = ['unused', 'reserved', 'finalized'][generation - 1];
  if (next.value.state !== expectedState
      || next.value.priorStateDigest !== (current?.digest ?? null)) {
    throw new Error('approval state orphan transition chain is invalid');
  }
  binding(next.value, operationRunId, journalGenesisDigest, 'approval state');
}

function pointerNext(next, current, ledger, operationRunId, journalGenesisDigest) {
  const generation = (current?.value.generation ?? 0) + 1;
  const expectedState = generation % 2 === 1 ? 'active' : 'tombstoned';
  if (next.value.state !== expectedState
      || next.value.priorPointerDigest !== (current?.digest ?? null)
      || next.value.approvalDigest !== ledger.approvalDigest) {
    throw new Error('active cleanup orphan transition chain is invalid');
  }
  binding(next.value, operationRunId, journalGenesisDigest, 'active cleanup pointer');
}

/** Adopt only one exact next immutable transition after its journal identity is verified. */
export function adoptPendingCleanupTransitions(ledger, { operationRunId, journalGenesisDigest }) {
  if (!ID.test(operationRunId ?? '') || !DIGEST.test(journalGenesisDigest ?? '')) {
    throw new Error('orphan transition adoption requires an exact journal identity');
  }
  let approvalState = readApprovalState(ledger);
  const approval = onePending(inspectCleanupTransitions(ledger, 'approval'), approvalState, 'approval state');
  if (approval) {
    approvalNext(approval, approvalState, operationRunId, journalGenesisDigest);
    approvalState = adoptCleanupCurrent(ledger, 'approval', approvalState?.digest ?? null, approval);
  }
  let pointer = readActiveCleanupPointer(ledger);
  const nextPointer = onePending(inspectCleanupTransitions(ledger, 'pointer'), pointer, 'active cleanup pointer');
  if (nextPointer) {
    pointerNext(nextPointer, pointer, ledger, operationRunId, journalGenesisDigest);
    pointer = adoptCleanupCurrent(ledger, 'pointer', pointer?.digest ?? null, nextPointer);
  }
  return Object.freeze({ approvalState, pointer });
}
