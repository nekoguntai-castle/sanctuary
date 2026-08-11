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
  broadcastTransaction,
  DefiniteBroadcastRejectionError,
} from '../../../../../src/services/bitcoin/blockchain/networkOperations';
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
    await expect(broadcastTransaction(artifact)).rejects.toBeInstanceOf(
      DefiniteBroadcastRejectionError,
    );
    expect(mocks.nodeBroadcast).not.toHaveBeenCalled();
  });

  it('classifies an unexpected preflight failure as definite without submitting', async () => {
    mocks.preflight.mockRejectedValue(new Error('preflight transport failed'));
    await expect(broadcastTransaction(artifact)).rejects.toBeInstanceOf(
      DefiniteBroadcastRejectionError,
    );
    expect(mocks.nodeBroadcast).not.toHaveBeenCalled();
  });

  it('classifies connection loss during submission as an unknown outcome', async () => {
    mocks.nodeBroadcast.mockRejectedValue(new Error('connection lost'));
    await expect(broadcastTransaction(artifact)).rejects.toThrow(
      'Broadcast outcome is unknown: connection lost',
    );
  });
});
