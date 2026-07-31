/**
 * Transaction Classification
 *
 * Classifies transactions as received, sent, or consolidation based on
 * input/output analysis. Handles fetching of previous transaction outputs
 * for input resolution.
 */

import { createLogger } from '../../../../../utils/logger';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../../../../constants/transactionClassification';
import { getBlockTimestamp } from '../../../utils/blockHeight';
import type {
  RawTransaction,
  SyncContext,
  TransactionCreateData,
  TransactionInput,
  TransactionOutput,
  TxHistoryEntry,
} from '../../types';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

type InputEvidence = {
  address?: string;
  value?: number;
};

type InputClassification = {
  isSent: boolean;
  classificationInputsComplete: boolean;
  totalInputs: number;
  totalFromWallet: number;
};

type OutputTotals = {
  hasExternalEvidence: boolean;
  totalToExternal: number;
  totalToWallet: number;
  totalOutputs: number;
};

type TransactionBase = Pick<
  TransactionCreateData,
  | 'txid'
  | 'walletId'
  | 'addressId'
  | 'classificationInputsComplete'
  | 'classificationVersion'
  | 'classificationAddressCount'
  | 'confirmations'
  | 'blockHeight'
  | 'blockTime'
  | 'rbfStatus'
>;

type InputScriptPubKey = NonNullable<
  NonNullable<TransactionInput['prevout']>['scriptPubKey']
>;

/**
 * Helper to check if output matches an address
 */
export function outputMatchesAddress(out: TransactionOutput, address: string): boolean {
  if (out.scriptPubKey?.address === address) return true;
  if (out.scriptPubKey?.addresses?.includes(address)) return true;
  return false;
}

/**
 * Classify and create transaction records from a batch of fetched transactions.
 *
 * For each address history entry, determines if the transaction is a receive,
 * send, or consolidation, calculates the amount, and creates a TransactionCreateData record.
 */
export async function classifyTransactions(
  ctx: SyncContext,
  batchTxidSet: Set<string>
): Promise<TransactionCreateData[]> {
  const transactionsToCreate: TransactionCreateData[] = [];
  const classifiedTxids = new Set<string>();

  for (const [addressStr, history] of ctx.historyResults) {
    const addressRecord = ctx.addressMap.get(addressStr)!;

    for (const item of history) {
      if (classifiedTxids.has(item.tx_hash)) continue;
      const transaction = await classifyHistoryItem(
        ctx,
        batchTxidSet,
        addressStr,
        addressRecord.id,
        item
      );

      if (transaction) {
        transactionsToCreate.push(transaction);
        classifiedTxids.add(transaction.txid);
      }
    }
  }

  return transactionsToCreate;
}

const classifyHistoryItem = async (
  ctx: SyncContext,
  batchTxidSet: Set<string>,
  addressStr: string,
  addressId: string,
  item: TxHistoryEntry
): Promise<TransactionCreateData | null> => {
  if (!batchTxidSet.has(item.tx_hash)) {
    return null;
  }

  const txDetails = ctx.txDetailsCache.get(item.tx_hash);
  if (!txDetails) {
    return null;
  }

  const outputs = txDetails.vout || [];
  const inputs = txDetails.vin || [];
  const inputClassification = await classifyInputs(ctx, inputs);
  const outputTotals = calculateOutputTotals(outputs, ctx.walletAddressSet);
  const fee = calculateFee(inputClassification, outputTotals.totalOutputs);

  return createClassifiedTransaction({
    ctx,
    item,
    addressId,
    outputTotals,
    fee,
    inputClassification,
    isReceived: outputs.some((out) => outputMatchesAddress(out, addressStr)),
    blockTime: await getTransactionBlockTime(txDetails, item.height),
  });
};

const classifyInputs = async (
  ctx: SyncContext,
  inputs: TransactionInput[]
): Promise<InputClassification> => {
  let isSent = false;
  let classificationInputsComplete = true;
  let totalInputs = 0;
  let totalFromWallet = 0;

  for (const input of inputs) {
    if (input.coinbase) continue;

    const evidence = await resolveInputEvidence(ctx, input);
    if (!evidence.address || evidence.value === undefined) {
      classificationInputsComplete = false;
    }
    if (evidence.value !== undefined) {
      totalInputs += evidence.value;
    }
    if (evidence.address && ctx.walletAddressSet.has(evidence.address)) {
      isSent = true;
      if (evidence.value !== undefined) {
        totalFromWallet += evidence.value;
      }
    }
  }

  return {
    isSent,
    classificationInputsComplete,
    totalInputs,
    totalFromWallet,
  };
};

const resolveInputEvidence = async (
  ctx: SyncContext,
  input: TransactionInput
): Promise<InputEvidence> => {
  const inlineEvidence = getInlineInputEvidence(input);
  if (inlineEvidence.address !== undefined && inlineEvidence.value !== undefined) {
    return inlineEvidence;
  }

  const previousOutput = await resolvePreviousOutput(ctx, input);
  const previousEvidence = getOutputEvidence(previousOutput);
  return {
    address: inlineEvidence.address ?? previousEvidence.address,
    value: inlineEvidence.address === undefined
      ? previousEvidence.value
      : inlineEvidence.value ?? previousEvidence.value,
  };
};

const getInlineInputEvidence = (input: TransactionInput): InputEvidence => ({
  address: input.prevout?.scriptPubKey
    ? getScriptAddress(input.prevout.scriptPubKey)
    : undefined,
  value: input.prevout?.value === undefined
    ? undefined
    : normalizeInlineInputValue(input.prevout.value),
});

const resolvePreviousOutput = async (
  ctx: SyncContext,
  input: TransactionInput
): Promise<TransactionOutput | undefined> => {
  if (!input.txid || input.vout === undefined) return undefined;
  return getCachedPreviousOutput(ctx.txDetailsCache, input.txid, input.vout)
    ?? fetchPreviousOutput(ctx, input.txid, input.vout);
};

const getOutputEvidence = (
  output: TransactionOutput | undefined
): InputEvidence => ({
  address: output ? getScriptAddress(output.scriptPubKey) : undefined,
  value: output ? Math.round(output.value * 100000000) : undefined,
});

const normalizeInlineInputValue = (value: number): number => (
  value >= 1000000 ? value : Math.round(value * 100000000)
);

const fetchPreviousOutput = async (
  ctx: SyncContext,
  txid: string,
  vout: number
): Promise<TransactionOutput | undefined> => {
  if (ctx.txDetailsCache.has(txid)) {
    return undefined;
  }

  log.debug(`[SYNC] Cache miss for prev tx ${txid.slice(0, 8)}..., fetching individually`);

  try {
    const fetchedPrevTx = await ctx.client.getTransaction(txid);
    const prevOutput = fetchedPrevTx?.vout?.[vout];
    if (prevOutput) {
      ctx.txDetailsCache.set(txid, fetchedPrevTx);
    }
    return prevOutput;
  } catch (e) {
    /* v8 ignore next 2 -- previous-transaction lookup failure is best-effort classification fallback */
    log.debug(`Failed to fetch prev tx ${txid.slice(0, 8)}...`, { error: String(e) });
    /* v8 ignore next -- previous-transaction lookup failure is best-effort classification fallback */
    return undefined;
  }
};

const getCachedPreviousOutput = (
  txDetailsCache: SyncContext['txDetailsCache'],
  txid: string,
  vout: number
): TransactionOutput | undefined => txDetailsCache.get(txid)?.vout?.[vout];

const calculateOutputTotals = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): OutputTotals => {
  const totals: OutputTotals = {
    hasExternalEvidence: false,
    totalToExternal: 0,
    totalToWallet: 0,
    totalOutputs: 0,
  };

  for (const output of outputs) {
    addOutputToTotals(totals, output, walletAddressSet);
  }

  return totals;
};

const addOutputToTotals = (
  totals: OutputTotals,
  output: TransactionOutput,
  walletAddressSet: Set<string>
): void => {
  const outputValue = Math.round(output.value * 100000000);
  const outputAddress = getScriptAddress(output.scriptPubKey);

  totals.totalOutputs += outputValue;
  if (outputAddress && !walletAddressSet.has(outputAddress)) {
    totals.hasExternalEvidence = true;
    totals.totalToExternal += outputValue;
  } else if (outputAddress) {
    totals.totalToWallet += outputValue;
  } else {
    totals.hasExternalEvidence = true;
  }
};

const calculateFee = (
  inputClassification: InputClassification,
  totalOutputs: number
): number | null => {
  const calculatedFee = inputClassification.isSent
    && inputClassification.classificationInputsComplete
    && inputClassification.totalInputs > 0
    ? inputClassification.totalInputs - totalOutputs
    : null;
  return calculatedFee !== null && calculatedFee >= 0 ? calculatedFee : null;
};

const createClassifiedTransaction = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  addressId: string;
  outputTotals: OutputTotals;
  fee: number | null;
  inputClassification: InputClassification;
  isReceived: boolean;
  blockTime: Date | null;
}): TransactionCreateData | null => {
  const base = createTransactionBase(args);
  const { inputClassification, outputTotals } = args;

  if (inputClassification.isSent) {
    return inputClassification.classificationInputsComplete
      ? createCompleteWalletInputTransaction(base, inputClassification, outputTotals, args.fee)
      : createIncompleteWalletInputTransaction(base, outputTotals);
  }

  if (args.isReceived) {
    return createReceivedTransaction(base, outputTotals.totalToWallet);
  }

  return null;
};

const createTransactionBase = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  addressId: string;
  blockTime: Date | null;
  inputClassification: InputClassification;
}): TransactionBase => {
  const confirmations = getConfirmations(args.item.height, args.ctx.currentBlockHeight);

  return {
    txid: args.item.tx_hash,
    walletId: args.ctx.walletId,
    addressId: args.addressId,
    classificationInputsComplete: args.inputClassification.classificationInputsComplete,
    classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
    classificationAddressCount: args.ctx.walletAddressSet.size,
    confirmations,
    blockHeight: args.item.height > 0 ? args.item.height : null,
    blockTime: args.blockTime,
    rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
  };
};

const createConsolidationTransaction = (
  base: TransactionBase,
  amount: number,
  fee: number | null
): TransactionCreateData => ({
  ...base,
  type: 'consolidation',
  amount: BigInt(amount),
  fee: fee !== null ? BigInt(fee) : null,
});

const createSentTransaction = (
  base: TransactionBase,
  amount: number,
  fee: number | null
): TransactionCreateData => ({
  ...base,
  type: 'sent',
  amount: BigInt(amount),
  fee: fee !== null ? BigInt(fee) : null,
});

const createReceivedTransaction = (
  base: TransactionBase,
  amount: number
): TransactionCreateData => ({
  ...base,
  type: 'received',
  amount: BigInt(amount),
});

const createCompleteWalletInputTransaction = (
  base: TransactionBase,
  inputs: InputClassification,
  outputs: OutputTotals,
  fee: number | null
): TransactionCreateData => {
  const walletDelta = outputs.totalToWallet - inputs.totalFromWallet;
  if (walletDelta > 0) {
    return createReceivedTransaction(base, walletDelta);
  }
  return outputs.hasExternalEvidence
    ? createSentTransaction(base, walletDelta, fee)
    : createConsolidationTransaction(base, walletDelta, fee);
};

const createIncompleteWalletInputTransaction = (
  base: TransactionBase,
  outputs: OutputTotals
): TransactionCreateData => (
  outputs.hasExternalEvidence
    ? createSentTransaction(base, -outputs.totalToExternal, null)
    : createConsolidationTransaction(base, 0, null)
);

const getConfirmations = (height: number, currentBlockHeight: number): number =>
  height > 0 ? Math.max(0, currentBlockHeight - height + 1) : 0;

const getTransactionBlockTime = async (
  txDetails: RawTransaction,
  height: number
): Promise<Date | null> => {
  if (txDetails.time) {
    return new Date(txDetails.time * 1000);
  }

  return height > 0 ? getBlockTimestamp(height) : null;
};

const getScriptAddress = (
  scriptPubKey?: InputScriptPubKey | TransactionOutput['scriptPubKey']
): string | undefined =>
  scriptPubKey?.address || (scriptPubKey?.addresses && scriptPubKey.addresses[0]);
