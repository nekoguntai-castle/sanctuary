/**
 * Transaction Classification
 *
 * Classifies transactions as received, sent, or consolidation based on
 * input/output analysis. Handles fetching of previous transaction outputs
 * for input resolution.
 */

import { createLogger } from '../../../../../utils/logger';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../../../../constants/transactionClassification';
import type {
  RawTransaction,
  SyncContext,
  TransactionCreateData,
  TransactionInput,
  TransactionOutput,
  TxHistoryEntry,
} from '../../types';
import { fetchAuthenticatedTransactions } from '../../evidenceAuthentication';
import type { NodeRequestOptions } from '../../../nodeClient';
import { resolveTransactionBlockTime } from './timestampPrefetch';
import {
  transactionOutputAddress,
  transactionOutputAddresses,
  transactionOutputScriptHex,
} from '../../transactionOutputEvidence';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

type InputEvidence = {
  address?: string;
  value?: number;
  scriptPubKey?: string;
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
  return transactionOutputAddresses(out).includes(address);
}

/**
 * Classify and create transaction records from a batch of fetched transactions.
 *
 * For each address history entry, determines if the transaction is a receive,
 * send, or consolidation, calculates the amount, and creates a TransactionCreateData record.
 */
export async function classifyTransactions(
  ctx: SyncContext,
  batchTxidSet: Set<string>,
  options?: NodeRequestOptions,
  blockTimestamps?: ReadonlyMap<number, Date | null>,
): Promise<TransactionCreateData[]> {
  const transactionsToCreate: TransactionCreateData[] = [];
  const classifiedTxids = new Set<string>();

  for (const [addressStr, history] of ctx.historyResults) {
    options?.signal?.throwIfAborted();
    const addressRecord = ctx.addressMap.get(addressStr)!;

    for (const item of history) {
      if (classifiedTxids.has(item.tx_hash)) continue;
      const transaction = await classifyHistoryItem(
        ctx,
        batchTxidSet,
        addressStr,
        addressRecord.id,
        item,
        options,
        blockTimestamps,
      );

      if (transaction) {
        transactionsToCreate.push(transaction);
        classifiedTxids.add(transaction.txid);
      }
    }
  }

  return transactionsToCreate;
}

/**
 * Keep only candidates whose classification can be completed from evidence
 * already accepted into the sync context. This is used after the candidate
 * remote budget expires, when classification must not start another parent or
 * block-header request.
 */
export function locallyClassifiableTransactionIds(
  ctx: SyncContext,
  batchTxidSet: Set<string>,
): Set<string> {
  const result = new Set<string>();
  for (const txid of batchTxidSet) {
    const txDetails = ctx.txDetailsCache.get(txid);
    const historyItem = findFirstHistoryItem(ctx, txid);
    if (!txDetails || !historyItem) continue;
    if (!txDetails.time && historyItem.height > 0) continue;
    if ((txDetails.vin || []).every(input => hasCompleteLocalInputEvidence(ctx, input))) {
      result.add(txid);
    }
  }
  return result;
}

const findFirstHistoryItem = (
  ctx: SyncContext,
  txid: string,
): TxHistoryEntry | undefined => {
  for (const history of ctx.historyResults.values()) {
    const item = history.find(candidate => candidate.tx_hash === txid);
    if (item) return item;
  }
  return undefined;
};

const classifyHistoryItem = async (
  ctx: SyncContext,
  batchTxidSet: Set<string>,
  addressStr: string,
  addressId: string,
  item: TxHistoryEntry,
  options?: NodeRequestOptions,
  blockTimestamps?: ReadonlyMap<number, Date | null>,
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
  const inputClassification = await classifyInputs(ctx, inputs, options);
  const outputTotals = calculateOutputTotals(outputs, ctx);
  const fee = calculateFee(inputClassification, outputTotals.totalOutputs);

  return createClassifiedTransaction({
    ctx,
    item,
    addressId,
    outputTotals,
    fee,
    inputClassification,
    isReceived: outputs.some((out) => outputMatchesAddress(out, addressStr)),
    blockTime: await resolveTransactionBlockTime(
      txDetails,
      item.height,
      ctx.network,
      options,
      blockTimestamps,
    ),
  });
};

const classifyInputs = async (
  ctx: SyncContext,
  inputs: TransactionInput[],
  options?: NodeRequestOptions,
): Promise<InputClassification> => {
  let isSent = false;
  let classificationInputsComplete = true;
  let totalInputs = 0;
  let totalFromWallet = 0;

  for (const input of inputs) {
    options?.signal?.throwIfAborted();
    if (input.coinbase) continue;

    const evidence = await resolveInputEvidence(ctx, input, options);
    if (!evidence.address || evidence.value === undefined) {
      classificationInputsComplete = false;
    }
    if (evidence.value !== undefined) {
      totalInputs += evidence.value;
    }
    if (isWalletEvidence(ctx, evidence)) {
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
  input: TransactionInput,
  options?: NodeRequestOptions,
): Promise<InputEvidence> => {
  const inlineEvidence = getInlineInputEvidence(input);
  if (inlineEvidence.address !== undefined && inlineEvidence.value !== undefined) {
    return inlineEvidence;
  }

  const previousOutput = await resolvePreviousOutput(ctx, input, options);
  const previousEvidence = getOutputEvidence(previousOutput);
  return combineInputEvidence(inlineEvidence, previousEvidence);
};

const combineInputEvidence = (
  inlineEvidence: InputEvidence,
  previousEvidence: InputEvidence,
): InputEvidence => {
  return {
    address: inlineEvidence.address ?? previousEvidence.address,
    value: inlineEvidence.address === undefined
      ? previousEvidence.value
      : inlineEvidence.value ?? previousEvidence.value,
    scriptPubKey: inlineEvidence.scriptPubKey ?? previousEvidence.scriptPubKey,
  };
};

const hasCompleteLocalInputEvidence = (
  ctx: SyncContext,
  input: TransactionInput,
): boolean => {
  if (input.coinbase) return true;
  const inlineEvidence = getInlineInputEvidence(input);
  if (inlineEvidence.address !== undefined && inlineEvidence.value !== undefined) return true;
  if (!input.txid || input.vout === undefined) return false;
  const previousEvidence = getOutputEvidence(
    getCachedPreviousOutput(ctx.txDetailsCache, input.txid, input.vout),
  );
  const combined = combineInputEvidence(inlineEvidence, previousEvidence);
  return combined.address !== undefined && combined.value !== undefined;
};

const getInlineInputEvidence = (input: TransactionInput): InputEvidence => ({
  address: input.prevout?.scriptPubKey
    ? getScriptAddress(input.prevout.scriptPubKey)
    : undefined,
  value: input.prevout?.value === undefined
    ? undefined
    : normalizeInlineInputValue(input.prevout.value),
  scriptPubKey: (input.prevout?.scriptPubKey as { hex?: string } | undefined)?.hex?.toLowerCase(),
});

const resolvePreviousOutput = async (
  ctx: SyncContext,
  input: TransactionInput,
  options?: NodeRequestOptions,
): Promise<TransactionOutput | undefined> => {
  if (!input.txid || input.vout === undefined) return undefined;
  return getCachedPreviousOutput(ctx.txDetailsCache, input.txid, input.vout)
    ?? fetchPreviousOutput(ctx, input.txid, input.vout, options);
};

const getOutputEvidence = (
  output: TransactionOutput | undefined
): InputEvidence => ({
  address: transactionOutputAddress(output),
  value: output ? Math.round(output.value * 100000000) : undefined,
  scriptPubKey: transactionOutputScriptHex(output)?.toLowerCase(),
});

const isWalletEvidence = (ctx: SyncContext, evidence: InputEvidence): boolean => (
  evidence.scriptPubKey !== undefined && ctx.walletScriptToAddress.size > 0
    ? ctx.walletScriptToAddress.has(evidence.scriptPubKey)
    : evidence.address !== undefined && ctx.walletAddressSet.has(evidence.address)
);

const normalizeInlineInputValue = (value: number): number => (
  value >= 1000000 ? value : Math.round(value * 100000000)
);

const fetchPreviousOutput = async (
  ctx: SyncContext,
  txid: string,
  vout: number,
  options?: NodeRequestOptions,
): Promise<TransactionOutput | undefined> => {
  if (ctx.txDetailsCache.has(txid)) {
    return undefined;
  }

  log.debug(`[SYNC] Cache miss for prev tx ${txid.slice(0, 8)}..., fetching individually`);
  await fetchAuthenticatedTransactions(ctx, [txid], options);
  return getCachedPreviousOutput(ctx.txDetailsCache, txid, vout);
};

const getCachedPreviousOutput = (
  txDetailsCache: SyncContext['txDetailsCache'],
  txid: string,
  vout: number
): TransactionOutput | undefined => txDetailsCache.get(txid)?.vout?.[vout];

const calculateOutputTotals = (
  outputs: TransactionOutput[],
  ctx: SyncContext
): OutputTotals => {
  const totals: OutputTotals = {
    hasExternalEvidence: false,
    totalToExternal: 0,
    totalToWallet: 0,
    totalOutputs: 0,
  };

  for (const output of outputs) {
    addOutputToTotals(totals, output, ctx);
  }

  return totals;
};

const addOutputToTotals = (
  totals: OutputTotals,
  output: TransactionOutput,
  ctx: SyncContext
): void => {
  const outputValue = Math.round(output.value * 100000000);
  const outputAddress = transactionOutputAddress(output);

  totals.totalOutputs += outputValue;
  const scriptPubKey = transactionOutputScriptHex(output)?.toLowerCase();
  const isOurs = scriptPubKey !== undefined && ctx.walletScriptToAddress.size > 0
    ? ctx.walletScriptToAddress.has(scriptPubKey)
    : outputAddress !== undefined && ctx.walletAddressSet.has(outputAddress);
  if (!isOurs) {
    totals.hasExternalEvidence = true;
    totals.totalToExternal += outputValue;
  } else {
    totals.totalToWallet += outputValue;
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

const getScriptAddress = (
  scriptPubKey?: InputScriptPubKey | TransactionOutput['scriptPubKey']
): string | undefined =>
  scriptPubKey?.address || (scriptPubKey?.addresses && scriptPubKey.addresses[0]);
