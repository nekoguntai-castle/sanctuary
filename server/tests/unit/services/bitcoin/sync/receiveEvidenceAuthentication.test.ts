import * as bitcoin from 'bitcoinjs-lib';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestContext,
  fetchHistoriesPhase,
  fetchUtxosPhase,
  receiveEvidenceGatePhase,
} from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import {
  authenticateHistoryResults,
  fetchAuthenticatedTransactions,
  MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT,
  MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT,
  MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT,
  MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT,
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { projectAuthenticatedTransaction } from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';
import { SyncRemoteStageBudgetError } from '../../../../../src/services/bitcoin/sync/attemptRuntime';
import { ElectrumFrameTooLargeError } from '../../../../../src/services/bitcoin/electrum/protocol';

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const { projectAuthenticatedTransaction } = await import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  );
  return {
    projectTransactionEvidenceOffThread: async (
      input: Parameters<typeof projectAuthenticatedTransaction>[0],
      signal?: AbortSignal,
      _createWorker?: unknown,
      shouldAbort: (reason: unknown) => boolean = () => true,
    ) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (signal?.aborted && shouldAbort(signal.reason)) signal.throwIfAborted();
      return projectAuthenticatedTransaction(input);
    },
  };
});

const makeRawTransaction = (script: Uint8Array, value: bigint) => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(script, value);
  return transaction;
};

const details = (transaction: bitcoin.Transaction): RawTransaction => ({
  txid: transaction.getId(),
  hex: transaction.toHex(),
  vin: [],
  vout: [],
});

const spendingTransaction = (previous: bitcoin.Transaction, outputScript: Uint8Array) => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.from(previous.getId(), 'hex').reverse(), 0);
  transaction.addOutput(outputScript, 1n);
  return transaction;
};

const addressRecord = (script: Uint8Array, address: string) => ({
  id: 'address-id',
  walletId: 'wallet-id',
  address,
  derivationPath: "m/84'/1'/0'/0/0",
  index: 0,
  branch: 0,
  coordinateVersion: 1,
  canonicalPolicyId: 'single_sig_native_segwit',
  canonicalPolicyVersion: 1,
  scriptPubKey: Buffer.from(script).toString('hex'),
  used: false,
  createdAt: new Date(),
});

const clientFor = (transactions: Map<string, RawTransaction>) => ({
  getAddressHistoryBatch: vi.fn(),
  getAddressHistory: vi.fn(),
  getAddressUTXOsBatch: vi.fn(),
  getAddressUTXOs: vi.fn(),
  getTransactionsBatch: vi.fn(async (txids: string[]) => new Map(
    txids.flatMap(txid => transactions.has(txid) ? [[txid, transactions.get(txid)!] as const] : []),
  )),
  getTransaction: vi.fn(async (txid: string) => transactions.get(txid)),
});

describe('full-wallet receive evidence authentication', () => {
  it.each([
    [{ maxInputs: 0, maxOutputs: 1, maxScriptHexChars: 2 }, 'input'],
    [{ maxInputs: 1, maxOutputs: 0, maxScriptHexChars: 2 }, 'output'],
    [{ maxInputs: 1, maxOutputs: 1, maxScriptHexChars: 0 }, 'script'],
  ])('rejects a transaction above its worker-side %s projection limit', (limits) => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 1n);

    expect(() => projectAuthenticatedTransaction({
      expectedTxid: transaction.getId(),
      details: details(transaction),
      network: 'mainnet',
      limits,
    })).toThrow(expect.objectContaining({ reason: 'transaction_complexity_exceeded' }));
  });

  it('yields the event loop while projecting a high-fanout authenticated transaction', async () => {
    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    transaction.addInput(new Uint8Array(32), 0xffffffff);
    for (let index = 0; index < 4; index++) {
      transaction.addOutput(Uint8Array.from([0x51]), 1n);
    }
    const client = clientFor(new Map([[transaction.getId(), details(transaction)]]));
    const ctx = createTestContext({ client: client as any });
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
      clock += 30;
      return clock;
    });
    let heartbeatCount = 0;
    let heartbeatActive = true;
    const heartbeat = (): void => {
      if (!heartbeatActive) return;
      heartbeatCount += 1;
      setImmediate(heartbeat);
    };
    setImmediate(heartbeat);

    try {
      await expect(fetchAuthenticatedTransactions(
        ctx,
        [transaction.getId()],
      )).resolves.toEqual(new Set([transaction.getId()]));
    } finally {
      heartbeatActive = false;
      now.mockRestore();
    }

    expect(heartbeatCount).toBeGreaterThanOrEqual(1);
    expect(ctx.txDetailsCache.get(transaction.getId())?.vout).toHaveLength(4);
  });

  it('bounds authenticated raw-transaction requests to ten items per batch', async () => {
    const transactions = Array.from({ length: 11 }, (_, index) => (
      makeRawTransaction(Uint8Array.from([0x51]), BigInt(index + 1))
    ));
    const transactionMap = new Map(transactions.map(transaction => [
      transaction.getId(),
      details(transaction),
    ]));
    const client = clientFor(transactionMap);
    const ctx = createTestContext({ client: client as any });
    const txids = transactions.map(transaction => transaction.getId());

    await expect(fetchAuthenticatedTransactions(ctx, txids)).resolves.toEqual(new Set(txids));

    expect(client.getTransactionsBatch).toHaveBeenCalledTimes(2);
    expect(client.getTransactionsBatch).toHaveBeenNthCalledWith(1, txids.slice(0, 10), false);
    expect(client.getTransactionsBatch).toHaveBeenNthCalledWith(2, txids.slice(10), false);
  });

  it('uses the raw evidence client path without main-thread transaction decoding', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 1n);
    const client = {
      ...clientFor(new Map([[transaction.getId(), details(transaction)]])),
      getRawTransactionEvidenceBatch: vi.fn(async () => new Map([[
        transaction.getId(),
        details(transaction),
      ]])),
    };
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));

    expect(client.getRawTransactionEvidenceBatch).toHaveBeenCalledWith(
      [transaction.getId()],
      undefined,
    );
    expect(client.getTransactionsBatch).not.toHaveBeenCalled();
  });

  it('fails closed before retaining evidence beyond the attempt output ceiling', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 1n);
    const existingTxid = '01'.repeat(32);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
      txDetailsCache: new Map([[existingTxid, {
        txid: existingTxid,
        hex: '00',
        vin: [],
        vout: new Array(MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT),
      } as RawTransaction]]),
    });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set());

    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(false);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['transaction_complexity_exceeded', 1],
    ]));
  });

  it.each([
    ['raw hex', {
      hex: { length: MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT } as string,
      vin: [],
      vout: [],
    }],
    ['inputs', {
      hex: '00',
      vin: new Array(MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT),
      vout: [],
    }],
    ['scripts', {
      hex: '00',
      vin: [{ coinbase: { length: MAX_AUTHENTICATED_SCRIPT_HEX_CHARS_PER_ATTEMPT } as string }],
      vout: [],
    }],
  ])('fails closed beyond the retained %s ceiling', async (_label, cached) => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 1n);
    const existingTxid = '02'.repeat(32);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
      txDetailsCache: new Map([[existingTxid, {
        txid: existingTxid,
        ...cached,
      } as RawTransaction]]),
    });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['transaction_complexity_exceeded', 1],
    ]));
  });

  it('propagates an already-aborted attempt instead of recording evidence failure', async () => {
    const controller = new AbortController();
    const reason = new Error('attempt cancelled before raw fetch');
    controller.abort(reason);
    const client = clientFor(new Map());
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      ['10'.repeat(32)],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    )).rejects.toBe(reason);

    expect(ctx.rejectedEvidenceCount).toBe(0);
    expect(client.getTransactionsBatch).not.toHaveBeenCalled();
  });

  it('does not cache a partially projected transaction when the attempt is cancelled', async () => {
    const transaction = new bitcoin.Transaction();
    transaction.version = 2;
    transaction.addInput(new Uint8Array(32), 0xffffffff);
    for (let index = 0; index < 4; index++) {
      transaction.addOutput(Uint8Array.from([0x51]), 1n);
    }
    const controller = new AbortController();
    const reason = new Error('attempt cancelled during raw projection');
    const client = clientFor(new Map([[transaction.getId(), details(transaction)]]));
    const ctx = createTestContext({ client: client as any });
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
      clock += 30;
      return clock;
    });
    setImmediate(() => controller.abort(reason));

    try {
      await expect(fetchAuthenticatedTransactions(
        ctx,
        [transaction.getId()],
        { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
      )).rejects.toBe(reason);
    } finally {
      now.mockRestore();
    }

    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(false);
    expect(ctx.rejectedEvidenceCount).toBe(0);
  });

  it('attributes only the untouched next chunk when the budget expires between chunks', async () => {
    const controller = new AbortController();
    const txids = Array.from({ length: 11 }, (_, index) => index.toString(16).padStart(64, '0'));
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockImplementationOnce(async () => {
      controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
      return new Map();
    });
    const ctx = createTestContext({ client: client as any });

    const result = await fetchAuthenticatedTransactions(
      ctx,
      txids,
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    );

    expect(result).toEqual(new Set());
    expect(client.getTransactionsBatch).toHaveBeenCalledOnce();
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['missing_result', 10],
      ['fetch_budget_exhausted', 1],
    ]));
  });

  it('propagates non-budget cancellation promptly without attributing untouched results', async () => {
    const controller = new AbortController();
    const reason = new Error('attempt cancelled between raw chunks');
    const txids = Array.from({ length: 11 }, (_, index) => index.toString(16).padStart(64, '0'));
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockImplementationOnce(async () => {
      controller.abort(reason);
      return new Map();
    });
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      txids,
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    )).rejects.toBe(reason);

    expect(client.getTransactionsBatch).toHaveBeenCalledOnce();
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map());
  });

  it('attributes the current batch when its request ends on local budget expiry', async () => {
    const controller = new AbortController();
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockImplementation(async () => {
      controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
      throw new Error('request stopped at deadline');
    });
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      ['20'.repeat(32), '21'.repeat(32)],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    )).resolves.toEqual(new Set());

    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['fetch_budget_exhausted', 2],
    ]));
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('propagates cancellation raised by a batch request without fallback', async () => {
    const controller = new AbortController();
    const reason = new Error('attempt cancelled during raw batch');
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      ['30'.repeat(32)],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    )).rejects.toBe(reason);

    expect(ctx.rejectedEvidenceCount).toBe(0);
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('propagates non-budget cancellation raised by fallback scheduling', async () => {
    const controller = new AbortController();
    const reason = new Error('attempt cancelled during raw fallback');
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    client.getTransaction.mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      ['31'.repeat(32)],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    )).rejects.toBe(reason);

    expect(client.getTransaction).toHaveBeenCalledOnce();
    expect(ctx.rejectedEvidenceCount).toBe(0);
  });

  it('rejects a missing individual fallback result without accepting the candidate', async () => {
    const txid = '32'.repeat(32);
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(ctx, [txid])).resolves.toEqual(new Set());

    expect(client.getTransaction).toHaveBeenCalledWith(txid, false);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['missing_result', 1]]));
  });

  it('uses raw individual evidence after a batch transport failure', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 3n);
    const client = {
      ...clientFor(new Map()),
      getTransactionsBatch: vi.fn().mockRejectedValue(new Error('batch unavailable')),
      getRawTransactionEvidence: vi.fn().mockResolvedValue(details(transaction)),
    };
    const ctx = createTestContext({ client: client as any });
    const options = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 5_000,
    };

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()], options))
      .resolves.toEqual(new Set([transaction.getId()]));

    expect(client.getRawTransactionEvidence).toHaveBeenCalledWith(
      transaction.getId(),
      options,
    );
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('rejects an absent raw individual evidence result', async () => {
    const txid = '33'.repeat(32);
    const client = {
      ...clientFor(new Map()),
      getTransactionsBatch: vi.fn().mockRejectedValue(new Error('batch unavailable')),
      getRawTransactionEvidence: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(ctx, [txid])).resolves.toEqual(new Set());

    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['missing_result', 1]]));
  });

  it('does not count a settled fallback failure again when a sibling exhausts the budget', async () => {
    const acceptedTransaction = makeRawTransaction(Uint8Array.from([0x51]), 4n);
    const failedTxid = 'cc'.repeat(32);
    const budgetTxid = 'dd'.repeat(32);
    const controller = new AbortController();
    let started = 0;
    let resolveAllStarted!: () => void;
    const allStarted = new Promise<void>(resolve => {
      resolveAllStarted = resolve;
    });
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    client.getTransaction.mockImplementation(
      async (txid: string, _verbose?: boolean, options?: { signal?: AbortSignal }) => {
        started++;
        if (started === 3) resolveAllStarted();
        if (txid === acceptedTransaction.getId()) return details(acceptedTransaction);
        if (txid === failedTxid) throw new Error('individual unavailable');
        return new Promise((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      },
    );
    const ctx = createTestContext({ client: client as any });

    const pending = fetchAuthenticatedTransactions(
      ctx,
      [acceptedTransaction.getId(), failedTxid, budgetTxid],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    );
    await allStarted;
    controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
    const result = await pending;

    expect(result).toEqual(new Set([acceptedTransaction.getId()]));
    expect(ctx.rejectedEvidenceCount).toBe(2);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['fetch_failed', 1],
      ['fetch_budget_exhausted', 1],
    ]));
  });

  it('serializes fallback projection and leaves every later candidate queued at budget expiry', async () => {
    const acceptedTransaction = makeRawTransaction(Uint8Array.from([0x51]), 5n);
    const queuedTxids = ['41'.repeat(32), '42'.repeat(32), '43'.repeat(32), '44'.repeat(32)];
    const controller = new AbortController();
    const started: string[] = [];
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    client.getTransaction.mockImplementation(async (txid: string) => {
      started.push(txid);
      controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
      return details(acceptedTransaction);
    });
    const ctx = createTestContext({ client: client as any });

    const result = await fetchAuthenticatedTransactions(
      ctx,
      [acceptedTransaction.getId(), ...queuedTxids],
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    );

    expect(result).toEqual(new Set([acceptedTransaction.getId()]));
    expect(started).toEqual([acceptedTransaction.getId()]);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['fetch_budget_exhausted', queuedTxids.length],
    ]));
    expect(ctx.rejectedEvidenceCount).toBe(queuedTxids.length);
  });

  it('records every unresolved candidate once when its remote budget is already exhausted', async () => {
    const controller = new AbortController();
    controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
    const client = clientFor(new Map());
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(
      ctx,
      ['aa'.repeat(32), 'aa'.repeat(32), 'bb'.repeat(32)],
      { signal: controller.signal, deadlineAt: Date.now() },
    )).resolves.toEqual(new Set());

    expect(ctx.rejectedEvidenceCount).toBe(2);
    expect(client.getTransactionsBatch).not.toHaveBeenCalled();
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('fails a whole oversized batch closed without repeating individual fetches', async () => {
    const txids = ['ab'.repeat(32), 'cd'.repeat(32)];
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(
      new ElectrumFrameTooLargeError(17, 16),
    );
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(ctx, txids)).resolves.toEqual(new Set());

    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['response_frame_too_large', 2],
    ]));
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('classifies an oversized individual fallback response without accepting it', async () => {
    const txid = 'ef'.repeat(32);
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    client.getTransaction.mockRejectedValue(new ElectrumFrameTooLargeError(17, 16));
    const ctx = createTestContext({ client: client as any });

    await expect(fetchAuthenticatedTransactions(ctx, [txid])).resolves.toEqual(new Set());

    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['response_frame_too_large', 1],
    ]));
  });

  it('keeps only a raw-authenticated history transaction that pays the canonical script', async () => {
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    });
    const transaction = makeRawTransaction(payment.output!, 42_000n);
    const invalid = makeRawTransaction(Uint8Array.from([0x51]), 1n);
    const irrelevant = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const client = clientFor(new Map([
      [transaction.getId(), details(transaction)],
      // Bind the requested key to different raw bytes to prove txid checking.
      ['22'.repeat(32), details(invalid)],
      [invalid.getId(), { ...details(invalid), txid: '33'.repeat(32) }],
      [irrelevant.getId(), details(irrelevant)],
    ]));
    client.getAddressHistoryBatch.mockResolvedValue(new Map([[payment.address!, [
      { tx_hash: transaction.getId(), height: 10 },
      { tx_hash: '22'.repeat(32), height: 10 },
      { tx_hash: invalid.getId(), height: 10 },
      { tx_hash: irrelevant.getId(), height: 10 },
    ]]]));
    const address = addressRecord(payment.output!, payment.address!);
    const ctx = createTestContext({
      walletId: 'wallet-id',
      network: 'testnet3',
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      walletAddressSet: new Set([address.address]),
      walletScriptToAddress: new Map([[address.scriptPubKey, address]]) as any,
      client: client as any,
    });

    await fetchHistoriesPhase(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([
      { tx_hash: transaction.getId(), height: 10 },
    ]);
    expect(ctx.allTxids).toEqual(new Set([transaction.getId()]));
    expect(ctx.txDetailsCache.get(transaction.getId())?.vout[0]).toMatchObject({
      value: 0.00042,
      scriptPubKey: { hex: address.scriptPubKey, address: address.address },
    });
    expect(ctx.rejectedEvidenceCount).toBe(3);
    await expect(receiveEvidenceGatePhase(ctx)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError', rejectedCount: 3,
    });
  });

  it('persists an exact UTXO sibling but withholds destructive authority after a mismatch', async () => {
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    });
    const good = makeRawTransaction(payment.output!, 50_000n);
    const bad = makeRawTransaction(payment.output!, 60_000n);
    const client = clientFor(new Map([
      [good.getId(), details(good)],
      [bad.getId(), details(bad)],
    ]));
    client.getAddressUTXOsBatch.mockResolvedValue(new Map([[payment.address!, [
      { tx_hash: good.getId(), tx_pos: 0, value: 50_000, height: 20 },
      { tx_hash: bad.getId(), tx_pos: 0, value: 60_001, height: 20 },
    ]]]));
    const address = addressRecord(payment.output!, payment.address!);
    const ctx = createTestContext({
      walletId: 'wallet-id',
      network: 'testnet3',
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      walletScriptToAddress: new Map([[address.scriptPubKey, address]]) as any,
      client: client as any,
    });

    await fetchUtxosPhase(ctx);

    expect(ctx.allUtxoKeys).toEqual(new Set([`${good.getId()}:0`]));
    expect(ctx.rejectedEvidenceCount).toBe(1);
    expect(ctx.utxoResults[0].utxos).toHaveLength(1);
  });

  it('never treats an authenticated empty list as proof an earlier output was spent', async () => {
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'33'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    });
    const client = clientFor(new Map());
    client.getAddressUTXOsBatch.mockResolvedValue(new Map([[payment.address!, []]]));
    const address = addressRecord(payment.output!, payment.address!);
    const ctx = createTestContext({
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      client: client as any,
    });

    await fetchUtxosPhase(ctx);

    expect(ctx.utxoResults).toEqual([{ address: address.address, utxos: [] }]);
  });

  it('authenticates a spend through its raw previous outpoint and records durable spend evidence', async () => {
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    });
    const previous = makeRawTransaction(payment.output!, 75_000n);
    const spend = spendingTransaction(previous, Uint8Array.from([0x51]));
    const address = addressRecord(payment.output!, payment.address!);
    const client = clientFor(new Map([
      [spend.getId(), details(spend)],
      [previous.getId(), details(previous)],
    ]));
    const historyEntry = { tx_hash: spend.getId(), height: 30 };
    const ctx = createTestContext({
      network: 'testnet3',
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      walletScriptToAddress: new Map([[address.scriptPubKey, address]]) as any,
      historyResults: new Map([[address.address, [historyEntry]]]),
      client: client as any,
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([historyEntry]);
    expect(ctx.authenticatedSpentOutpointKeys).toEqual(new Set([`${previous.getId()}:0`]));
    expect(ctx.txDetailsCache.get(spend.getId())?.vin).toEqual([{
      txid: previous.getId(),
      vout: 0,
    }]);
    expect(client.getTransactionsBatch).toHaveBeenNthCalledWith(2, [previous.getId()], false);
  });

  it('uses cached evidence, deduplicates requests, and preserves authenticated metadata', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const rawDetails = {
      ...details(transaction),
      time: 1,
      blocktime: 2,
      blockheight: 3,
      confirmations: 4,
      blockhash: 'block-hash',
    };
    const client = clientFor(new Map([[transaction.getId(), rawDetails]]));
    const ctx = createTestContext({ client: client as any });

    const first = await fetchAuthenticatedTransactions(ctx, [transaction.getId(), transaction.getId()]);
    const second = await fetchAuthenticatedTransactions(ctx, [transaction.getId()]);

    expect(first).toEqual(new Set([transaction.getId()]));
    expect(second).toEqual(first);
    expect(client.getTransactionsBatch).toHaveBeenCalledOnce();
    expect(ctx.txDetailsCache.get(transaction.getId())).toMatchObject({
      time: 1,
      blocktime: 2,
      blockheight: 3,
      confirmations: 4,
      blockhash: 'block-hash',
    });
  });

  it('initializes retained complexity from a cached entry without raw hex', async () => {
    const cachedTxid = '04'.repeat(32);
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const client = clientFor(new Map([[transaction.getId(), details(transaction)]]));
    const ctx = createTestContext({
      client: client as any,
      txDetailsCache: new Map([[cachedTxid, {
        txid: cachedTxid,
        vin: [],
        vout: [],
      } as RawTransaction]]),
    });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));
  });

  it('yields to worker timers during transaction evidence authentication', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const client = clientFor(new Map([[transaction.getId(), details(transaction)]]));
    const ctx = createTestContext({ client: client as any });
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
      clock += 30;
      return clock;
    });
    let heartbeatRan = false;
    setImmediate(() => { heartbeatRan = true; });

    try {
      await fetchAuthenticatedTransactions(ctx, [transaction.getId()]);
    } finally {
      now.mockRestore();
    }

    expect(heartbeatRan).toBe(true);
    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(true);
  });

  it('stops history authentication when an attempt is cancelled at a yield boundary', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const address = addressRecord(Uint8Array.from([0x51]), 'test-address');
    const ctx = createTestContext({
      addresses: [address] as any,
      historyResults: new Map([[
        address.address,
        [{ tx_hash: transaction.getId(), height: 1 }],
      ]]),
      txDetailsCache: new Map([[transaction.getId(), details(transaction)]]),
      client: clientFor(new Map()) as any,
    });
    const controller = new AbortController();
    const reason = new Error('lease lost while filtering history');
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
      clock += 30;
      return clock;
    });
    setImmediate(() => controller.abort(reason));

    try {
      await expect(authenticateHistoryResults(
        ctx,
        { signal: controller.signal },
      )).rejects.toBe(reason);
    } finally {
      now.mockRestore();
    }
  });

  it('falls back to individual fetches and rejects thrown, missing, and malformed results independently', async () => {
    const acceptedTransaction = makeRawTransaction(Uint8Array.from([0x51]), 3n);
    const missingTxid = '55'.repeat(32);
    const thrownTxid = '66'.repeat(32);
    const malformedTxid = '77'.repeat(32);
    const client = clientFor(new Map());
    client.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
    client.getTransaction.mockImplementation(async (txid: string) => {
      if (txid === acceptedTransaction.getId()) return details(acceptedTransaction);
      if (txid === thrownTxid) throw new Error('individual unavailable');
      if (txid === malformedTxid) {
        return { ...details(acceptedTransaction), txid: malformedTxid };
      }
      return undefined;
    });
    const ctx = createTestContext({ client: client as any });

    const result = await fetchAuthenticatedTransactions(ctx, [
      acceptedTransaction.getId(),
      missingTxid,
      thrownTxid,
      malformedTxid,
    ]);

    expect(result).toEqual(new Set([acceptedTransaction.getId()]));
    expect(ctx.rejectedEvidenceCount).toBe(3);
    expect(ctx.txDetailsCache.has(missingTxid)).toBe(false);
    expect(ctx.txDetailsCache.has(malformedTxid)).toBe(false);
  });

  it('rejects transaction details whose raw bytes are absent', async () => {
    const txid = '88'.repeat(32);
    const client = clientFor(new Map([[txid, {
      txid,
      vin: [],
      vout: [],
    } as RawTransaction]]));
    const ctx = createTestContext({ client: client as any });

    expect(await fetchAuthenticatedTransactions(ctx, [txid])).toEqual(new Set());
    expect(ctx.rejectedEvidenceCount).toBe(1);
    expect(ctx.txDetailsCache.has(txid)).toBe(false);
  });

  it('handles a cache that reports an accepted key while returning no details', async () => {
    const txid = '99'.repeat(32);
    const inconsistentCache = new Map<string, RawTransaction>();
    vi.spyOn(inconsistentCache, 'has').mockReturnValue(true);
    vi.spyOn(inconsistentCache, 'get').mockReturnValue(undefined);
    const ctx = createTestContext({
      txDetailsCache: inconsistentCache,
      historyResults: new Map([['address-with-history', [{ tx_hash: txid, height: 1 }]]]),
      client: clientFor(new Map()) as any,
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
    expect(ctx.allTxids.size).toBe(0);
  });

  it('rejects cached history when previous outputs are missing or mismatch its script', async () => {
    const currentTxid = '11'.repeat(32);
    const missingScriptTxid = '22'.repeat(32);
    const mismatchedScriptTxid = '33'.repeat(32);
    const address = {
      ...addressRecord(Uint8Array.from([0x51]), 'cached-address'),
      scriptPubKey: 'target-script',
    };
    const ctx = createTestContext({
      addresses: [address] as any,
      historyResults: new Map([[
        address.address,
        [{ tx_hash: currentTxid, height: 1 }],
      ]]),
      txDetailsCache: new Map([
        [currentTxid, {
          txid: currentTxid,
          hex: '00',
          vin: [
            { txid: missingScriptTxid, vout: 0 },
            { txid: mismatchedScriptTxid, vout: 0 },
          ],
          vout: [{ scriptPubKey: { hex: 'different-script' } }],
        } as any],
        [missingScriptTxid, {
          txid: missingScriptTxid,
          hex: '00',
          vin: [],
          vout: [{ scriptPubKey: {} }],
        } as any],
        [mismatchedScriptTxid, {
          txid: mismatchedScriptTxid,
          hex: '00',
          vin: [],
          vout: [{ scriptPubKey: { hex: 'different-script' } }],
        } as any],
      ]),
      walletScriptToAddress: new Map([['target-script', address]]) as any,
      client: clientFor(new Map()) as any,
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([]);
    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
    expect(ctx.rejectedEvidenceReasons.get('history_script_mismatch')).toBe(1);
  });

  it('filters missing histories and addresses without canonical scripts without inventing failures', async () => {
    const payment = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(`03${'55'.repeat(32)}`, 'hex'),
      network: bitcoin.networks.testnet,
    });
    const address = addressRecord(payment.output!, payment.address!);
    const noScriptAddress = { ...address, id: 'no-script', address: 'no-script-address', scriptPubKey: null };
    const ctx = createTestContext({
      addresses: [address, noScriptAddress] as any,
      historyResults: new Map(),
      client: clientFor(new Map()) as any,
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults).toEqual(new Map([
      [address.address, []],
      [noScriptAddress.address, []],
    ]));
    expect(ctx.allTxids.size).toBe(0);
    expect(ctx.txHeightMap.size).toBe(0);
    expect(ctx.rejectedEvidenceCount).toBe(0);
  });
});
