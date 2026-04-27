import { createLogger } from '../../../../utils/logger';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';
import type { PopulationStats } from './types';

const log = createLogger('BITCOIN:SVC_CONFIRMATION_FEES');

interface FeeTransaction {
  fee: bigint | null;
  type: string;
  amount: bigint;
  txid: string;
}

const shouldPopulateFee = (
  tx: FeeTransaction,
  isSentTx: boolean,
  isConsolidationTx: boolean
): boolean => {
  return tx.fee === null && (isSentTx || isConsolidationTx);
};

const isValidFeeSats = (feeSats: number): boolean => {
  return feeSats > 0 && feeSats < 100000000;
};

const electrumFeeSats = (tx: FeeTransaction, txDetails: RawTransaction): number | null => {
  if (txDetails.fee == null || txDetails.fee <= 0) {
    return null;
  }

  const feeSats = Math.round(txDetails.fee * 100000000);
  if (isValidFeeSats(feeSats)) {
    return feeSats;
  }

  log.warn(`Invalid fee from Electrum for tx ${tx.txid}: ${txDetails.fee} BTC`);
  return null;
};

const sumOutputSats = (outputs: TransactionOutput[]): number => {
  return outputs.reduce((sum, output) => {
    if (output.value != null) {
      return sum + Math.round(output.value * 100000000);
    }

    /* v8 ignore next -- malformed Electrum outputs without value are treated as zero */
    return sum;
  }, 0);
};

const getInputValueSats = (
  input: TransactionInput,
  prevTxCache: Map<string, RawTransaction>
): number => {
  if (input.prevout && input.prevout.value != null) {
    return Math.round(input.prevout.value * 100000000);
  }

  if (!input.txid || input.vout == null) {
    return 0;
  }

  const prevOutput = prevTxCache.get(input.txid)?.vout?.[input.vout];
  return prevOutput ? Math.round(prevOutput.value * 100000000) : 0;
};

const sumInputSats = (
  inputs: TransactionInput[],
  totalOutputValue: number,
  prevTxCache: Map<string, RawTransaction>
): number => {
  let totalInputValue = 0;
  for (const input of inputs) {
    if (input.coinbase) {
      return totalOutputValue;
    }

    totalInputValue += getInputValueSats(input, prevTxCache);
  }
  return totalInputValue;
};

const calculatedFeeSats = (
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>
): number | null => {
  const totalOutputValue = sumOutputSats(outputs);
  const totalInputValue = sumInputSats(inputs, totalOutputValue, prevTxCache);
  if (totalInputValue <= 0 || totalInputValue < totalOutputValue) {
    return null;
  }

  const fee = totalInputValue - totalOutputValue;
  return isValidFeeSats(fee) ? fee : null;
};

const resolveFeeSats = (
  tx: FeeTransaction,
  txDetails: RawTransaction,
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>
): number | null => {
  return electrumFeeSats(tx, txDetails) ?? calculatedFeeSats(inputs, outputs, prevTxCache);
};

const applyFeeUpdate = (
  tx: FeeTransaction,
  feeSats: number,
  isConsolidationTx: boolean,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void => {
  updates.fee = BigInt(feeSats);
  if (isConsolidationTx && tx.amount === BigInt(0)) {
    updates.amount = BigInt(-feeSats);
  }
  stats.feesPopulated++;
};

/**
 * Populate fee from transaction details or input/output calculation.
 */
export function populateFee(
  tx: FeeTransaction,
  txDetails: RawTransaction,
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>,
  isSentTx: boolean,
  isConsolidationTx: boolean,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (!shouldPopulateFee(tx, isSentTx, isConsolidationTx)) return;

  try {
    const feeSats = resolveFeeSats(tx, txDetails, inputs, outputs, prevTxCache);
    if (feeSats !== null) {
      applyFeeUpdate(tx, feeSats, isConsolidationTx, updates, stats);
    }
  } catch (feeError) {
    log.warn(`Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
  }
}
