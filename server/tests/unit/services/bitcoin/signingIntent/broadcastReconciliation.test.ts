import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), claim: vi.fn(), accepted: vi.fn(), complete: vi.fn(), unknown: vi.fn(),
  rejected: vi.fn(), broadcast: vi.fn(), persist: vi.fn(),
  lookup: vi.fn(), stalled: vi.fn(), listStalled: vi.fn(), claimLookup: vi.fn(), stalledAccepted: vi.fn(),
  defer: vi.fn(), log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../../src/utils/logger', () => ({ createLogger: () => mocks.log }));
vi.mock('../../../../../src/repositories/transactionSigningIntentRepository', () => ({
  MAX_RECONCILE_ATTEMPTS: 60, // pinned against the real constant in transactionSigningIntentRepository.test.ts
  transactionSigningIntentRepository: {
    listBroadcastsForReconciliation: mocks.list,
    claimBroadcast: mocks.claim,
    markBroadcastAccepted: mocks.accepted,
    markBroadcastComplete: mocks.complete,
    markBroadcastUnknown: mocks.unknown,
    releaseRejectedBroadcast: mocks.rejected,
    markBroadcastStalled: mocks.stalled,
    listStalledBroadcastsForLookup: mocks.listStalled,
    claimStalledBroadcastLookup: mocks.claimLookup,
    markStalledBroadcastAccepted: mocks.stalledAccepted,
    deferAcceptedReconciliation: mocks.defer,
  },
}));
vi.mock('../../../../../src/services/bitcoin/blockchain', async () => {
  const actual = await vi.importActual<typeof import('../../../../../src/services/bitcoin/blockchain/networkOperations')>(
    '../../../../../src/services/bitcoin/blockchain/networkOperations',
  );
  return {
    broadcastAuthenticatedRawTransaction: mocks.broadcast,
    getTransactionDetails: mocks.lookup,
    // The real predicate: classification is exercised end to end with typed causes.
    isNodeAnsweredBroadcastFailure: actual.isNodeAnsweredBroadcastFailure,
  };
});
vi.mock('../../../../../src/services/bitcoin/transactions/persistTransaction', () => ({
  persistTransaction: mocks.persist,
}));

import { reconcileSigningIntentBroadcasts } from '../../../../../src/services/bitcoin/signingIntent/broadcastReconciliation';
import { ElectrumRpcError } from '../../../../../src/services/bitcoin/electrum/types';
import { BroadcastPreflightError } from '../../../../../src/services/bitcoin/blockchain/broadcastPreflight';
import { parseAuthenticatedRawTransaction } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import { buildTransaction, walletOutput } from '../sync/confirmations/confirmationsNodeFixtures';

const lookupTransaction = (valueSats: bigint) => buildTransaction({
  inputs: [{ txid: 'd'.repeat(64), vout: 0 }],
  outputs: [{ script: walletOutput(1).script, valueSats }],
});
const LOOKUP_TX = lookupTransaction(BigInt(9_000));
// Differs from LOOKUP_TX only in one output value: well-formed bytes for a different txid.
const OTHER_TX = lookupTransaction(BigInt(9_001));
const TX_HEX = LOOKUP_TX.toHex();
const TXID = LOOKUP_TX.getId();
const OTHER_TX_HEX = OTHER_TX.toHex();
const OTHER_TXID = OTHER_TX.getId();

const unknownOutcome = (cause: unknown) =>
  Object.assign(new Error('Broadcast outcome is unknown: boom'), { cause });

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
  snapshot: snapshot(), broadcastState: state, broadcastTxid: TXID,
  broadcastRawTx: '00', broadcastMetadata: metadata, broadcastLeaseExpiresAt: new Date(0),
  broadcastLastAttemptAt: new Date(0),
});

describe('signing intent broadcast reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ status: 'claimed', record: { broadcastAttemptCount: 1 } });
    mocks.listStalled.mockResolvedValue([]);
    mocks.claimLookup.mockResolvedValue(true);
    mocks.stalledAccepted.mockResolvedValue(true);
    mocks.stalled.mockResolvedValue(true);
    mocks.accepted.mockResolvedValue(true);
    mocks.complete.mockResolvedValue(true);
    mocks.broadcast.mockResolvedValue({ txid: TXID, broadcasted: true });
    mocks.lookup.mockRejectedValue(new Error('not found'));
    mocks.persist.mockResolvedValue({});
    mocks.defer.mockResolvedValue({ count: 1 });
  });

  it('finishes durable persistence without rebroadcasting an accepted transaction', async () => {
    mocks.list.mockResolvedValue([record('accepted')]);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    // The intent id lets persistence archive a draft saved while the broadcast
    // was in flight: the frozen metadata carries no draftId for it.
    expect(mocks.persist).toHaveBeenCalledWith('wallet-1', TXID, '00', metadata, { signingIntentId: 'intent-1' });
  });

  it('leases and idempotently rebroadcasts an unknown outcome before persistence', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    mocks.list.mockResolvedValue([record('unknown')]);
    await expect(reconcileSigningIntentBroadcasts(now))
      .resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'intent-1', txid: TXID, leaseToken: expect.any(String), now,
      leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
    }));
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ allowStalled: false }));
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      rawTx: '00', expectedTxid: TXID, network: 'testnet3', replacement: false,
      allowDefiniteRejection: false,
    }));
    expect(mocks.accepted).toHaveBeenCalled();
  });

  it('settles an unknown outcome from node lookup without another submission', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.lookup.mockResolvedValue({ txid: TXID, hex: TX_HEX });
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.accepted).toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalled();
  });

  it('leaves an ambiguous retry durable for a later worker pass', async () => {
    mocks.list.mockResolvedValue([record('unknown')]);
    mocks.broadcast.mockRejectedValue(new Error('connection lost'));
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.unknown).toHaveBeenCalledWith('intent-1', expect.any(String), 'connection lost', {
      countAttempt: false,
    });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('does not lose accepted state when transaction persistence is temporarily unavailable', async () => {
    mocks.list.mockResolvedValue([record('accepted')]);
    mocks.persist.mockRejectedValue(new Error('database unavailable'));
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('moves a record whose reconciliation keeps failing to the back of the next batch', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    mocks.list.mockResolvedValue([record('accepted')]);
    mocks.persist.mockRejectedValue(new Error('Record to update not found.'));
    await expect(reconcileSigningIntentBroadcasts(now)).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.defer).toHaveBeenCalledWith('intent-1', now);
  });

  it('keeps reconciling the batch and the stalled pass when deferring a failed record fails', async () => {
    const deferError = new Error('database unavailable');
    mocks.list.mockResolvedValue([record('accepted'), { ...record('accepted'), id: 'intent-2' }]);
    mocks.persist.mockRejectedValueOnce(new Error('Record to update not found.'));
    mocks.defer.mockRejectedValueOnce(deferError);
    mocks.listStalled.mockResolvedValue([{ ...record('unknown'), id: 'intent-3' }]);
    mocks.lookup.mockResolvedValue({ txid: TXID, hex: TX_HEX });
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 2, completed: 1 });
    expect(mocks.log.warn).toHaveBeenCalledWith(
      'Could not defer failed signing intent reconciliation',
      expect.objectContaining({ intentId: 'intent-1', error: 'database unavailable' }),
    );
    expect(mocks.persist).toHaveBeenCalledTimes(3);
    expect(mocks.claimLookup).toHaveBeenCalledWith('intent-3', expect.any(Date));
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
    mocks.lookup.mockResolvedValueOnce({ txid: TXID, hex: TX_HEX });
    mocks.accepted.mockResolvedValueOnce(false);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    expect(mocks.persist).not.toHaveBeenCalled();

    mocks.lookup.mockRejectedValueOnce(new Error('not found'));
    mocks.accepted.mockResolvedValueOnce(false);
    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
  });

  describe('attempt cap', () => {
    const failWith = async (attempts: number, error: Error) => {
      mocks.list.mockResolvedValue([record('unknown')]);
      mocks.claim.mockResolvedValue({ status: 'claimed', record: { broadcastAttemptCount: attempts } });
      mocks.broadcast.mockRejectedValue(error);
      await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 0 });
    };

    it('stalls at the cap when the node answered with a verdict', async () => {
      await failWith(60, unknownOutcome(new ElectrumRpcError('min relay fee not met')));
      expect(mocks.stalled).toHaveBeenCalledWith('intent-1', expect.any(String), 'Broadcast outcome is unknown: boom');
      expect(mocks.unknown).not.toHaveBeenCalled();
    });

    it('stalls past the cap too', async () => {
      await failWith(61, unknownOutcome(new ElectrumRpcError('txn-already-known')));
      expect(mocks.stalled).toHaveBeenCalledTimes(1);
    });

    it('keeps the intent unknown one attempt below the cap and counts the answered attempt', async () => {
      await failWith(59, unknownOutcome(new ElectrumRpcError('min relay fee not met')));
      expect(mocks.stalled).not.toHaveBeenCalled();
      expect(mocks.unknown).toHaveBeenCalledWith('intent-1', expect.any(String), expect.any(String), {
        countAttempt: true,
      });
    });

    it('stalls at the cap on a node-data preflight rejection', async () => {
      await failWith(60, unknownOutcome(new BroadcastPreflightError('spent', 'node_preflight_rejected')));
      expect(mocks.stalled).toHaveBeenCalledTimes(1);
      expect(mocks.unknown).not.toHaveBeenCalled();
    });

    it.each([
      ['preflight unavailable', unknownOutcome(new BroadcastPreflightError('down', 'node_preflight_unavailable'))],
      ['non-verdict RPC error', unknownOutcome(new ElectrumRpcError('bitcoind is not reachable'))],
      ['transport failure', unknownOutcome(new Error('socket hang up'))],
      ['unwrapped failure', new Error('Broadcast outcome is unknown: boom')],
    ])('never stalls and gives the attempt back for %s', async (_label, error) => {
      await failWith(60, error);
      expect(mocks.stalled).not.toHaveBeenCalled();
      expect(mocks.unknown).toHaveBeenCalledWith('intent-1', expect.any(String), expect.any(String), {
        countAttempt: false,
      });
    });
  });

  describe('stalled lookup pass', () => {
    const stalledRecord = { ...record('unknown'), broadcastState: 'stalled' };

    it('moves a stalled intent that now exists on the node to accepted without rebroadcasting', async () => {
      const now = new Date('2030-01-01T00:00:00Z');
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord]);
      mocks.lookup.mockResolvedValue({ txid: TXID, hex: TX_HEX });
      await expect(reconcileSigningIntentBroadcasts(now, 5)).resolves.toEqual({ examined: 0, completed: 0 });
      expect(mocks.listStalled).toHaveBeenCalledWith(now, 5);
      expect(mocks.claimLookup).toHaveBeenCalledWith('intent-1', now);
      expect(mocks.lookup).toHaveBeenCalledWith(TXID, 'testnet3');
      expect(mocks.stalledAccepted).toHaveBeenCalledWith('intent-1', TXID, now);
      expect(mocks.persist).toHaveBeenCalledWith('wallet-1', TXID, '00', metadata, { signingIntentId: 'intent-1' });
      expect(mocks.complete).toHaveBeenCalledWith('intent-1', TXID);
      expect(mocks.broadcast).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();
    });

    it('leaves a stalled intent stalled when the node does not know the txid', async () => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord]);
      mocks.lookup.mockRejectedValue(new Error('not found'));
      await reconcileSigningIntentBroadcasts();
      expect(mocks.stalledAccepted).not.toHaveBeenCalled();
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.broadcast).not.toHaveBeenCalled();
    });

    it('skips the lookup when another worker already looked within the interval', async () => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord]);
      mocks.claimLookup.mockResolvedValue(false);
      await reconcileSigningIntentBroadcasts();
      expect(mocks.lookup).not.toHaveBeenCalled();
    });

    it('leaves the intent to a concurrent user claim when the stalled to accepted transition is lost', async () => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord]);
      mocks.lookup.mockResolvedValue({ txid: TXID, hex: TX_HEX });
      mocks.stalledAccepted.mockResolvedValue(false);
      await reconcileSigningIntentBroadcasts();
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    });

    it.each([{ network: 'invalid' }, { broadcastTxid: null }])('skips a stalled record with bad evidence %j', async override => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([{ ...stalledRecord, ...override }]);
      await reconcileSigningIntentBroadcasts();
      expect(mocks.claimLookup).not.toHaveBeenCalled();
      expect(mocks.lookup).not.toHaveBeenCalled();
    });

    it('isolates a failing stalled record from the rest of the pass', async () => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord, { ...stalledRecord, id: 'intent-2' }]);
      mocks.claimLookup.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(true);
      mocks.lookup.mockResolvedValue({ txid: TXID, hex: TX_HEX });
      await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 0, completed: 0 });
      expect(mocks.stalledAccepted).toHaveBeenCalledTimes(1);
      expect(mocks.stalledAccepted).toHaveBeenCalledWith('intent-2', TXID, expect.any(Date));
    });
  });

  describe('node lookup authentication', () => {
    const stalledRecord = { ...record('unknown'), broadcastState: 'stalled' };

    it('re-broadcasts an uncertain intent instead of accepting bytes for a different txid', async () => {
      expect(parseAuthenticatedRawTransaction({ expectedTxid: OTHER_TXID, rawHex: OTHER_TX_HEX }).txid).toBe(OTHER_TXID);
      mocks.list.mockResolvedValue([record('unknown')]);
      mocks.lookup.mockResolvedValue({ txid: OTHER_TXID, hex: OTHER_TX_HEX });
      await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
      expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({ expectedTxid: TXID }));
      expect(mocks.accepted).toHaveBeenCalledTimes(1);
      expect(mocks.accepted.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.broadcast.mock.invocationCallOrder[0]);
    });

    it('leaves a stalled intent stalled when the lookup returns bytes for a different txid', async () => {
      mocks.list.mockResolvedValue([]);
      mocks.listStalled.mockResolvedValue([stalledRecord]);
      mocks.lookup.mockResolvedValue({ txid: OTHER_TXID, hex: OTHER_TX_HEX });
      await reconcileSigningIntentBroadcasts();
      expect(mocks.stalledAccepted).not.toHaveBeenCalled();
      expect(mocks.persist).not.toHaveBeenCalled();
    });

    it('treats a lookup without transaction bytes as a miss on both paths', async () => {
      mocks.list.mockResolvedValue([record('unknown')]);
      mocks.listStalled.mockResolvedValue([{ ...stalledRecord, id: 'intent-2' }]);
      mocks.lookup.mockResolvedValue({ txid: TXID });
      await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });
      expect(mocks.broadcast).toHaveBeenCalledTimes(1);
      expect(mocks.accepted.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.broadcast.mock.invocationCallOrder[0]);
      expect(mocks.stalledAccepted).not.toHaveBeenCalled();
    });
  });
});
