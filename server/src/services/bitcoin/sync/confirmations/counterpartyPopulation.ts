import { createLogger } from '../../../../utils/logger';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';
import type { PopulationStats } from './types';
import { transactionOutputAddress } from '../transactionOutputEvidence';

const log = createLogger('BITCOIN:SVC_CONFIRMATION_COUNTERPARTY');

interface CounterpartyTransaction {
  counterpartyAddress: string | null;
  txid: string;
}

const getInputCounterpartyAddress = (
  input: TransactionInput,
  prevTxCache: Map<string, RawTransaction>
): string | undefined => {
  if (!input.txid || input.vout == null) {
    return undefined;
  }

  const prevOutput = prevTxCache.get(input.txid)?.vout?.[input.vout];
  return transactionOutputAddress(prevOutput);
};

const findReceivedCounterpartyAddress = (
  inputs: TransactionInput[],
  prevTxCache: Map<string, RawTransaction>
): string | undefined => {
  for (const input of inputs) {
    if (input.coinbase) break;

    const address = getInputCounterpartyAddress(input, prevTxCache);
    if (address) return address;
  }
  return undefined;
};

const findSentCounterpartyAddress = (
  outputs: TransactionOutput[],
  walletAddressSet: Set<string>
): string | undefined => {
  for (const output of outputs) {
    const address = transactionOutputAddress(output);
    if (address && !walletAddressSet.has(address)) {
      return address;
    }
  }
  /* v8 ignore next -- sent transactions with only wallet outputs intentionally leave counterparty unset */
  return undefined;
};

const resolveCounterpartyAddress = (
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>,
  walletAddressSet: Set<string>,
  isSentTx: boolean,
  isReceivedTx: boolean
): string | undefined => {
  if (isReceivedTx) {
    return findReceivedCounterpartyAddress(inputs, prevTxCache);
  }
  if (isSentTx) {
    return findSentCounterpartyAddress(outputs, walletAddressSet);
  }
  return undefined;
};

/**
 * Populate counterparty address (sender for received, recipient for sent).
 */
export function populateCounterpartyAddress(
  tx: CounterpartyTransaction,
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>,
  walletAddressSet: Set<string>,
  isSentTx: boolean,
  isReceivedTx: boolean,
  updates: Record<string, unknown>,
  _stats: PopulationStats
): void {
  if (tx.counterpartyAddress !== null) return;

  try {
    const counterpartyAddress = resolveCounterpartyAddress(
      inputs,
      outputs,
      prevTxCache,
      walletAddressSet,
      isSentTx,
      isReceivedTx
    );
    if (counterpartyAddress) {
      updates.counterpartyAddress = counterpartyAddress;
    }
  } catch (counterpartyError) {
    log.warn(`Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
  }
}
