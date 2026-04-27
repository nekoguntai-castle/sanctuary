import { createLogger } from '../../../../utils/logger';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';
import type { PopulationStats } from './types';

const log = createLogger('BITCOIN:SVC_CONFIRMATION_COUNTERPARTY');

interface CounterpartyTransaction {
  counterpartyAddress: string | null;
  txid: string;
}

interface ScriptAddressSource {
  address?: string;
  addresses?: string[];
}

const getScriptAddress = (source: ScriptAddressSource | undefined): string | undefined => {
  return source?.address || source?.addresses?.[0];
};

const getInputCounterpartyAddress = (
  input: TransactionInput,
  prevTxCache: Map<string, RawTransaction>
): string | undefined => {
  const directAddress = getScriptAddress(input.prevout?.scriptPubKey);
  if (directAddress || !input.txid || input.vout == null) {
    return directAddress;
  }

  const prevOutput = prevTxCache.get(input.txid)?.vout?.[input.vout];
  return getScriptAddress(prevOutput?.scriptPubKey);
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
    const address = getScriptAddress(output.scriptPubKey);
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
