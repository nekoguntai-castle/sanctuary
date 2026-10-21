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
): number | null => {
  if (!input.txid || input.vout == null) {
    return null;
  }

  const prevOutput = prevTxCache.get(input.txid)?.vout?.[input.vout];
  return prevOutput ? Math.round(prevOutput.value * 100000000) : null;
};

const sumInputSats = (
  txid: string,
  inputs: TransactionInput[],
  totalOutputValue: number,
  prevTxCache: Map<string, RawTransaction>
): number | null => {
  let totalInputValue = 0;
  let unresolved = 0;
  for (const input of inputs) {
    if (input.coinbase) {
      return totalOutputValue;
    }

    const value = getInputValueSats(input, prevTxCache);
    if (value === null) {
      unresolved++;
    } else {
      totalInputValue += value;
    }
  }

  if (unresolved > 0) {
    // A partial sum would persist an understated fee permanently; leave it null so a later pass retries.
    log.debug(`Skipping calculated fee for tx ${txid}: ${unresolved} unresolved input value(s)`);
    return null;
  }
  return totalInputValue;
};

const calculatedFeeSats = (
  txid: string,
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>
): number | null => {
  const totalOutputValue = sumOutputSats(outputs);
  const totalInputValue = sumInputSats(txid, inputs, totalOutputValue, prevTxCache);
  if (totalInputValue === null || totalInputValue <= 0 || totalInputValue < totalOutputValue) {
    return null;
  }

  const fee = totalInputValue - totalOutputValue;
  return isValidFeeSats(fee) ? fee : null;
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
 * Populate fee from the authenticated inputs and outputs: the sum of the
 * authenticated parent outputs spent, minus the outputs.
 */
export function populateFee(
  tx: FeeTransaction,
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
    const feeSats = calculatedFeeSats(tx.txid, inputs, outputs, prevTxCache);
    if (feeSats !== null) {
      applyFeeUpdate(tx, feeSats, isConsolidationTx, updates, stats);
    }
  } catch (feeError) {
    log.warn(`Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
  }
}
