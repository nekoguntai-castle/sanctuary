/**
 * Transaction Classification
 *
 * Classifies transactions as received, sent, or consolidation based on
 * input/output analysis. Handles fetching of previous transaction outputs
 * for input resolution.
 */

import { createLogger } from '../../../../../utils/logger';
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

type InputAddressResolution = {
  address?: string;
  hasVerboseInput: boolean;
};

type OutputTotals = {
  totalToExternal: number;
  totalToWallet: number;
  totalOutputs: number;
};

type TransactionBase = Pick<
  TransactionCreateData,
  'txid' | 'walletId' | 'addressId' | 'confirmations' | 'blockHeight' | 'blockTime' | 'rbfStatus'
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

  for (const [addressStr, history] of ctx.historyResults) {
    const addressRecord = ctx.addressMap.get(addressStr)!;

    for (const item of history) {
      const transaction = await classifyHistoryItem(
        ctx,
        batchTxidSet,
        addressStr,
        addressRecord.id,
        item
      );

      if (transaction) {
        transactionsToCreate.push(transaction);
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
  const isSent = await hasWalletInput(ctx, inputs);
  const outputTotals = calculateOutputTotals(outputs, ctx.walletAddressSet);
  const totalInputs = calculateTotalInputs(isSent, inputs, ctx.txDetailsCache);
  const fee = calculateFee(isSent, totalInputs, outputTotals.totalOutputs);

  return createClassifiedTransaction({
    ctx,
    item,
    addressId,
    outputs,
    outputTotals,
    fee,
    isSent,
    isReceived: outputs.some((out) => outputMatchesAddress(out, addressStr)),
    blockTime: await getTransactionBlockTime(txDetails, item.height),
  });
};

const hasWalletInput = async (
  ctx: SyncContext,
  inputs: TransactionInput[]
): Promise<boolean> => {
  let isSent = false;
  let hasVerboseInputs = false;

  for (const input of inputs) {
    if (input.coinbase) continue;

    const resolution = await resolveInputAddress(ctx, input);
    if (resolution.hasVerboseInput) {
      hasVerboseInputs = true;
    }

    if (resolution.address && ctx.walletAddressSet.has(resolution.address)) {
      isSent = true;
      if (hasVerboseInputs) {
        return true;
      }
    }
  }

  return isSent;
};

const resolveInputAddress = async (
  ctx: SyncContext,
  input: TransactionInput
): Promise<InputAddressResolution> => {
  if (input.prevout && input.prevout.scriptPubKey) {
    return {
      address: getScriptAddress(input.prevout.scriptPubKey),
      hasVerboseInput: true,
    };
  }

  if (!input.txid || input.vout === undefined) {
    return { hasVerboseInput: false };
  }

  const cachedOutput = getCachedPreviousOutput(ctx.txDetailsCache, input.txid, input.vout);
  if (cachedOutput) {
    return {
      address: getScriptAddress(cachedOutput.scriptPubKey),
      hasVerboseInput: false,
    };
  }

  const fetchedOutput = await fetchPreviousOutput(ctx, input.txid, input.vout);
  return {
    address: fetchedOutput ? getScriptAddress(fetchedOutput.scriptPubKey) : undefined,
    hasVerboseInput: false,
  };
};

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
    log.debug(`Failed to fetch prev tx ${txid.slice(0, 8)}...`, { error: String(e) });
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
    totals.totalToExternal += outputValue;
  } else if (outputAddress) {
    totals.totalToWallet += outputValue;
  }
};

const calculateTotalInputs = (
  isSent: boolean,
  inputs: TransactionInput[],
  txDetailsCache: SyncContext['txDetailsCache']
): number => {
  if (!isSent) {
    return 0;
  }

  return inputs.reduce(
    (total, input) => total + getInputValue(input, txDetailsCache),
    0
  );
};

const getInputValue = (
  input: TransactionInput,
  txDetailsCache: SyncContext['txDetailsCache']
): number => {
  if (input.coinbase) {
    return 0;
  }

  if (input.prevout && input.prevout.value !== undefined) {
    // Electrum verbose prevouts may arrive as satoshis; cached tx outputs use BTC.
    return input.prevout.value >= 1000000
      ? input.prevout.value
      : Math.round(input.prevout.value * 100000000);
  }

  if (input.txid && input.vout !== undefined) {
    const prevOutput = getCachedPreviousOutput(txDetailsCache, input.txid, input.vout);
    return prevOutput ? Math.round(prevOutput.value * 100000000) : 0;
  }

  return 0;
};

const calculateFee = (
  isSent: boolean,
  totalInputs: number,
  totalOutputs: number
): number | null => {
  const calculatedFee = isSent && totalInputs > 0 ? totalInputs - totalOutputs : null;
  return calculatedFee !== null && calculatedFee >= 0 ? calculatedFee : null;
};

const createClassifiedTransaction = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  addressId: string;
  outputs: TransactionOutput[];
  outputTotals: OutputTotals;
  fee: number | null;
  isSent: boolean;
  isReceived: boolean;
  blockTime: Date | null;
}): TransactionCreateData | null => {
  const base = createTransactionBase(args);

  if (shouldCreateConsolidation(args)) {
    markExisting(args.ctx, args.item.tx_hash, 'consolidation');
    return createConsolidationTransaction(base, args.fee);
  }

  if (shouldCreateSent(args)) {
    markExisting(args.ctx, args.item.tx_hash, 'sent');
    return createSentTransaction(base, args.outputTotals.totalToExternal, args.fee);
  }

  if (shouldCreateReceived(args)) {
    markExisting(args.ctx, args.item.tx_hash, 'received');
    return createReceivedTransaction(base, args.outputs, args.ctx.walletAddressSet);
  }

  return null;
};

const createTransactionBase = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  addressId: string;
  blockTime: Date | null;
}): TransactionBase => {
  const confirmations = getConfirmations(args.item.height, args.ctx.currentBlockHeight);

  return {
    txid: args.item.tx_hash,
    walletId: args.ctx.walletId,
    addressId: args.addressId,
    confirmations,
    blockHeight: args.item.height > 0 ? args.item.height : null,
    blockTime: args.blockTime,
    rbfStatus: confirmations > 0 ? 'confirmed' : 'active',
  };
};

const shouldCreateConsolidation = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  outputTotals: OutputTotals;
  isSent: boolean;
}): boolean =>
  args.isSent &&
  args.outputTotals.totalToExternal === 0 &&
  args.outputTotals.totalToWallet > 0 &&
  !args.ctx.existingTxMap.has(`${args.item.tx_hash}:consolidation`);

const shouldCreateSent = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  outputTotals: OutputTotals;
  isSent: boolean;
}): boolean =>
  args.isSent &&
  args.outputTotals.totalToExternal > 0 &&
  !args.ctx.existingTxMap.has(`${args.item.tx_hash}:sent`);

const shouldCreateReceived = (args: {
  ctx: SyncContext;
  item: TxHistoryEntry;
  isSent: boolean;
  isReceived: boolean;
}): boolean =>
  !args.isSent &&
  args.isReceived &&
  !args.ctx.existingTxMap.has(`${args.item.tx_hash}:received`);

const markExisting = (
  ctx: SyncContext,
  txid: string,
  type: TransactionCreateData['type']
): void => {
  ctx.existingTxMap.set(`${txid}:${type}`, true);
};

const createConsolidationTransaction = (
  base: TransactionBase,
  fee: number | null
): TransactionCreateData => ({
  ...base,
  type: 'consolidation',
  amount: BigInt(fee !== null ? -fee : 0),
  fee: fee !== null ? BigInt(fee) : null,
});

const createSentTransaction = (
  base: TransactionBase,
  totalToExternal: number,
  fee: number | null
): TransactionCreateData => ({
  ...base,
  type: 'sent',
  amount: BigInt(-(totalToExternal + (fee ?? 0))),
  fee: fee !== null ? BigInt(fee) : null,
});

const createReceivedTransaction = (
  base: TransactionBase,
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): TransactionCreateData => ({
  ...base,
  type: 'received',
  amount: BigInt(calculateReceivedAmount(outputs, walletAddressSet)),
});

const calculateReceivedAmount = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): number =>
  outputs
    .filter((out) => {
      const outAddr = getScriptAddress(out.scriptPubKey);
      return outAddr && walletAddressSet.has(outAddr);
    })
    .reduce((sum, out) => sum + Math.round(out.value * 100000000), 0);

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
