import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nodeBroadcast: vi.fn(),
  preflight: vi.fn(),
}));
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({ broadcastTransaction: mocks.nodeBroadcast }),
}));
vi.mock('../../../../../src/services/bitcoin/blockchain/broadcastPreflight', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../src/services/bitcoin/blockchain/broadcastPreflight')>();
  return { ...actual, verifyElectrumBroadcastPreflight: mocks.preflight };
});
vi.mock('../../../../../src/services/bitcoin/utils', () => ({
  validateAddress: vi.fn(),
}));

import {
  broadcastAuthenticatedRawTransaction,
  broadcastTransaction,
  DefiniteBroadcastRejectionError,
  isDefiniteNodeRejection,
  isNodeAnsweredBroadcastFailure,
} from '../../../../../src/services/bitcoin/blockchain/networkOperations';
import { ElectrumRpcError } from '../../../../../src/services/bitcoin/electrum/types';
import { BroadcastPreflightError } from '../../../../../src/services/bitcoin/blockchain/broadcastPreflight';
import { createValidatedBroadcastArtifactFixture } from '../../../../helpers/validatedBroadcastArtifact';

const artifact = createValidatedBroadcastArtifactFixture({
  rawTx: '00',
  txid: 'a'.repeat(64),
  walletId: 'wallet-1',
  network: 'regtest',
  intentId: 'intent-1',
  intentDigest: 'b'.repeat(64),
});

describe('opaque validated broadcast boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preflight.mockResolvedValue({ txid: artifact.txid, inputCount: 1, checkedOutpoints: [] });
  });

  it('returns success only when the node reports the validated txid', async () => {
    mocks.nodeBroadcast.mockResolvedValue(artifact.txid);
    await expect(broadcastTransaction(artifact)).resolves.toEqual({
      txid: artifact.txid,
      broadcasted: true,
    });
  });

  it('rejects a node-returned transaction id mismatch', async () => {
    mocks.nodeBroadcast.mockResolvedValue('c'.repeat(64));
    await expect(broadcastTransaction(artifact)).rejects.toThrow('Broadcast outcome is unknown');
  });

  it('classifies preflight rejection as definite before the network boundary', async () => {
    mocks.preflight.mockRejectedValue(new BroadcastPreflightError(
      'spent input', 'node_preflight_rejected', {},
    ));
    await expect(broadcastTransaction(artifact, true)).rejects.toBeInstanceOf(
      DefiniteBroadcastRejectionError,
    );
    expect(mocks.nodeBroadcast).not.toHaveBeenCalled();
  });

  it('classifies an unexpected preflight failure as definite without submitting', async () => {
    mocks.preflight.mockRejectedValue(new Error('preflight transport failed'));
    await expect(broadcastTransaction(artifact, true)).rejects.toBeInstanceOf(
      DefiniteBroadcastRejectionError,
    );
    expect(mocks.nodeBroadcast).not.toHaveBeenCalled();
  });

  it('keeps a preflight failure unknown, with its cause, when definite rejection is not allowed', async () => {
    const preflightError = new BroadcastPreflightError('spent input', 'node_preflight_rejected', {});
    mocks.preflight.mockRejectedValue(preflightError);
    for (const call of [
      () => broadcastTransaction(artifact),
      () => broadcastTransaction(artifact, false),
    ]) {
      const failure = await call().catch((error: unknown) => error) as Error & { cause?: unknown };
      expect(failure).not.toBeInstanceOf(DefiniteBroadcastRejectionError);
      expect(failure.message).toBe('Broadcast outcome is unknown: spent input');
      expect(failure.cause).toBe(preflightError);
    }
    expect(mocks.nodeBroadcast).not.toHaveBeenCalled();
  });

  it('forwards allowDefiniteRejection from the artifact wrapper to the authenticated broadcaster', async () => {
    const rpc = new ElectrumRpcError('min relay fee not met, 1 < 2');
    mocks.nodeBroadcast.mockRejectedValue(rpc);
    await expect(broadcastTransaction(artifact, true)).rejects.toBeInstanceOf(DefiniteBroadcastRejectionError);
    await expect(broadcastTransaction(artifact, false)).rejects.not.toBeInstanceOf(DefiniteBroadcastRejectionError);
    await expect(broadcastTransaction(artifact)).rejects.not.toBeInstanceOf(DefiniteBroadcastRejectionError);
  });

  describe('node rejection classification', () => {
    const definiteMessages = [
      'min relay fee not met, 100 < 250',
      'mempool min fee not met, 100 < 250',
      'insufficient fee, rejecting replacement',
      'dust',
      'txn-mempool-conflict',
      'non-mandatory-script-verify-flag (Signature must be zero for failed CHECK(MULTI)SIG operation)',
      'mandatory-script-verify-flag-failed (Script failed an OP_EQUALVERIFY operation)',
      'bad-txns-in-belowout',
      'bad-txns-oversize',
      'non-final',
    ];
    const ambiguousMessages = [
      'bad-txns-inputs-missingorspent',
      'missing inputs: missingorspent',
      'Transaction already in block chain',
      'txn-already-known',
    ];
    const rawRequest = (allowDefiniteRejection?: boolean) => broadcastAuthenticatedRawTransaction({
      rawTx: '00', network: 'regtest', expectedTxid: artifact.txid, replacement: false, allowDefiniteRejection,
    });

    it.each(definiteMessages)('treats %j as a definite rejection when allowed', async message => {
      const rpc = new ElectrumRpcError(message);
      expect(isDefiniteNodeRejection(rpc)).toBe(true);
      mocks.nodeBroadcast.mockRejectedValue(rpc);
      await expect(rawRequest(true)).rejects.toBeInstanceOf(DefiniteBroadcastRejectionError);
      await expect(rawRequest(true)).rejects.toThrow(`Failed to broadcast transaction: ${message}`);
    });

    it.each(definiteMessages)('keeps %j unknown, with its cause, when definite rejection is not allowed', async message => {
      const rpc = new ElectrumRpcError(message);
      mocks.nodeBroadcast.mockRejectedValue(rpc);
      for (const allow of [undefined, false]) {
        const failure = await rawRequest(allow).catch((error: unknown) => error) as Error & { cause?: unknown };
        expect(failure).not.toBeInstanceOf(DefiniteBroadcastRejectionError);
        expect(failure.message).toBe(`Broadcast outcome is unknown: ${message}`);
        expect(failure.cause).toBe(rpc);
      }
    });

    it.each(ambiguousMessages)('keeps %j unknown even when definite rejection is allowed', async message => {
      const rpc = new ElectrumRpcError(message);
      expect(isDefiniteNodeRejection(rpc)).toBe(false);
      mocks.nodeBroadcast.mockRejectedValue(rpc);
      const failure = await rawRequest(true).catch((error: unknown) => error) as Error & { cause?: unknown };
      expect(failure).not.toBeInstanceOf(DefiniteBroadcastRejectionError);
      expect(failure.cause).toBe(rpc);
    });

    it.each([
      ['a transport Error with a policy message', new Error('min relay fee not met')],
      ['a non-Error value', 'min relay fee not met'],
    ])('does not treat %s as a definite rejection', async (_label, thrown) => {
      expect(isDefiniteNodeRejection(thrown)).toBe(false);
      mocks.nodeBroadcast.mockRejectedValue(thrown);
      await expect(rawRequest(true)).rejects.not.toBeInstanceOf(DefiniteBroadcastRejectionError);
    });

    it('matches the allowlist case-insensitively', () => {
      expect(isDefiniteNodeRejection(new ElectrumRpcError('Min Relay Fee Not Met'))).toBe(true);
    });
  });

  describe('isNodeAnsweredBroadcastFailure', () => {
    const wrap = (cause: unknown) => Object.assign(new Error('Broadcast outcome is unknown: x'), { cause });

    const answered: Array<[string, Error]> = [
      ...[
        'min relay fee not met', 'mempool min fee not met', 'insufficient fee', 'dust', 'txn-mempool-conflict',
        'non-mandatory-script-verify-flag', 'mandatory-script-verify-flag-failed', 'bad-txns-in-belowout', 'non-final',
        'bad-txns-inputs-missingorspent', 'missingorspent', 'Transaction already in block chain', 'txn-already-known',
      ].map((message): [string, Error] => [message, new ElectrumRpcError(message)]),
      ['preflight rejected', new BroadcastPreflightError('spent', 'node_preflight_rejected')],
      ['invalid raw transaction', new BroadcastPreflightError('bad hex', 'invalid_raw_transaction')],
    ];
    it.each(answered)('is true for a node answer: %s', (_label, cause) => {
      expect(isNodeAnsweredBroadcastFailure(wrap(cause))).toBe(true);
    });

    it.each([
      ['a non-verdict RPC error', wrap(new ElectrumRpcError('bitcoind is not reachable'))],
      ['an unavailable preflight', wrap(new BroadcastPreflightError('down', 'node_preflight_unavailable'))],
      ['another preflight reason', wrap(new BroadcastPreflightError('bad', 'metadata_mismatch'))],
      ['a plain transport cause', wrap(new Error('connection lost'))],
      ['a failure without a cause', new Error('connection lost')],
      ['a non-Error value', 'connection lost'],
      ['an RPC error without a wrapper', new ElectrumRpcError('min relay fee not met')],
    ])('is false for %s', (_label, error) => {
      expect(isNodeAnsweredBroadcastFailure(error)).toBe(false);
    });

    it('carries the ElectrumRpcError cause out of a real broadcast failure', async () => {
      mocks.nodeBroadcast.mockRejectedValue(new ElectrumRpcError('txn-already-known'));
      const failure = await broadcastTransaction(artifact).catch((error: unknown) => error);
      expect(isNodeAnsweredBroadcastFailure(failure)).toBe(true);
      mocks.nodeBroadcast.mockRejectedValue(new Error('connection lost'));
      const transport = await broadcastTransaction(artifact).catch((error: unknown) => error);
      expect(isNodeAnsweredBroadcastFailure(transport)).toBe(false);
    });
  });

  it('classifies connection loss during submission as an unknown outcome', async () => {
    mocks.nodeBroadcast.mockRejectedValue(new Error('connection lost'));
    await expect(broadcastTransaction(artifact)).rejects.toThrow(
      'Broadcast outcome is unknown: connection lost',
    );
  });
});
