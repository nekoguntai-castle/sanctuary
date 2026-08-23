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
import type { ValidatedBroadcastArtifact } from '../signingIntent/artifactValidation';

const log = createLogger('BITCOIN:SVC_BLOCKCHAIN');

/**
 * Broadcast a transaction to the selected network.
 *
 */
export async function broadcastTransaction(
  artifact: ValidatedBroadcastArtifact,
): Promise<{
  txid: string;
  broadcasted: boolean;
}> {
  return broadcastAuthenticatedRawTransaction({
    rawTx: artifact.rawTx,
    network: artifact.network,
    expectedTxid: artifact.txid,
    replacement: Boolean(artifact.snapshot.transaction.replacementTxid),
  });
}

export class DefiniteBroadcastRejectionError extends Error {}

export async function broadcastAuthenticatedRawTransaction(input: {
  rawTx: string;
  network: BitcoinNetwork;
  expectedTxid: string;
  replacement: boolean;
}): Promise<{ txid: string; broadcasted: boolean }> {
  const { rawTx, network, expectedTxid } = input;
  const client = await getNodeClient(network);

  let preflight;
  try {
    preflight = await verifyElectrumBroadcastPreflight(
      client,
      rawTx,
      input.replacement,
    );
  } catch (error) {
    if (error instanceof BroadcastPreflightError) {
      log.warn('[BLOCKCHAIN] Broadcast preflight failed', {
        network, reason: error.reason, details: error.details,
      });
    }
    throw new DefiniteBroadcastRejectionError(
      `Failed to broadcast transaction: ${getErrorMessage(error, 'Unknown error')}`,
    );
  }
  log.debug('[BLOCKCHAIN] Broadcast preflight passed', {
    network, txid: preflight.txid, inputCount: preflight.inputCount,
  });

  try {
    const txid = await client.broadcastTransaction(rawTx);
    if (txid !== expectedTxid) {
      throw new Error(`Node returned unexpected txid ${txid}; expected ${expectedTxid}`);
    }
    return {
      txid,
      broadcasted: true,
    };
  } catch (error) {
    throw new Error(`Broadcast outcome is unknown: ${getErrorMessage(error, 'Unknown error')}`);
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
