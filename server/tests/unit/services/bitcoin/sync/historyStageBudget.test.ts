import * as bitcoin from 'bitcoinjs-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestContext,
  receiveEvidenceGatePhase,
} from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import { fetchHistoriesPhase } from '../../../../../src/services/bitcoin/sync/phases/fetchHistories';
import { fetchAuthenticatedOutpoints } from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { SyncRemoteStageBudgetError } from '../../../../../src/services/bitcoin/sync/attemptRuntime';
import { ReceiveEvidenceRetryableError } from '../../../../../src/services/bitcoin/sync/types';

const HANG = Number.POSITIVE_INFINITY;

vi.mock('../../../../../src/websocket/notifications', () => ({ walletLog: vi.fn() }));
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Run the compact projector in-process: the budget under test lives in the
// remote stages, not in the worker transport.
vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  );
  const sealed = (envelope: any) => ({
    expectedTxid: envelope.txid,
    canonicalBytes: envelope.canonicalBytes,
    digest: envelope.digest,
    complexity: envelope.complexity,
    metadata: envelope.metadata,
  });
  return {
    ...actual,
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => ({
      projectCompact: async (input: any) => projection.projectCompactAuthenticatedTransaction({
        expectedTxid: input.expectedTxid,
        remoteTxid: input.details.txid,
        canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex ?? '', 'hex')),
        metadata: {},
        limits: input.limits,
      }, walletScripts),
      projectFull: async (envelope: any) => projection.reprojectFullAuthenticatedTransaction(sealed(envelope)),
      extractOutputs: async (envelope: any, vouts: readonly number[]) => (
        projection.extractExactAuthenticatedTransactionOutputs(sealed(envelope), vouts)
      ),
      close: async () => undefined,
    }),
  };
});

const payment = bitcoin.payments.p2wpkh({
  pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
  network: bitcoin.networks.testnet,
});
const walletScript = Buffer.from(payment.output!).toString('hex');

/** A coinbase-funded payment to the wallet script (no parent to fetch). */
const walletPayment = (ordinal: number): RawTransaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.locktime = ordinal;
  transaction.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Buffer.from([2, ordinal & 0xff, ordinal >> 8]));
  transaction.addOutput(payment.output!, 1_000n);
  return { txid: transaction.getId(), hex: transaction.toHex(), vin: [], vout: [] };
};

/** Resolves after `ms` (never when HANG), or rejects with the stage's abort reason. */
const remote = <T>(ms: number, value: () => T, signal?: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const timer = ms === HANG ? undefined : setTimeout(() => resolve(value()), ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

interface Wallet {
  /** Empty-history addresses besides the funded one. */
  idleAddresses: number;
  payments: RawTransaction[];
  historyBatchMs: number;
  evidenceBatchMs: number;
  attempt?: AbortController;
}

const walletContext = (wallet: Wallet) => {
  const funded = {
    id: 'funded', address: payment.address!, derivationPath: "m/84'/1'/0'/0/0",
    scriptPubKey: walletScript,
  };
  const idle = Array.from({ length: wallet.idleAddresses }, (_, index) => ({
    id: `idle-${index}`, address: `tb1qidle${index}`, derivationPath: `m/84'/1'/0'/0/${index + 1}`,
    scriptPubKey: `0014${index.toString(16).padStart(40, '0')}`,
  }));
  const byTxid = new Map(wallet.payments.map(details => [details.txid, details]));
  const history = wallet.payments.map((details, index) => ({ tx_hash: details.txid, height: 100 + index }));
  const client = {
    getAddressHistoryBatch: vi.fn((addresses: string[], options?: { signal?: AbortSignal }) => remote(
      wallet.historyBatchMs,
      () => new Map(addresses.map(address => [address, address === funded.address ? history : []])),
      options?.signal,
    )),
    getAddressHistory: vi.fn(),
    getTransactionsBatch: vi.fn((txids: string[], _verbose: boolean, options?: { signal?: AbortSignal }) => remote(
      wallet.evidenceBatchMs,
      () => new Map(txids.flatMap(txid => byTxid.has(txid) ? [[txid, byTxid.get(txid)!] as const] : [])),
      options?.signal,
    )),
    getTransaction: vi.fn(),
  };
  const attempt = wallet.attempt ?? new AbortController();
  return createTestContext({
    walletId: 'wallet-id',
    network: 'testnet3',
    addresses: [funded, ...idle] as any,
    walletScriptToAddress: new Map([[walletScript, funded]]) as any,
    client: client as any,
    attemptRuntime: { signal: attempt.signal, deadlineAt: Date.now() + 30 * 60_000 },
  });
};

/** Runs the phase to settlement on fake time; returns the context or the rejection. */
const settle = async (ctx: ReturnType<typeof walletContext>, advanceMs: number) => {
  const pending = fetchHistoriesPhase(ctx).then(result => result, (error: unknown) => error);
  await vi.advanceTimersByTimeAsync(advanceMs);
  return pending;
};

afterEach(() => vi.useRealTimers());

describe('address-history stage budget scales with the wallet', () => {
  it('completes a history fetch that needs more than five minutes of round trips', async () => {
    vi.useFakeTimers();
    // 2,000 addresses = 200 sequential batches at 1.8 s = 360 s of history fetch.
    const ctx = walletContext({
      idleAddresses: 1_999, payments: [walletPayment(1)], historyBatchMs: 1_800, evidenceBatchMs: 50,
    });

    const outcome = await settle(ctx, 20 * 60_000);

    expect(outcome).toBe(ctx);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map());
    expect(ctx.allTxids.size).toBe(1);
    await expect(receiveEvidenceGatePhase(ctx)).resolves.toBe(ctx);
  }, 60_000);

  it('authenticates a history whose transaction evidence needs more than five minutes', async () => {
    vi.useFakeTimers();
    // 2,000 history transactions = 200 sequential evidence batches at 1.6 s = 320 s.
    const payments = Array.from({ length: 2_000 }, (_, index) => walletPayment(index + 1));
    const ctx = walletContext({ idleAddresses: 0, payments, historyBatchMs: 50, evidenceBatchMs: 1_600 });

    const outcome = await settle(ctx, 20 * 60_000);

    expect(outcome).toBe(ctx);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map());
    expect(ctx.allTxids.size).toBe(2_000);
  }, 60_000);
});

describe('address-history budget expiry continues with complete evidence', () => {
  it('records the unsettled addresses and reaches the retryable receive gate', async () => {
    vi.useFakeTimers();
    const ctx = walletContext({ idleAddresses: 1, payments: [walletPayment(1)], historyBatchMs: HANG, evidenceBatchMs: 50 });

    const outcome = await settle(ctx, 6 * 60_000);

    expect(outcome).toBe(ctx);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['fetch_budget_exhausted', 2]]));
    await expect(receiveEvidenceGatePhase(ctx)).rejects.toBeInstanceOf(ReceiveEvidenceRetryableError);
  });

  it('records each unsettled transaction when its evidence outlives the stage budget', async () => {
    vi.useFakeTimers();
    const payments = [walletPayment(1), walletPayment(2)];
    const ctx = walletContext({ idleAddresses: 0, payments, historyBatchMs: 50, evidenceBatchMs: HANG });

    const outcome = await settle(ctx, 6 * 60_000);

    expect(outcome).toBe(ctx);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['fetch_budget_exhausted', 2]]));
    await expect(receiveEvidenceGatePhase(ctx)).rejects.toThrow('fetch_budget_exhausted x 2');
  });

  it('still fails the phase on attempt cancellation', async () => {
    vi.useFakeTimers();
    const attempt = new AbortController();
    const ctx = walletContext({
      idleAddresses: 0, payments: [walletPayment(1)], historyBatchMs: 50, evidenceBatchMs: HANG, attempt,
    });
    const reason = new Error('lease lost');
    setTimeout(() => attempt.abort(reason), 1_000);

    await expect(settle(ctx, 2_000)).resolves.toBe(reason);
  });

  it('fetchAuthenticatedOutpoints records pending parents after a budget expiry instead of throwing', async () => {
    const parent = walletPayment(7);
    const ctx = walletContext({ idleAddresses: 0, payments: [parent], historyBatchMs: 0, evidenceBatchMs: 0 });
    const stage = new AbortController();
    stage.abort(new SyncRemoteStageBudgetError('history_parents'));

    await expect(fetchAuthenticatedOutpoints(ctx, new Map([[parent.txid, new Set([0])]]), {
      signal: stage.signal,
    })).resolves.toBeUndefined();
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['fetch_budget_exhausted', 1]]));
  });

  it('fetchAuthenticatedOutpoints still rejects with the reason of an attempt cancelled before the lock', async () => {
    const parent = walletPayment(8);
    const ctx = walletContext({ idleAddresses: 0, payments: [parent], historyBatchMs: 0, evidenceBatchMs: 0 });
    const attempt = new AbortController();
    const reason = new Error('lease lost');
    attempt.abort(reason);

    await expect(fetchAuthenticatedOutpoints(ctx, new Map([[parent.txid, new Set([0])]]), {
      signal: attempt.signal,
    })).rejects.toBe(reason);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map());
  });
});
