/**
 * Field Populators
 *
 * Individual field population functions for transactions missing
 * blockHeight, blockTime, fee, counterpartyAddress, or addressId.
 */

import { createLogger } from '../../../../utils/logger';
import type { RawTransaction, TransactionInput, TransactionOutput } from '../types';
import type { PopulationStats } from './types';

const log = createLogger('BITCOIN:SVC_CONFIRMATIONS');

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
 * Populate fee from transaction details or input/output calculation
 */
export function populateFee(
  tx: { fee: bigint | null; type: string; amount: bigint; txid: string },
  txDetails: RawTransaction,
  inputs: TransactionInput[],
  outputs: TransactionOutput[],
  prevTxCache: Map<string, RawTransaction>,
  isSentTx: boolean,
  isConsolidationTx: boolean,
  updates: Record<string, unknown>,
  stats: PopulationStats
): void {
  if (tx.fee !== null || (!isSentTx && !isConsolidationTx)) return;

  try {
    if (txDetails.fee != null && txDetails.fee > 0) {
      const feeSats = Math.round(txDetails.fee * 100000000);
      if (feeSats > 0 && feeSats < 100000000) {
        updates.fee = BigInt(feeSats);
        if (isConsolidationTx && tx.amount === BigInt(0)) {
          updates.amount = BigInt(-feeSats);
        }
        stats.feesPopulated++;
      } else {
        log.warn(`Invalid fee from Electrum for tx ${tx.txid}: ${txDetails.fee} BTC`);
      }
    } else {
      let totalInputValue = 0;
      let totalOutputValue = 0;

      for (const output of outputs) {
        if (output.value != null) {
          totalOutputValue += Math.round(output.value * 100000000);
        }
      }

      for (const input of inputs) {
        if (input.coinbase) {
          totalInputValue = totalOutputValue;
          break;
        }

        if (input.prevout && input.prevout.value != null) {
          totalInputValue += Math.round(input.prevout.value * 100000000);
        } else if (input.txid && input.vout != null) {
          const prevTx = prevTxCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            totalInputValue += Math.round(prevTx.vout[input.vout].value * 100000000);
          }
        }
      }

      if (totalInputValue > 0 && totalInputValue >= totalOutputValue) {
        const fee = totalInputValue - totalOutputValue;
        if (fee > 0 && fee < 100000000) {
          updates.fee = BigInt(fee);
          if (isConsolidationTx && tx.amount === BigInt(0)) {
            updates.amount = BigInt(-fee);
          }
          stats.feesPopulated++;
        }
      }
    }
  } catch (feeError) {
    log.warn(`Could not calculate fee for tx ${tx.txid}`, { error: String(feeError) });
  }
}

/**
 * Populate counterparty address (sender for received, recipient for sent)
 */
export function populateCounterpartyAddress(
  tx: { counterpartyAddress: string | null; txid: string },
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
    if (isReceivedTx) {
      for (const input of inputs) {
        if (input.coinbase) break;

        if (input.prevout && input.prevout.scriptPubKey) {
          const senderAddr = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          if (senderAddr) {
            updates.counterpartyAddress = senderAddr;
            break;
          }
        } else if (input.txid && input.vout != null) {
          const prevTx = prevTxCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            const senderAddr = prevOutput.scriptPubKey?.address ||
              (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            if (senderAddr) {
              updates.counterpartyAddress = senderAddr;
              break;
            }
          }
        }
      }
    } else if (isSentTx) {
      for (const output of outputs) {
        const outputAddr = output.scriptPubKey?.address ||
          (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);
        if (outputAddr && !walletAddressSet.has(outputAddr)) {
          updates.counterpartyAddress = outputAddr;
          break;
        }
      }
    }
  } catch (counterpartyError) {
    log.warn(`Could not get counterparty address for tx ${tx.txid}`, { error: String(counterpartyError) });
  }
}

/**
 * Populate addressId by matching transaction inputs/outputs to wallet addresses
 */
export function populateAddressId(
  tx: { addressId: string | null; type: string },
  txDetails: RawTransaction,
  walletAddresses: Array<{ id: string; address: string }>,
  walletAddressLookup: Map<string, string>,
  walletAddressSet: Set<string>,
  updates: Record<string, unknown>,
  _stats: PopulationStats
): void {
  if (tx.addressId !== null || walletAddresses.length === 0) return;

  // Check outputs for receive transactions
  if (tx.type === 'received' || tx.type === 'receive') {
    const outputs = txDetails.vout || [];
    for (const output of outputs) {
      const outputAddresses = output.scriptPubKey?.addresses || [];
      if (output.scriptPubKey?.address) {
        outputAddresses.push(output.scriptPubKey.address);
      }

      for (const addr of outputAddresses) {
        if (walletAddressSet.has(addr)) {
          const addressId = walletAddressLookup.get(addr);
          if (addressId) {
            updates.addressId = addressId;
            break;
          }
        }
      }
      if (updates.addressId) break;
    }
  }

  // Check inputs for send transactions
  if (tx.type === 'sent' || tx.type === 'send') {
    const inputs = txDetails.vin || [];
    for (const input of inputs) {
      if (input.prevout && input.prevout.scriptPubKey) {
        const inputAddress = input.prevout.scriptPubKey.address ||
          (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);

        if (inputAddress && walletAddressSet.has(inputAddress)) {
          const addressId = walletAddressLookup.get(inputAddress);
          if (addressId) {
            updates.addressId = addressId;
            break;
          }
        }
      }
    }
  }
}
