import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendCleanupCheckpoint, appendPreparedCleanupCheckpoint, createCleanupJournal,
  deriveCleanupJournalPath, prepareCleanupCheckpoint, verifyCleanupJournal,
} from '../../scripts/ownership/cleanup-journal.mjs';
import { canonicalJson, canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint, sha256, signDetached } from '../../scripts/ownership/crypto.mjs';

const APPROVAL = 'a'.repeat(64);

function genesisPayload(actionCount = 1) {
  const actionDigests = Array.from({ length: actionCount }, (_, index) => (
    `${(index % 10)}`.repeat(64)
  ));
  return {
    planDigest: 'b'.repeat(64), actionDigests, actionsDigest: canonicalSha256(actionDigests),
    contextFingerprint: 'd'.repeat(64), deploymentManifestDigest: 'e'.repeat(64),
    runManifestDigest: 'f'.repeat(64), inventoryBeforeDigest: '1'.repeat(64), actionCount,
    subjectExitStatus: null,
  };
}

function fixture() {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-journal-'));
  chmodSync(runtimeDirectory, 0o700);
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    runtimeDirectory, approvalDigest: APPROVAL, privateKey: keys.privateKey,
    publicKey: keys.publicKey, signerKeyId: publicKeyFingerprint(keys.publicKey),
  };
}

function create(state, overrides = {}) {
  return createCleanupJournal({
    ...state, deploymentId: 'deploy-1', operationRunId: 'cleanup-1',
    createdAt: '2026-08-31T00:00:00.000Z', payload: genesisPayload(),
    ...overrides,
  });
}

function intentPayload() {
  return {
    actionSequence: 1, resourceClass: 'compose_container', immutableIdentity: 'container-1',
    action: 'remove', ownershipDigest: '2'.repeat(64),
    approvedObservationDigest: '3'.repeat(64), authorityRowDigest: '4'.repeat(64),
    approvedActionDigest: '0'.repeat(64),
    predecessorResultDigest: null,
  };
}

function resultPayload(intentDigest) {
  return {
    actionSequence: 1, resourceClass: 'compose_container', immutableIdentity: 'container-1',
    result: 'cleaned', failureClass: 'none', mutationOutcome: 'success',
    reconciliationState: 'absent', intentCheckpointDigest: intentDigest,
    postconditionDigest: '5'.repeat(64),
  };
}

function provenAbsentResultPayload(intentDigest) {
  return {
    ...resultPayload(intentDigest), result: 'absent', mutationOutcome: 'not_started',
  };
}

test('signed canonical checkpoints retain an immutable genesis identity', () => {
  const state = fixture();
  const genesis = create(state);
  const retriedGenesis = create(state);
  assert.equal(retriedGenesis.genesisDigest, genesis.genesisDigest);
  const recoveredGenesis = create(state, { createdAt: '2026-08-31T00:00:00.001Z' });
  assert.equal(recoveredGenesis.genesisDigest, genesis.genesisDigest);
  assert.equal(recoveredGenesis.checkpoint.recordedAt, genesis.checkpoint.recordedAt);
  const intent = appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'intent',
    recordedAt: '2026-08-31T00:00:01.000Z',
    payload: intentPayload(),
  });
  const result = appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: intent.headDigest, checkpointType: 'result',
    recordedAt: '2026-08-31T00:00:02.000Z',
    payload: resultPayload(intent.headDigest),
  });
  const verified = verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
    expectedGenesisDigest: genesis.genesisDigest,
  });
  assert.equal(verified.genesisDigest, genesis.genesisDigest);
  assert.equal(verified.headDigest, result.headDigest);
  assert.equal(verified.recordCount, 3);
  assert.deepEqual(verified.records.map((entry) => entry.checkpoint.checkpointType), ['genesis', 'intent', 'result']);
  assert.equal(verified.records[1].checkpoint.previousDigest, genesis.headDigest);
  assert.equal(readFileSync(genesis.journalPath).at(-1), 0x0a);
});

test('a signed intent can journal a stable proven absence without mutation', () => {
  const state = fixture();
  const genesis = create(state);
  const intent = appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'intent',
    payload: intentPayload(),
  });
  const result = appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: intent.headDigest, checkpointType: 'result',
    payload: provenAbsentResultPayload(intent.headDigest),
  });
  const verified = verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
    expectedGenesisDigest: genesis.genesisDigest,
  });
  assert.equal(verified.headDigest, result.headDigest);
  assert.equal(verified.records[2].checkpoint.payload.result, 'absent');
  assert.equal(verified.records[2].checkpoint.payload.mutationOutcome, 'not_started');
});

test('append requires an exact current head and rejects private payload fields', () => {
  const state = fixture();
  const genesis = create(state);
  assert.throws(() => appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: 'f'.repeat(64), checkpointType: 'intent', payload: {},
  }), /compare-and-swap/);
  assert.throws(() => appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'result',
    payload: { ...resultPayload(null), rawError: 'raw-daemon-response' },
  }), /bounded failure classes/);
  assert.throws(() => appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'result',
    payload: { ...resultPayload(null), failureClass: 'daemon said permission denied for /var/run/docker.sock' },
  }), /not raw text/);
  assert.throws(() => appendCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'unknown', payload: {},
  }), /checkpoint type/);
});

test('a terminal checkpoint can be predicted exactly before its durable append', () => {
  const state = fixture();
  const genesis = create(state, { payload: genesisPayload(0) });
  const prepared = prepareCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, checkpointType: 'terminal',
    recordedAt: '2026-08-31T00:00:03.000Z',
    payload: {
      terminalOutcome: 'no_op', inventoryAfterDigest: '6'.repeat(64),
      resultsDigest: '7'.repeat(64), refusalsDigest: '8'.repeat(64),
      postconditionsDigest: '9'.repeat(64),
      operationStartedAt: '2026-08-31T00:00:01.000Z',
      operationEndedAt: '2026-08-31T00:00:02.000Z', subjectExitStatus: null,
      receiptCoreFinalizedAt: '2026-08-31T00:00:03.000Z',
    },
  });
  assert.equal(verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
  }).headDigest, genesis.headDigest);
  const appended = appendPreparedCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, prepared,
    publicKey: state.publicKey,
  });
  assert.equal(appended.headDigest, prepared.headDigest);
  assert.equal(appended.bytes, prepared.bytes);
  assert.equal(appended.recordCount, prepared.recordCount);
  assert.throws(() => appendPreparedCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, prepared, publicKey: state.publicKey,
  }), /compare-and-swap/);
  assert.throws(() => appendPreparedCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: appended.headDigest,
    prepared: { ...prepared, headDigest: 'f'.repeat(64), expectedHeadDigest: appended.headDigest },
    publicKey: state.publicKey,
  }), /sequence|metadata|hash chain/);
});

test('verification rejects tampering, truncation, wrong trust, and wrong genesis', () => {
  const state = fixture();
  const genesis = create(state);
  const original = readFileSync(genesis.journalPath);
  const tampered = Buffer.from(original.toString('utf8').replace('deploy-1', 'deploy-2'));
  writeFileSync(genesis.journalPath, tampered);
  assert.throws(() => verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
  }), /signature|identity/);

  writeFileSync(genesis.journalPath, original.subarray(0, original.length - 1));
  assert.throws(() => verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
  }), /torn/);

  writeFileSync(genesis.journalPath, original);
  assert.throws(() => verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
    expectedGenesisDigest: 'f'.repeat(64),
  }), /genesis identity/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => verifyCleanupJournal({
    ...state, publicKey: other.publicKey, expectedSignerKeyId: state.signerKeyId,
  }), /signer key/);
  chmodSync(genesis.journalPath, 0o644);
  assert.throws(() => verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
  }), /owner-only/);
});

test('storage refuses non-owner modes and symlink traversal', () => {
  const state = fixture();
  chmodSync(state.runtimeDirectory, 0o755);
  assert.throws(() => create(state), /owner-only/);

  const safe = fixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'cleanup-journal-outside-'));
  chmodSync(outside, 0o700);
  symlinkSync(outside, path.join(safe.runtimeDirectory, 'ownership'));
  assert.throws(() => create(safe), /non-symlink|real/);
  assert.equal(deriveCleanupJournalPath(safe), path.join(
    safe.runtimeDirectory, 'ownership', 'cleanup-executions', APPROVAL, 'action-journal.jsonl',
  ));
});

test('journal protocol rejects unbound, reordered, replayed, and post-terminal checkpoints', () => {
  const emptyIntent = fixture();
  const emptyGenesis = create(emptyIntent);
  assert.throws(() => appendCleanupCheckpoint({
    ...emptyIntent, expectedGenesisDigest: emptyGenesis.genesisDigest,
    expectedHeadDigest: emptyGenesis.headDigest, checkpointType: 'intent', payload: {},
  }), /intent payload fields/);

  const resultFirst = fixture();
  const resultGenesis = create(resultFirst);
  assert.throws(() => appendCleanupCheckpoint({
    ...resultFirst, expectedGenesisDigest: resultGenesis.genesisDigest,
    expectedHeadDigest: resultGenesis.headDigest, checkpointType: 'result',
    payload: resultPayload('a'.repeat(64)),
  }), /missing intent/);

  const replay = fixture();
  const replayGenesis = create(replay, { payload: genesisPayload(2) });
  const replayIntent = appendCleanupCheckpoint({
    ...replay, expectedGenesisDigest: replayGenesis.genesisDigest,
    expectedHeadDigest: replayGenesis.headDigest, checkpointType: 'intent', payload: intentPayload(),
  });
  const replayResult = appendCleanupCheckpoint({
    ...replay, expectedGenesisDigest: replayGenesis.genesisDigest,
    expectedHeadDigest: replayIntent.headDigest, checkpointType: 'result',
    payload: resultPayload(replayIntent.headDigest),
  });
  assert.throws(() => appendCleanupCheckpoint({
    ...replay, expectedGenesisDigest: replayGenesis.genesisDigest,
    expectedHeadDigest: replayResult.headDigest, checkpointType: 'intent', payload: intentPayload(),
  }), /intent order/);

  const terminalState = fixture();
  const terminalGenesis = create(terminalState, { payload: genesisPayload(0) });
  const terminal = appendCleanupCheckpoint({
    ...terminalState, expectedGenesisDigest: terminalGenesis.genesisDigest,
    expectedHeadDigest: terminalGenesis.headDigest, checkpointType: 'terminal',
    recordedAt: '2026-08-31T00:00:03.000Z', payload: {
      terminalOutcome: 'no_op', inventoryAfterDigest: '6'.repeat(64),
      resultsDigest: '7'.repeat(64), refusalsDigest: '8'.repeat(64),
      postconditionsDigest: '9'.repeat(64), receiptCoreFinalizedAt: '2026-08-31T00:00:03.000Z',
      operationStartedAt: '2026-08-31T00:00:01.000Z',
      operationEndedAt: '2026-08-31T00:00:02.000Z', subjectExitStatus: null,
    },
  });
  assert.throws(() => appendCleanupCheckpoint({
    ...terminalState, expectedGenesisDigest: terminalGenesis.genesisDigest,
    expectedHeadDigest: terminal.headDigest, checkpointType: 'cancellation',
    payload: { processedActionCount: 0, reason: 'abort' },
  }), /after terminal/);

  const recovery = fixture();
  const recoveryGenesis = create(recovery);
  assert.throws(() => appendCleanupCheckpoint({
    ...recovery, expectedGenesisDigest: recoveryGenesis.genesisDigest,
    expectedHeadDigest: recoveryGenesis.headDigest, checkpointType: 'recovery', payload: {
      controllerRunId: 'recovery-1', originalOperationRunId: 'cleanup-1',
      priorJournalHeadDigest: 'f'.repeat(64), projectLockObservationDigest: '7'.repeat(64),
      deploymentLockObservationDigest: '8'.repeat(64),
    },
  }), /recovery checkpoint binding/);
});

test('prepared append independently refuses a signed protocol-invalid record without poisoning the journal', () => {
  const state = fixture();
  const genesis = create(state, { payload: genesisPayload(0) });
  const checkpoint = {
    version: 1, sequence: 1, checkpointType: 'intent', previousDigest: genesis.headDigest,
    approvalDigest: state.approvalDigest, deploymentId: 'deploy-1', operationRunId: 'cleanup-1',
    signerKeyId: state.signerKeyId, recordedAt: '2026-08-31T00:00:01.000Z',
    payload: intentPayload(),
  };
  const envelope = {
    checkpoint,
    signature: signDetached(canonicalJson(checkpoint), state.privateKey).toString('base64'),
  };
  const bytes = canonicalJson(envelope);
  const prepared = {
    journalPath: genesis.journalPath, genesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, headDigest: sha256(bytes),
    priorRecordCount: 1, priorBytes: genesis.bytes, recordCount: 2,
    bytes: genesis.bytes + bytes.length + 1, checkpoint, envelope,
  };
  assert.throws(() => appendPreparedCleanupCheckpoint({
    ...state, expectedGenesisDigest: genesis.genesisDigest,
    expectedHeadDigest: genesis.headDigest, prepared, publicKey: state.publicKey,
  }), /intent order/);
  assert.equal(verifyCleanupJournal({
    ...state, expectedSignerKeyId: state.signerKeyId,
  }).recordCount, 1);
});
