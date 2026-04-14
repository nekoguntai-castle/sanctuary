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

const log = createLogger('BITCOIN:SVC_SYNC_TX');

type CreatedTransactionRecord = Awaited<
  ReturnType<typeof transactionRepository.findByWalletIdAndTxids>
>[number];

type TransactionIoRows = {
  inputs: TxInputCreateData[];
  outputs: TxOutputCreateData[];
};

type InputResolution = {
  address?: string;
  amount: number;
};

type InputScriptPubKey = NonNullable<
  NonNullable<TransactionInput['prevout']>['scriptPubKey']
>;

/**
 * Store transaction inputs and outputs in the database
 */
export async function storeTransactionIO(
  ctx: SyncContext,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  const { walletId, txDetailsCache, walletAddressSet, addressToDerivationPath } = ctx;

  try {
    const createdTxRecords = await transactionRepository.findByWalletIdAndTxids(
      walletId,
      newTransactions.map(tx => tx.txid),
      { id: true, txid: true, type: true }
    );

    const { inputs, outputs } = buildTransactionIoRows(
      ctx,
      createdTxRecords
    );

    await persistTransactionInputs(walletId, createdTxRecords, newTransactions, inputs);
    await persistTransactionOutputs(outputs);
  } catch (ioError) {
    log.warn(`[SYNC] Failed to store transaction inputs/outputs: ${ioError}`);
  }
}

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
  if (!resolved.address || input.txid === undefined || input.vout === undefined) {
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
  if (input.prevout && input.prevout.scriptPubKey) {
    return {
      address: getScriptAddress(input.prevout.scriptPubKey),
      amount: getPrevoutAmount(input.prevout.value),
    };
  }

  if (input.txid === undefined || input.vout === undefined) {
    return { amount: 0 };
  }

  const prevTx = txDetailsCache.get(input.txid);
  const prevOutput = prevTx?.vout?.[input.vout];
  if (!prevOutput) {
    return { amount: 0 };
  }

  return {
    address: getScriptAddress(prevOutput.scriptPubKey),
    amount: prevOutput.value !== undefined ? Math.round(prevOutput.value * 100000000) : 0,
  };
};

const getPrevoutAmount = (value: number | undefined): number => {
  if (value === undefined) {
    return 0;
  }

  // Verbose prevout values may arrive as satoshis from Electrum or BTC from fixture/raw-tx paths.
  return value >= 1000000 ? value : Math.round(value * 100000000);
};

const buildOutputRows = (
  ctx: SyncContext,
  txRecord: CreatedTransactionRecord,
  outputs: TransactionOutput[]
): TxOutputCreateData[] => {
  const rows: TxOutputCreateData[] = [];

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
): TxOutputCreateData | null => {
  const outputAddress = getScriptAddress(output.scriptPubKey);
  if (!outputAddress) {
    return null;
  }

  const isOurs = ctx.walletAddressSet.has(outputAddress);

  return {
    transactionId: txRecord.id,
    outputIndex: outputIdx,
    address: outputAddress,
    amount: BigInt(Math.round((output.value || 0) * 100000000)),
    scriptPubKey: output.scriptPubKey?.hex,
    outputType: getOutputType(txRecord.type, isOurs),
    isOurs,
  };
};

const getScriptAddress = (
  scriptPubKey?: InputScriptPubKey | TransactionOutput['scriptPubKey']
): string | undefined =>
  scriptPubKey?.address || (scriptPubKey?.addresses && scriptPubKey.addresses[0]);

const getOutputType = (transactionType: string, isOurs: boolean): string => {
  if (transactionType === 'sent') {
    return isOurs ? 'change' : 'recipient';
  }

  if (transactionType === 'received') {
    return isOurs ? 'recipient' : 'unknown';
  }

  if (transactionType === 'consolidation') {
    return 'consolidation';
  }

  return 'unknown';
};

const persistTransactionInputs = async (
  walletId: string,
  createdTxRecords: CreatedTransactionRecord[],
  newTransactions: TransactionCreateData[],
  inputs: TxInputCreateData[]
): Promise<void> => {
  if (inputs.length === 0) {
    return;
  }

  await transactionRepository.createManyInputs(
    inputs as unknown as Array<Record<string, unknown>>,
    { skipDuplicates: true }
  );

  await detectRBFReplacements(walletId, createdTxRecords, newTransactions, inputs);
};

const persistTransactionOutputs = async (
  outputs: TxOutputCreateData[]
): Promise<void> => {
  if (outputs.length === 0) {
    return;
  }

  await transactionRepository.createManyOutputs(
    outputs as unknown as Array<Record<string, unknown>>,
    { skipDuplicates: true }
  );
};
