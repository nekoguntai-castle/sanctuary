/**
 * Field Populators
 *
 * Individual field population functions for transactions missing
 * blockHeight, blockTime, fee, counterpartyAddress, or addressId.
 */

import { createLogger } from '../../../../utils/logger';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';
import type { PopulationStats } from './types';
export { populateFee } from './feePopulation';
export { populateCounterpartyAddress } from './counterpartyPopulation';

const log = createLogger('BITCOIN:SVC_CONFIRMATIONS');

type AddressLookup = Map<string, string>;
type ScriptAddressSource = {
  address?: string;
  addresses?: string[];
};

/**
 * Populate blockHeight from various sources (Electrum, RPC, address history)
 */
export function populateBlockHeight(
  tx: { blockHeight: number | null; txid: string },
  txDetails: RawTransaction,
  txHeightFromHistory: Map<string, number>,
  currentHeight: number,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.blockHeight !== null) return;

  if (txDetails?.blockheight) {
    updates.blockHeight = txDetails.blockheight;
    updates.confirmations = Math.max(0, currentHeight - txDetails.blockheight + 1);
    stats.blockHeightsPopulated++;
  } else if (txDetails?.confirmations && txDetails.confirmations > 0) {
    const calculatedBlockHeight = currentHeight - txDetails.confirmations + 1;
    updates.blockHeight = calculatedBlockHeight;
    updates.confirmations = txDetails.confirmations;
    stats.blockHeightsPopulated++;
  } else if (txHeightFromHistory.has(tx.txid)) {
    const heightFromHistory = txHeightFromHistory.get(tx.txid)!;
    updates.blockHeight = heightFromHistory;
    updates.confirmations = Math.max(0, currentHeight - heightFromHistory + 1);
    stats.blockHeightsPopulated++;
    log.debug(`Got blockHeight ${heightFromHistory} from address history for tx ${tx.txid}`);
  }
}

/**
 * Populate blockTime from transaction details or block header
 */
export function populateBlockTime(
  tx: { blockTime: Date | null; blockHeight: number | null },
  txDetails: RawTransaction,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.blockTime !== null) return;

  if (txDetails.time) {
    updates.blockTime = new Date(txDetails.time * 1000);
    stats.blockTimesPopulated++;
  }
  // Note: async getBlockTimestamp fallback is handled in processTransactionUpdates
}

/**
 * Populate addressId by matching transaction inputs/outputs to wallet addresses
 */
export function populateAddressId(
  tx: { addressId: string | null; type: string },
  txDetails: RawTransaction,
  walletAddresses: Array<{ id: string; address: string }>,
  walletAddressLookup: AddressLookup,
  walletAddressSet: Set<string>,
  updates: Record<string, unknown>,
  _stats: PopulationStats
): void {
  if (tx.addressId !== null || walletAddresses.length === 0) return;

  const addressId = findTransactionAddressId(
    tx.type,
    txDetails,
    walletAddressLookup,
    walletAddressSet
  );

  if (addressId) {
    updates.addressId = addressId;
  }
}

const findTransactionAddressId = (
  type: string,
  txDetails: RawTransaction,
  walletAddressLookup: AddressLookup,
  walletAddressSet: Set<string>
): string | undefined => {
  if (isReceivedType(type)) {
    return findReceivedAddressId(txDetails.vout || [], walletAddressLookup, walletAddressSet);
  }

  if (isSentType(type)) {
    return findSentAddressId(txDetails.vin || [], walletAddressLookup, walletAddressSet);
  }

  return undefined;
};

const isReceivedType = (type: string): boolean => {
  return type === 'received' || type === 'receive';
};

const isSentType = (type: string): boolean => {
  return type === 'sent' || type === 'send';
};

const findReceivedAddressId = (
  outputs: TransactionOutput[],
  walletAddressLookup: AddressLookup,
  walletAddressSet: Set<string>
): string | undefined => {
  for (const output of outputs) {
    const addressId = findWalletAddressId(
      getOutputAddresses(output.scriptPubKey),
      walletAddressLookup,
      walletAddressSet
    );
    if (addressId) return addressId;
  }

  return undefined;
};

const findSentAddressId = (
  inputs: TransactionInput[],
  walletAddressLookup: AddressLookup,
  walletAddressSet: Set<string>
): string | undefined => {
  for (const input of inputs) {
    const addressId = findWalletAddressId(
      getInputAddresses(input),
      walletAddressLookup,
      walletAddressSet
    );
    if (addressId) return addressId;
  }

  return undefined;
};

const getOutputAddresses = (scriptPubKey: ScriptAddressSource | undefined): string[] => {
  const addresses = scriptPubKey?.addresses ? [...scriptPubKey.addresses] : [];
  if (scriptPubKey?.address) {
    addresses.push(scriptPubKey.address);
  }
  return addresses;
};

const getInputAddresses = (input: TransactionInput): string[] => {
  const inputAddress = input.prevout?.scriptPubKey?.address ||
    input.prevout?.scriptPubKey?.addresses?.[0];
  return inputAddress ? [inputAddress] : [];
};

const findWalletAddressId = (
  addresses: string[],
  walletAddressLookup: AddressLookup,
  walletAddressSet: Set<string>
): string | undefined => {
  for (const address of addresses) {
    if (!walletAddressSet.has(address)) continue;

    const addressId = walletAddressLookup.get(address);
    if (addressId) return addressId;
  }

  return undefined;
};
