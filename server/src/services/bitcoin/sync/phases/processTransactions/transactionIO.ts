/**
 * Transaction Input/Output Storage
 *
 * Stores transaction inputs and outputs in the database after
 * new transactions are created. Also triggers RBF detection.
 */

import { transactionRepository } from '../../../../../repositories';
import { ADDRESS_SYNC_IO_UPSERT_MAX_ROWS } from '../../../../../constants/addressSyncPersistence';
import { createLogger } from '../../../../../utils/logger';
import type {
  SyncContext,
  TransactionCreateData,
  TransactionInput,
  TransactionOutput,
  TxInputCreateData,
  TxOutputCreateData,
} from '../../types';
import { detectRBFReplacements } from './rbfDetection';
import type { PrismaTxClient } from '../../../../../models/prisma';
import {
  createBoundedTransactionOutputAddressResolver,
  transactionOutputScriptHex,
} from '../../transactionOutputEvidence';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;

const log = createLogger('BITCOIN:SVC_SYNC_TX');

type CreatedTransactionRecord = Awaited<
  ReturnType<typeof transactionRepository.findByWalletIdAndTxids>
>[number];

type TransactionIoRows = {
  inputBearingTransactionIds: string[];
  completeTransactionIds: string[];
};

type InputResolution = {
  address?: string;
  amount?: number;
};

type OutputAddressResolver = ReturnType<typeof createBoundedTransactionOutputAddressResolver>;

type InputScriptPubKey = NonNullable<
  NonNullable<TransactionInput['prevout']>['scriptPubKey']
>;

/**
 * Store transaction inputs and outputs in the database
 */
export async function storeTransactionIO(
  ctx: SyncContext,
  newTransactions: TransactionCreateData[],
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<void> {
  if (tx) {
    await storeTransactionIOUnchecked(ctx, newTransactions, tx, deferPostCommit);
    return;
  }
  const { walletId } = ctx;

  try {
    await storeTransactionIOUnchecked(ctx, newTransactions);
  } catch (ioError) {
    log.warn(`[SYNC] Failed to store transaction inputs/outputs: ${ioError}`);
  }
}

async function storeTransactionIOUnchecked(
  ctx: SyncContext,
  newTransactions: TransactionCreateData[],
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<void> {
  const createdTxRecords = await transactionRepository.findByWalletIdAndTxids(
    ctx.walletId,
    newTransactions.map(transaction => transaction.txid),
    { id: true, txid: true, type: true },
    tx,
  );
  const rows = await persistTransactionIORows(ctx, createdTxRecords, tx);
  if (rows.inputBearingTransactionIds.length > 0) {
    const confirmedTxids = new Set(
      newTransactions
        .filter(transaction => transaction.confirmations > 0)
        .map(transaction => transaction.txid)
    );
    await detectRBFReplacements(
      ctx.walletId,
      createdTxRecords,
      confirmedTxids,
      rows.inputBearingTransactionIds,
      tx,
      deferPostCommit,
      () => ctx.attemptRuntime?.signal.throwIfAborted(),
    );
  }
  await completeTransactionIORows(ctx, rows.completeTransactionIds, tx);
}

export async function repairTransactionIO(
  ctx: SyncContext,
  txids: string[],
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<void> {
  if (txids.length === 0) return;

  if (tx) {
    await repairTransactionIOUnchecked(ctx, txids, tx, deferPostCommit);
    return;
  }
  try {
    await repairTransactionIOUnchecked(ctx, txids);
  } catch (ioError) {
    log.warn(`[SYNC] Failed to repair transaction inputs/outputs: ${ioError}`);
    return;
  }
}

async function repairTransactionIOUnchecked(
  ctx: SyncContext,
  txids: string[],
  tx?: PrismaTxClient,
  deferPostCommit?: DeferPostCommit,
): Promise<void> {
  const transactionRecords = await transactionRepository.findByWalletIdAndTxids(
    ctx.walletId,
    txids,
    { id: true, txid: true, type: true, confirmations: true },
    tx,
  );
  const rows = await persistTransactionIORows(ctx, transactionRecords, tx);
  if (rows.inputBearingTransactionIds.length > 0) {
    const confirmedTxids = new Set(
      transactionRecords
        .filter(record => record.confirmations > 0)
        .map(record => record.txid)
    );
    await detectRBFReplacements(
      ctx.walletId,
      transactionRecords,
      confirmedTxids,
      rows.inputBearingTransactionIds,
      tx,
      deferPostCommit,
      () => ctx.attemptRuntime?.signal.throwIfAborted(),
    );
  }
  await completeTransactionIORows(ctx, rows.completeTransactionIds, tx);
}

const persistTransactionIORows = async (
  ctx: SyncContext,
  transactionRecords: CreatedTransactionRecord[],
  tx?: PrismaTxClient,
): Promise<TransactionIoRows> => {
  const inputBearingTransactionIds: string[] = [];
  const completeTransactionIds: string[] = [];
  for (const transactionRecord of transactionRecords) {
    const resolveOutputAddress = createBoundedTransactionOutputAddressResolver(
      ctx.network,
      ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
    );
    const hasPersistedInputs = await persistTransactionRecordIORows(
      ctx,
      transactionRecord,
      resolveOutputAddress,
      tx,
    );
    if (hasPersistedInputs) inputBearingTransactionIds.push(transactionRecord.id);
    if (hasCompleteInputEvidence(ctx, transactionRecord.txid, resolveOutputAddress)) {
      completeTransactionIds.push(transactionRecord.id);
    }
  }
  return { inputBearingTransactionIds, completeTransactionIds };
};

const persistTransactionRecordIORows = async (
  ctx: SyncContext,
  transactionRecord: CreatedTransactionRecord,
  resolveOutputAddress: OutputAddressResolver,
  tx?: PrismaTxClient,
): Promise<boolean> => {
  const details = ctx.txDetailsCache.get(transactionRecord.txid);
  if (!details) return false;

  let hasPersistedInputs = false;
  let inputChunk: TxInputCreateData[] = [];
  for (let inputIndex = 0; inputIndex < (details.vin || []).length; inputIndex++) {
    const row = buildInputRow(
      ctx,
      transactionRecord,
      details.vin![inputIndex],
      inputIndex,
      resolveOutputAddress,
    );
    if (!row) continue;
    hasPersistedInputs = true;
    inputChunk.push(row);
    if (inputChunk.length === ADDRESS_SYNC_IO_UPSERT_MAX_ROWS) {
      await persistIoChunk(ctx, inputChunk, [], tx);
      inputChunk = [];
    }
  }
  if (inputChunk.length > 0) await persistIoChunk(ctx, inputChunk, [], tx);

  let outputChunk: Array<Omit<TxOutputCreateData, 'outputType'>> = [];
  for (let outputIndex = 0; outputIndex < (details.vout || []).length; outputIndex++) {
    const row = buildOutputRow(
      ctx,
      transactionRecord,
      details.vout![outputIndex],
      outputIndex,
      resolveOutputAddress,
    );
    if (!row) continue;
    outputChunk.push(row);
    if (outputChunk.length === ADDRESS_SYNC_IO_UPSERT_MAX_ROWS) {
      await persistIoChunk(ctx, [], outputChunk, tx);
      outputChunk = [];
    }
  }
  if (outputChunk.length > 0) await persistIoChunk(ctx, [], outputChunk, tx);

  ctx.attemptRuntime?.signal.throwIfAborted();
  return hasPersistedInputs;
};

const completeTransactionIORows = async (
  ctx: SyncContext,
  completeTransactionIds: string[],
  tx?: PrismaTxClient,
): Promise<void> => {
  if (completeTransactionIds.length === 0) return;
  await persistIoChunk(ctx, [], [], tx, completeTransactionIds);
};

const persistIoChunk = async (
  ctx: SyncContext,
  inputs: TxInputCreateData[],
  outputs: Array<Omit<TxOutputCreateData, 'outputType'>>,
  tx?: PrismaTxClient,
  completeTransactionIds: string[] = [],
): Promise<void> => {
  ctx.attemptRuntime?.signal.throwIfAborted();
  await transactionRepository.persistAddressSyncIORows(
    inputs,
    outputs,
    completeTransactionIds,
    ctx.walletAddressSet.size,
    tx,
  );
  ctx.attemptRuntime?.signal.throwIfAborted();
};

const hasCompleteInputEvidence = (
  ctx: SyncContext,
  txid: string,
  resolveOutputAddress: OutputAddressResolver,
): boolean => {
  const details = ctx.txDetailsCache.get(txid);
  if (!details) return false;

  return (details.vin || []).every(input => input.coinbase || (
    input.txid !== undefined
    && input.vout !== undefined
    && resolveInput(input, ctx, resolveOutputAddress).address !== undefined
    && resolveInput(input, ctx, resolveOutputAddress).amount !== undefined
  ));
};

const buildInputRow = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  input: TransactionInput,
  inputIdx: number,
  resolveOutputAddress: OutputAddressResolver,
): TxInputCreateData | null => {
  if (input.coinbase) {
    return null;
  }

  const resolved = resolveInput(input, ctx, resolveOutputAddress);
  if (
    !resolved.address
    || resolved.amount === undefined
    || input.txid === undefined
    || input.vout === undefined
  ) {
    return null;
  }

  return {
    transactionId: txRecord.id,
    inputIndex: inputIdx,
    txid: input.txid,
    vout: input.vout,
    address: resolved.address,
    amount: BigInt(resolved.amount),
    derivationPath: ctx.addressToDerivationPath.get(resolved.address),
  };
};

const resolveInput = (
  input: TransactionInput,
  ctx: SyncContext,
  resolveOutputAddress: OutputAddressResolver,
): InputResolution => {
  const inlineAddress = input.prevout?.scriptPubKey
    ? getScriptAddress(input.prevout.scriptPubKey)
    : undefined;
  const inlineAmount = getPrevoutAmount(input.prevout?.value);
  const exactOutput = input.txid !== undefined && input.vout !== undefined
    ? ctx.authenticatedOutpointEvidence.get(`${input.txid}:${input.vout}`)
    : undefined;
  const prevOutput = !exactOutput && input.txid !== undefined && input.vout !== undefined
    ? ctx.txDetailsCache.get(input.txid)?.vout?.[input.vout]
    : undefined;
  return {
    address: inlineAddress || (exactOutput
      ? resolveOutputAddress({
        value: Number(exactOutput.valueSats) / 100_000_000,
        scriptHex: exactOutput.scriptHex,
      })
      : prevOutput ? resolveOutputAddress(prevOutput) : undefined),
    amount: inlineAmount
      ?? (exactOutput ? Number(exactOutput.valueSats) : undefined)
      ?? (prevOutput?.value !== undefined ? Math.round(prevOutput.value * 100000000) : undefined),
  };
};

const getPrevoutAmount = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  // Verbose prevout values may arrive as satoshis from Electrum or BTC from fixture/raw-tx paths.
  return value >= 1000000 ? value : Math.round(value * 100000000);
};

const buildOutputRow = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  output: TransactionOutput,
  outputIdx: number,
  resolveOutputAddress: OutputAddressResolver,
): Omit<TxOutputCreateData, 'outputType'> | null => {
  const outputAddress = resolveOutputAddress(output);
  if (!outputAddress) {
    return null;
  }

  const scriptPubKey = transactionOutputScriptHex(output)?.toLowerCase();
  const isOurs = scriptPubKey !== undefined && ctx.walletScriptToAddress.size > 0
    ? ctx.walletScriptToAddress.has(scriptPubKey)
    : ctx.walletAddressSet.has(outputAddress);

  return {
    transactionId: txRecord.id,
    outputIndex: outputIdx,
    address: outputAddress,
    amount: BigInt(Math.round((output.value || 0) * 100000000)),
    scriptPubKey: transactionOutputScriptHex(output),
    isOurs,
  };
};

const getScriptAddress = (
  scriptPubKey?: InputScriptPubKey | TransactionOutput['scriptPubKey']
): string | undefined =>
  scriptPubKey?.address || (scriptPubKey?.addresses && scriptPubKey.addresses[0]);
