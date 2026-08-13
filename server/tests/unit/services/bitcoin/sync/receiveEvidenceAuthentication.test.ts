import * as bitcoin from 'bitcoinjs-lib';
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
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';

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
