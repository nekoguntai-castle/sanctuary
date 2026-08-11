import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), claim: vi.fn(), accepted: vi.fn(), complete: vi.fn(), unknown: vi.fn(),
  rejected: vi.fn(), broadcast: vi.fn(), persist: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('../../../../../src/repositories/transactionSigningIntentRepository', () => ({
  transactionSigningIntentRepository: {
    listBroadcastsForReconciliation: mocks.list,
    claimBroadcast: mocks.claim,
    markBroadcastAccepted: mocks.accepted,
    markBroadcastComplete: mocks.complete,
    markBroadcastUnknown: mocks.unknown,
    releaseRejectedBroadcast: mocks.rejected,
  },
}));
vi.mock('../../../../../src/services/bitcoin/blockchain', () => ({
  broadcastAuthenticatedRawTransaction: mocks.broadcast,
  getTransactionDetails: mocks.lookup,
}));
vi.mock('../../../../../src/services/bitcoin/transactions/persistTransaction', () => ({
  persistTransaction: mocks.persist,
}));

import { reconcileSigningIntentBroadcasts } from '../../../../../src/services/bitcoin/signingIntent/broadcastReconciliation';

const metadata = {
  recipient: 'tb1qrecipient',
  amount: 9000,
  fee: 1000,
  utxos: [{ txid: 'd'.repeat(64), vout: 0 }],
};
const snapshot = (replacementTxid?: string) => ({
  version: 1,
  walletId: 'wallet-1',
  network: 'testnet3',
  transaction: {
    version: 2,
    locktime: 0,
    ...(replacementTxid && { replacementTxid }),
    inputs: [{
      txid: 'd'.repeat(64),
      vout: 0,
      sequence: 0xfffffffd,
      prevout: { amountSats: '10000', scriptPubKeyHex: '0014', role: 'wallet' },
    }],
    outputs: [{ amountSats: '9000', scriptPubKeyHex: '0014' }],
  },
});
const record = (state: 'accepted' | 'unknown' | 'claimed') => ({
  id: 'intent-1', walletId: 'wallet-1', network: 'testnet3', snapshotDigest: 'a'.repeat(64),
  snapshot: snapshot(), broadcastState: state, broadcastTxid: 'b'.repeat(64),
  broadcastRawTx: '00', broadcastMetadata: metadata, broadcastLeaseExpiresAt: new Date(0),
  broadcastLastAttemptAt: new Date(0),
});

describe('signing intent broadcast reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ status: 'claimed', record: {} });
    mocks.accepted.mockResolvedValue(true);
    mocks.complete.mockResolvedValue(true);
    mocks.broadcast.mockResolvedValue({ txid: 'b'.repeat(64), broadcasted: true });
    mocks.lookup.mockRejectedValue(new Error('not found'));
    mocks.persist.mockResolvedValue({});
  });

  it('finishes durable persistence without rebroadcasting an accepted transaction', async () => {
    mocks.list.mockResolvedValue([record('accepted')]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledWith('wallet-1', 'b'.repeat(64), '00', metadata);
  });

  it('leases and idempotently rebroadcasts an unknown outcome before persistence', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    mocks.list.mockResolvedValue([record('unknown')]);
    await expect(reconcileSigningIntentBroadcasts(now))
      .resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'intent-1', txid: 'b'.repeat(64), leaseToken: expect.any(String), now,
      leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
    }));
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      rawTx: '00', expectedTxid: 'b'.repeat(64), network: 'testnet3', replacement: false,
    }));
    expect(mocks.accepted).toHaveBeenCalled();
  });

  it('settles an unknown outcome from node lookup without another submission', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.lookup.mockResolvedValue({ txid: 'b'.repeat(64) });
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.accepted).toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalled();
  });

  it('leaves an ambiguous retry durable for a later worker pass', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.broadcast.mockRejectedValue(new Error('connection lost'));
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.unknown).toHaveBeenCalledWith('intent-1', expect.any(String), 'connection lost');
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('does not lose accepted state when transaction persistence is temporarily unavailable', async () => {
    mocks.list.mockResolvedValue([record('accepted')]);
    mocks.persist.mockRejectedValue(new Error('database unavailable'));
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('skips malformed durable records without touching the network', async () => {
    mocks.list.mockResolvedValue([{ ...record('unknown'), broadcastMetadata: null }]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('retains a claimed retry when its durable authorization snapshot is malformed', async () => {
    mocks.list.mockResolvedValue([{ ...record('unknown'), snapshot: {} }]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.claim).toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.accepted).not.toHaveBeenCalled();
  });

  it('skips accepted records whose durable artifact is incomplete', async () => {
    mocks.list.mockResolvedValue([{ ...record('accepted'), broadcastTxid: null }]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    { broadcastMetadata: [] },
    { broadcastMetadata: { ...metadata, recipient: 1 } },
    { broadcastMetadata: { ...metadata, amount: 1.5 } },
    { broadcastMetadata: { ...metadata, fee: Number.MAX_SAFE_INTEGER + 1 } },
    { broadcastMetadata: { ...metadata, utxos: null } },
    { broadcastMetadata: { ...metadata, utxos: [{ txid: 'not-a-txid', vout: 0 }] } },
    { broadcastMetadata: { ...metadata, utxos: [{ txid: 'd'.repeat(64), vout: -1 }] } },
    { broadcastMetadata: { ...metadata, outputs: [{
      address: 'tb1qrecipient', amount: 1, outputType: 'recipient', isOurs: false, unexpected: true,
    }] } },
    { broadcastTxid: null },
    { broadcastRawTx: null },
    { network: 'invalid' },
  ])('skips incomplete durable evidence: %j', async override => {
    mocks.list.mockResolvedValue([{ ...record('unknown'), ...override }]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'busy'] as const)('does not steal a non-claimable reconciliation lease: %s', async status => {
    mocks.list.mockResolvedValue([{ ...record('unknown'), snapshot: {} }]);
    mocks.claim.mockResolvedValue({ status });
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('treats an already-complete claim as idempotently reconciled', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.claim.mockResolvedValue({ status: 'complete' });
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('preserves authenticated replacement semantics during exact-artifact resubmission', async () => {
    mocks.list.mockResolvedValue([{
      ...record('unknown'),
      snapshot: snapshot('c'.repeat(64)),
    }]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({ replacement: true }));
  });

  it('stops when accepted-state CAS loses the lease after lookup or rebroadcast', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.lookup.mockResolvedValueOnce({ txid: 'b'.repeat(64) });
    mocks.accepted.mockResolvedValueOnce(false);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.persist).not.toHaveBeenCalled();

    mocks.lookup.mockRejectedValueOnce(new Error('not found'));
    mocks.accepted.mockResolvedValueOnce(false);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
  });
});
