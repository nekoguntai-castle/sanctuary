/**
 * Network Operations
 *
 * High-level blockchain network operations: broadcasting transactions,
 * fee estimation, transaction details, address monitoring, and address checking.
 */

import { getNodeClient } from '../nodeClient';
import type { TransactionDetails } from '../electrum';
import { validateAddress } from '../utils';
import type { BitcoinNetwork } from '../networks';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { FeeEstimates, CheckAddressResult } from './types';
import { BroadcastPreflightError, verifyElectrumBroadcastPreflight } from './broadcastPreflight';

const log = createLogger('BITCOIN:SVC_BLOCKCHAIN');

/**
 * Broadcast a transaction to the selected network.
 *
 */
export async function broadcastTransaction(
  rawTx: string,
  network: BitcoinNetwork
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  const client = await getNodeClient(network);

  try {
    const preflight = await verifyElectrumBroadcastPreflight(client, rawTx);
    log.debug('[BLOCKCHAIN] Broadcast preflight passed', {
      network,
      txid: preflight.txid,
      inputCount: preflight.inputCount,
    });

    const txid = await client.broadcastTransaction(rawTx);
    return {
      txid,
      broadcasted: true,
    };
  } catch (error) {
    if (error instanceof BroadcastPreflightError) {
      log.warn('[BLOCKCHAIN] Broadcast preflight failed', {
        network,
        reason: error.reason,
        details: error.details,
      });
    }

    throw new Error(`Failed to broadcast transaction: ${getErrorMessage(error, 'Unknown error')}`);
  }
}

/**
 * Get fee estimates for different confirmation targets
 */
export async function getFeeEstimates(network: BitcoinNetwork): Promise<FeeEstimates> {
  const client = await getNodeClient(network);

  try {
    const [fastest, halfHour, hour, economy] = await Promise.all([
      client.estimateFee(1),
      client.estimateFee(3),
      client.estimateFee(6),
      client.estimateFee(12),
    ]);

    return {
      fastest: Math.max(1, fastest),
      halfHour: Math.max(1, halfHour),
      hour: Math.max(1, hour),
      economy: Math.max(1, economy),
    };
  } catch (error) {
    log.error('[BLOCKCHAIN] Failed to get fee estimates', { error: getErrorMessage(error) });
    // Return sensible defaults if fee estimation fails
    return {
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
    };
  }
}

/**
 * Get transaction details from blockchain
 */
export async function getTransactionDetails(
  txid: string,
  network: BitcoinNetwork
): Promise<TransactionDetails> {
  const client = await getNodeClient(network);

  return client.getTransaction(txid, true);
}

/**
 * Monitor address for new transactions
 * Subscribe to address and get notifications
 */
export async function monitorAddress(
  address: string,
  network: BitcoinNetwork
): Promise<string | null> {
  const client = await getNodeClient(network);

  return client.subscribeAddress(address);
}

/**
 * Validate and check if address is used
 */
export async function checkAddress(
  address: string,
  network: BitcoinNetwork = 'mainnet'
): Promise<CheckAddressResult> {
  // First validate format
  const validation = validateAddress(address, network);
  if (!validation.valid) {
    return validation;
  }

  // Check blockchain
  const client = await getNodeClient(network);

  try {
    if (!client.isConnected()) {
      await client.connect();
    }

    const [balance, history] = await Promise.all([
      client.getAddressBalance(address),
      client.getAddressHistory(address),
    ]);

    return {
      valid: true,
      balance: balance.confirmed + balance.unconfirmed,
      transactionCount: history.length,
    };
  } catch (error) {
    return {
      valid: true, // Address format is valid even if we can't check blockchain
      error: 'Could not check address on blockchain',
    };
  }
}
