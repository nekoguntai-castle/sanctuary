/**
 * Transaction Input/Output Storage
 *
 * Stores transaction inputs and outputs in the database after
 * new transactions are created. Also triggers RBF detection.
 */

import { transactionRepository } from '../../../../../repositories';
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
  transactionOutputAddress,
  transactionOutputScriptHex,
} from '../../transactionOutputEvidence';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;

const log = createLogger('BITCOIN:SVC_SYNC_TX');

type CreatedTransactionRecord = Awaited<
  ReturnType<typeof transactionRepository.findByWalletIdAndTxids>
>[number];

type TransactionIoRows = {
  inputs: TxInputCreateData[];
  outputs: Array<Omit<TxOutputCreateData, 'outputType'>>;
};

type InputResolution = {
  address?: string;
  amount?: number;
};

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
  const { inputs } = await persistTransactionIORows(ctx, createdTxRecords, tx);
  if (inputs.length === 0) return;
  const confirmedTxids = new Set(
    newTransactions
      .filter(transaction => transaction.confirmations > 0)
      .map(transaction => transaction.txid)
  );
  await detectRBFReplacements(
    ctx.walletId,
    createdTxRecords,
    confirmedTxids,
    inputs,
    tx,
    deferPostCommit,
  );
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
  const { inputs } = await persistTransactionIORows(ctx, transactionRecords, tx);
  if (inputs.length === 0) return;
  const confirmedTxids = new Set(
    transactionRecords
      .filter(record => record.confirmations > 0)
      .map(record => record.txid)
  );
  await detectRBFReplacements(
    ctx.walletId,
    transactionRecords,
    confirmedTxids,
    inputs,
    tx,
    deferPostCommit,
  );
}

const persistTransactionIORows = async (
  ctx: SyncContext,
  transactionRecords: CreatedTransactionRecord[],
  tx?: PrismaTxClient,
): Promise<TransactionIoRows> => {
  const rows = buildTransactionIoRows(ctx, transactionRecords);
  const completeTransactionIds = transactionRecords
    .filter(record => hasCompleteInputEvidence(ctx, record.txid))
    .map(record => record.id);

  await transactionRepository.persistAddressSyncIORows(
    rows.inputs,
    rows.outputs,
    completeTransactionIds,
    ctx.walletAddressSet.size,
    tx,
  );
  return rows;
};

const hasCompleteInputEvidence = (
  ctx: SyncContext,
  txid: string
): boolean => {
  const details = ctx.txDetailsCache.get(txid);
  if (!details) return false;

  return (details.vin || []).every(input => input.coinbase || (
    input.txid !== undefined
    && input.vout !== undefined
    && resolveInput(input, ctx.txDetailsCache).address !== undefined
    && resolveInput(input, ctx.txDetailsCache).amount !== undefined
  ));
};

const buildTransactionIoRows = (
  ctx: SyncContext,
  createdTxRecords: CreatedTransactionRecord[]
): TransactionIoRows => {
  const rows: TransactionIoRows = { inputs: [], outputs: [] };

  for (const txRecord of createdTxRecords) {
    const txDetails = ctx.txDetailsCache.get(txRecord.txid);
    if (!txDetails) continue;

    rows.inputs.push(...buildInputRows(ctx, txRecord, txDetails.vin || []));
    rows.outputs.push(...buildOutputRows(ctx, txRecord, txDetails.vout || []));
  }

  return rows;
};

const buildInputRows = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  inputs: TransactionInput[]
): TxInputCreateData[] => {
  const rows: TxInputCreateData[] = [];

  for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
    const row = buildInputRow(ctx, txRecord, inputs[inputIdx], inputIdx);
    if (row) {
      rows.push(row);
    }
  }

  return rows;
};

const buildInputRow = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  input: TransactionInput,
  inputIdx: number
): TxInputCreateData | null => {
  if (input.coinbase) {
    return null;
  }

  const resolved = resolveInput(input, ctx.txDetailsCache);
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
  txDetailsCache: SyncContext['txDetailsCache']
): InputResolution => {
  const inlineAddress = input.prevout?.scriptPubKey
    ? getScriptAddress(input.prevout.scriptPubKey)
    : undefined;
  const inlineAmount = getPrevoutAmount(input.prevout?.value);
  const prevOutput = input.txid !== undefined && input.vout !== undefined
    ? txDetailsCache.get(input.txid)?.vout?.[input.vout]
    : undefined;
  return {
    address: inlineAddress || (prevOutput
      ? transactionOutputAddress(prevOutput)
      : undefined),
    amount: inlineAmount ?? (prevOutput?.value !== undefined
      ? Math.round(prevOutput.value * 100000000)
      : undefined),
  };
};

const getPrevoutAmount = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  // Verbose prevout values may arrive as satoshis from Electrum or BTC from fixture/raw-tx paths.
  return value >= 1000000 ? value : Math.round(value * 100000000);
};

const buildOutputRows = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  outputs: TransactionOutput[]
): Array<Omit<TxOutputCreateData, 'outputType'>> => {
  const rows: Array<Omit<TxOutputCreateData, 'outputType'>> = [];

  for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
    const row = buildOutputRow(ctx, txRecord, outputs[outputIdx], outputIdx);
    if (row) {
      rows.push(row);
    }
  }

  return rows;
};

const buildOutputRow = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  output: TransactionOutput,
  outputIdx: number
): Omit<TxOutputCreateData, 'outputType'> | null => {
  const outputAddress = transactionOutputAddress(output);
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
