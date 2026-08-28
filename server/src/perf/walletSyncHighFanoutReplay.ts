import * as bitcoin from 'bitcoinjs-lib';
import { readdir } from 'node:fs/promises';
import type { Address, Wallet } from '../generated/prisma/client';
import type { NodeClientInterface } from '../services/bitcoin/nodeClient';
import {
  createTestContext,
  fetchHistoriesPhase,
  fetchUtxosPhase,
  type RawTransaction,
  type TxHistoryEntry,
} from '../services/bitcoin/sync';
import { SyncRemoteStageBudgetError } from '../services/bitcoin/sync/attemptRuntime';
import { createTransactionEvidenceProjector } from '../services/bitcoin/sync/transactionEvidenceThread';
import { startHealthServer } from '../worker/healthServer';

const ADDRESS_COUNT = 47;
const TRANSACTION_COUNT = 169;
const HISTORY_ROW_COUNT = 184;
const PREVIOUS_TRANSACTION_COUNT = 47;
const TOTAL_OUTPUT_COUNT = 471_732;
const LARGE_TRANSACTION_COUNT = 53;
const LARGE_TRANSACTION_OUTPUTS = 2_792;
const REGULAR_TRANSACTION_OUTPUTS = 2_791;
const HEALTH_PORT = 3002;
const EXTERNAL_SCRIPT = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 0xff),
  network: bitcoin.networks.bitcoin,
}).output;

if (!EXTERNAL_SCRIPT) throw new Error('Could not build replay external script');

interface ReplayTransaction {
  addressIndex: number;
  details: RawTransaction;
  outputCount: number;
  secondaryAddressIndex?: number;
}

interface ReplayUtxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

const emit = (event: string, details: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
};

const walletAddress = (index: number): { address: Address; script: Uint8Array } => {
  const hash = Buffer.alloc(20);
  hash.writeUInt32BE(index + 1, hash.length - 4);
  const payment = bitcoin.payments.p2wpkh({
    hash,
    network: bitcoin.networks.bitcoin,
  });
  if (!payment.address || !payment.output) throw new Error('Could not build replay address');
  const scriptHex = Buffer.from(payment.output).toString('hex');
  return {
    address: {
      id: `replay-address-${index}`,
      walletId: 'replay-wallet',
      address: payment.address,
      derivationPath: `m/84'/0'/0'/0/${index}`,
      index,
      branch: 0,
      coordinateVersion: 1,
      canonicalPolicyId: 'single_sig_native_segwit',
      canonicalPolicyVersion: 1,
      scriptPubKey: scriptHex,
      used: false,
      createdAt: new Date(0),
    } as Address,
    script: payment.output,
  };
};

const replayTransaction = (
  index: number,
  outputCount: number,
  script: Uint8Array,
  previousTxid?: string,
  secondaryScript?: Uint8Array,
): RawTransaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.locktime = index;
  transaction.addInput(
    previousTxid ? Buffer.from(previousTxid, 'hex').reverse() : new Uint8Array(32),
    previousTxid ? 0 : 0xffffffff,
  );
  for (let outputIndex = secondaryScript ? 2 : 1; outputIndex < outputCount; outputIndex++) {
    transaction.addOutput(EXTERNAL_SCRIPT, 1n);
  }
  if (secondaryScript) transaction.addOutput(secondaryScript, 1n);
  transaction.addOutput(script, 1n);
  return {
    txid: transaction.getId(),
    hex: transaction.toHex(),
    vin: [],
    vout: [],
  };
};

const buildFixture = (): {
  addresses: Address[];
  histories: Map<string, TxHistoryEntry[]>;
  transactions: Map<string, RawTransaction>;
  utxos: Map<string, ReplayUtxo[]>;
} => {
  const walletAddresses = Array.from({ length: ADDRESS_COUNT }, (_, index) => walletAddress(index));
  const previousTransactions = Array.from(
    { length: PREVIOUS_TRANSACTION_COUNT },
    (_, index) => replayTransaction(10_000 + index, 1, EXTERNAL_SCRIPT),
  );
  const replayTransactions: ReplayTransaction[] = Array.from({ length: TRANSACTION_COUNT }, (_, index) => {
    const addressIndex = index % walletAddresses.length;
    const secondaryAddressIndex = index < HISTORY_ROW_COUNT - TRANSACTION_COUNT
      ? (addressIndex + 1) % walletAddresses.length
      : undefined;
    const outputCount = index < LARGE_TRANSACTION_COUNT ? LARGE_TRANSACTION_OUTPUTS : REGULAR_TRANSACTION_OUTPUTS;
    return {
      addressIndex,
      outputCount,
      ...(secondaryAddressIndex === undefined ? {} : { secondaryAddressIndex }),
      details: replayTransaction(
        index,
        outputCount,
        walletAddresses[addressIndex].script,
        index < previousTransactions.length ? previousTransactions[index].txid : undefined,
        secondaryAddressIndex === undefined ? undefined : walletAddresses[secondaryAddressIndex].script,
      ),
    };
  });
  const actualOutputs = replayTransactions.reduce((sum, item) => sum + item.outputCount, 0);
  if (actualOutputs !== TOTAL_OUTPUT_COUNT) {
    throw new Error(`Replay output fixture drifted: ${actualOutputs}`);
  }
  const histories = new Map<string, TxHistoryEntry[]>(walletAddresses.map(({ address }) => [address.address, []]));
  for (const item of replayTransactions) {
    const history = {
      tx_hash: item.details.txid,
      height: 800_000 + item.addressIndex,
    };
    histories.get(walletAddresses[item.addressIndex].address.address)?.push(history);
    if (item.secondaryAddressIndex !== undefined) {
      histories.get(walletAddresses[item.secondaryAddressIndex].address.address)?.push(history);
    }
  }
  const historyRows = [...histories.values()].reduce((sum, history) => sum + history.length, 0);
  if (historyRows !== HISTORY_ROW_COUNT) throw new Error(`Replay history fixture drifted: ${historyRows}`);
  const utxos = new Map<string, ReplayUtxo[]>(walletAddresses.map(({ address }, addressIndex) => {
    const item = replayTransactions.find(candidate => candidate.addressIndex === addressIndex);
    if (!item) throw new Error(`Replay UTXO fixture missing address ${addressIndex}`);
    return [address.address, [{
      tx_hash: item.details.txid,
      tx_pos: item.outputCount - 1,
      value: 1,
      height: 800_000 + addressIndex,
    }]];
  }));
  return {
    addresses: walletAddresses.map(item => item.address),
    histories,
    transactions: new Map([
      ...replayTransactions.map(item => [item.details.txid, item.details] as const),
      ...previousTransactions.map(item => [item.txid, item] as const),
    ]),
    utxos,
  };
};

const clientFor = (
  histories: ReadonlyMap<string, TxHistoryEntry[]>,
  transactions: ReadonlyMap<string, RawTransaction>,
  utxos: ReadonlyMap<string, ReplayUtxo[]>,
  rawBatchSizes: number[],
  historyBatchSizes: number[],
): NodeClientInterface =>
  ({
    getAddressHistoryBatch: async (addresses: string[]) => {
      historyBatchSizes.push(addresses.length);
      return new Map(addresses.map(address => [address, histories.get(address) ?? []]));
    },
    getAddressHistory: async (address: string) => histories.get(address) ?? [],
    getAddressUTXOsBatch: async (addresses: string[]) =>
      new Map(addresses.map((address: string) => [address, utxos.get(address) ?? []])),
    getAddressUTXOs: async (address: string) => utxos.get(address) ?? [],
    getTransactionsBatch: async (txids: string[]) =>
      new Map(
        txids.flatMap((txid: string) => {
          const details = transactions.get(txid);
          return details ? [[txid, details] as const] : [];
        }),
      ),
    getTransaction: async (txid: string) => transactions.get(txid),
    getRawTransactionEvidenceBatch: async (txids: string[]) => {
      rawBatchSizes.push(txids.length);
      return new Map(
        txids.flatMap((txid: string) => {
          const details = transactions.get(txid);
          return details ? [[txid, details] as const] : [];
        }),
      );
    },
  }) as unknown as NodeClientInterface;

const assertBatchShape = (actual: number[], maximum: number, expectedCalls: number): void => {
  if (actual.length !== expectedCalls || actual.some(size => size < 1 || size > maximum)) {
    throw new Error(`Unexpected replay batch shape: ${actual.join(',')}`);
  }
};

type ReplayFixture = ReturnType<typeof buildFixture>;

const contextFor = (
  fixture: ReplayFixture,
  rawBatchSizes: number[],
  historyBatchSizes: number[],
  deadlineAt: number,
) => {
  const client = clientFor(
    fixture.histories,
    fixture.transactions,
    fixture.utxos,
    rawBatchSizes,
    historyBatchSizes,
  );
  const walletScriptToAddress = new Map(
    fixture.addresses.map(address => [address.scriptPubKey?.toLowerCase() ?? '', address]),
  );
  return createTestContext({
    walletId: 'replay-wallet',
    wallet: { id: 'replay-wallet', network: 'mainnet' } as Wallet,
    network: 'mainnet',
    client,
    addresses: fixture.addresses,
    walletAddressSet: new Set(fixture.addresses.map(address => address.address)),
    addressMap: new Map(fixture.addresses.map(address => [address.address, address])),
    addressToDerivationPath: new Map(
      fixture.addresses.map(address => [address.address, address.derivationPath ?? '']),
    ),
    walletScriptToAddress,
    attemptRuntime: {
      signal: new AbortController().signal,
      deadlineAt,
    },
  });
};

async function main(): Promise<void> {
  const fixture = buildFixture();
  const baselineThreads = (await readdir('/proc/self/task')).length;
  const rawBatchSizes: number[] = [];
  const historyBatchSizes: number[] = [];
  const ctx = contextFor(fixture, rawBatchSizes, historyBatchSizes, Date.now() + 5 * 60_000);
  const health = startHealthServer({
    port: HEALTH_PORT,
    healthProvider: {
      getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
    },
  });
  await new Promise<void>(resolve => setTimeout(resolve, 100));
  emit('replay_ready', {
    addresses: fixture.addresses.length,
    historyRows: HISTORY_ROW_COUNT,
    historyTransactions: TRANSACTION_COUNT,
    previousTransactions: PREVIOUS_TRANSACTION_COUNT,
    outputs: TOTAL_OUTPUT_COUNT,
    rssBytes: process.memoryUsage().rss,
    baselineThreads,
    compiledWorker: require.resolve('../services/bitcoin/sync/transactionEvidenceWorker').endsWith('.js'),
  });
  await new Promise<void>(resolve => process.once('SIGUSR1', () => resolve()));

  const startedAt = Date.now();
  try {
    emit('phase_started', { stage: 'address_history' });
    await fetchHistoriesPhase(ctx);
    await fetchUtxosPhase(ctx);
    const cachedOutputs = [...ctx.txDetailsCache.values()].reduce((sum, details) => sum + details.vout.length, 0);
    const authenticatedHistoryRows = [...ctx.historyResults.values()]
      .reduce((sum, history) => sum + history.length, 0);
    assertBatchShape(historyBatchSizes, 10, 5);
    assertBatchShape(rawBatchSizes, 10, 22);
    if (ctx.rejectedEvidenceCount !== 0) {
      throw new Error(`Replay rejected ${ctx.rejectedEvidenceCount} evidence items`);
    }
    if (ctx.txDetailsCache.size !== TRANSACTION_COUNT + PREVIOUS_TRANSACTION_COUNT
      || cachedOutputs !== TOTAL_OUTPUT_COUNT + PREVIOUS_TRANSACTION_COUNT) {
      throw new Error(`Replay cache mismatch: ${ctx.txDetailsCache.size} tx / ${cachedOutputs} outputs`);
    }
    if (authenticatedHistoryRows !== HISTORY_ROW_COUNT || ctx.allUtxoKeys.size !== ADDRESS_COUNT) {
      throw new Error(
        `Replay consumer mismatch: ${authenticatedHistoryRows} history rows / ${ctx.allUtxoKeys.size} UTXOs`,
      );
    }

    const cancelledRawBatchSizes: number[] = [];
    const cancelledHistoryBatchSizes: number[] = [];
    const cancelled = contextFor(
      fixture,
      cancelledRawBatchSizes,
      cancelledHistoryBatchSizes,
      Date.now() + 100,
    );
    await fetchHistoriesPhase(cancelled);
    if (cancelled.txDetailsCache.size !== 0
      || cancelled.rejectedEvidenceReasons.get('fetch_budget_exhausted') !== TRANSACTION_COUNT
      || cancelledRawBatchSizes.length < 1
      || cancelledRawBatchSizes[0] !== 10) {
      throw new Error(
        `Replay cancellation mismatch: ${cancelled.txDetailsCache.size} cached / ${cancelled.rejectedEvidenceCount} rejected`,
      );
    }

    const largest = [...fixture.transactions.values()].reduce((current, candidate) => (
      (candidate.hex?.length ?? 0) > (current.hex?.length ?? 0) ? candidate : current
    ));
    const activeController = new AbortController();
    const activeReason = new SyncRemoteStageBudgetError('replay_active_projection');
    const activeProjector = createTransactionEvidenceProjector();
    const activeProjection = activeProjector.project({
      expectedTxid: largest.txid,
      details: largest,
      network: 'mainnet',
      limits: { maxInputs: 25_000, maxOutputs: 25_000, maxScriptHexChars: 64 * 1024 * 1024 },
    }, activeController.signal);
    activeController.abort(activeReason);
    try {
      await activeProjection;
      throw new Error('Replay active projection unexpectedly completed after cancellation');
    } catch (error) {
      if (error !== activeReason) throw error;
    } finally {
      await activeProjector.close();
    }
    emit('cancellation_completed', {
      rejected: cancelled.rejectedEvidenceCount,
      cancelledRawBatchSizes,
      activeProjectionCancelled: true,
      finalThreads: (await readdir('/proc/self/task')).length,
    });
    const observationComplete = new Promise<void>(
      resolve => process.once('SIGUSR2', () => resolve()),
    );
    emit('replay_completed', {
      elapsedMs: Date.now() - startedAt,
      cachedTransactions: ctx.txDetailsCache.size,
      cachedOutputs,
      rssBytes: process.memoryUsage().rss,
      finalThreads: (await readdir('/proc/self/task')).length,
      rawBatchSizes,
      historyBatchSizes,
    });
    await observationComplete;
  } finally {
    await health.close();
  }
}

void main().catch(error => {
  emit('replay_failed', {
    message: error instanceof Error ? error.message : String(error),
    rssBytes: process.memoryUsage().rss,
  });
  process.exitCode = 1;
});
