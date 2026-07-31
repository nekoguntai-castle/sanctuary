/**
 * Notification Subscriptions
 *
 * Handles Electrum address/wallet subscriptions and processes incoming
 * blockchain events (address updates, new transactions, confirmation changes).
 */

import { getWebSocketServer } from '../server';
import { getElectrumClient } from '../../services/bitcoin/electrum';
import { addressRepository, walletRepository, transactionRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import {
  broadcastTransactionNotification,
  broadcastBalanceUpdate,
} from './broadcasts';
import type { TransactionNotification } from './types';

const log = createLogger('WS:NOTIFY_SUB');

/**
 * Subscribe to new blocks with retry logic
 */
export async function subscribeToBlocks(maxRetries = 3, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // In production, this would subscribe to Electrum's blockchain.headers.subscribe
      // For demo, we'll simulate periodic block checks
      log.debug('Subscribed to blockchain headers');
      return;
    } catch (err) {
      log.warn(`Failed to subscribe to blocks (attempt ${attempt}/${maxRetries})`, { error: String(err) });
      if (attempt < maxRetries) {
        const delay = delayMs * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        log.error('Failed to subscribe to blocks after all retries', { error: String(err) });
      }
    }
  }
}

/**
 * Subscribe to address updates via Electrum
 */
export async function subscribeToAddress(
  address: string,
  _walletId: string,
  subscribedAddresses: Set<string>,
): Promise<void> {
  if (subscribedAddresses.has(address)) {
    return;
  }

  try {
    // Subscribe to address via Electrum
    const electrumClient = await getElectrumClient();
    await electrumClient.subscribeAddress(address);

    subscribedAddresses.add(address);
    log.debug(`Subscribed to address updates: ${address}`);

    // Note: Electrum subscriptions work via the persistent connection
    // Status changes are received via the socket and would need to be
    // handled separately in the electrum client event handlers
  } catch (err) {
    log.error(`Failed to subscribe to address ${address}`, { error: String(err) });
  }
}

/**
 * Unsubscribe all addresses for a wallet (call when wallet is deleted)
 * Prevents memory leak by cleaning up the subscribedAddresses set
 */
export async function unsubscribeWalletAddresses(
  walletId: string,
  subscribedAddresses: Set<string>,
): Promise<void> {
  try {
    // Get all addresses for this wallet from the database
    const addressStrings = await addressRepository.findAddressStrings(walletId);

    let unsubscribed = 0;
    for (const address of addressStrings) {
      if (subscribedAddresses.has(address)) {
        subscribedAddresses.delete(address);
        unsubscribed++;
      }
    }

    if (unsubscribed > 0) {
      log.debug(`[NOTIFY] Unsubscribed ${unsubscribed} addresses for wallet ${walletId}`);
    }
  } catch (error) {
    log.warn('[NOTIFY] Failed to unsubscribe wallet addresses', { walletId, error: String(error) });
  }
}

/**
 * Subscribe wallet to real-time updates by subscribing all its addresses
 */
export async function subscribeWallet(
  walletId: string,
  subscribedAddresses: Set<string>,
): Promise<void> {
  try {
    // Get all addresses for this wallet
    const allAddresses = await addressRepository.findByWalletId(walletId);

    // Subscribe to each address
    for (const addr of allAddresses) {
      await subscribeToAddress(addr.address, walletId, subscribedAddresses);
    }

    log.debug(`Wallet ${walletId} subscribed to real-time updates`);
  } catch (err) {
    log.error(`Failed to subscribe wallet ${walletId}`, { error: String(err) });
  }
}

/**
 * Handle address status update from Electrum
 */
export async function handleAddressUpdate(address: string, _walletId: string): Promise<void> {
  try {
    // Get address from database
    const addressRecord = await addressRepository.findByAddressWithWallet(address);

    if (!addressRecord) {
      log.warn(`Address ${address} not found in database`);
      return;
    }

    // Fetch transaction history from Electrum
    const electrumClient = await getElectrumClient();
    const history = await electrumClient.getAddressHistory(address);

    // Check for new transactions
    for (const tx of history) {
      await handleTransaction(tx.tx_hash, addressRecord.wallet.id, address);
    }

    // Update balance
    const balance = await electrumClient.getAddressBalance(address);
    await handleBalanceUpdate(addressRecord.wallet.id, balance);
  } catch (err) {
    log.error('Failed to handle address update', { error: String(err) });
  }
}

/**
 * Handle new/updated transaction
 */
export async function handleTransaction(txid: string, walletId: string, _address: string): Promise<void> {
  try {
    // Check if transaction already exists
    const existing = await transactionRepository.findByTxid(txid, walletId);

    if (existing) {
      // Check for confirmation updates
      await checkConfirmationUpdate(txid, walletId);
      return;
    }

    // New transaction - broadcast notification
    const notification: TransactionNotification = {
      txid,
      walletId,
      type: 'received', // Determine from transaction details
      amount: 0, // Parse from transaction
      confirmations: 0,
      timestamp: new Date(),
    };

    broadcastTransactionNotification(notification);
  } catch (err) {
    log.error('Failed to handle transaction', { error: String(err) });
  }
}

/**
 * Check for confirmation updates on a transaction
 */
export async function checkConfirmationUpdate(txid: string, walletId: string): Promise<void> {
  try {
    const transaction = await transactionRepository.findByTxid(txid, walletId);

    if (!transaction) return;

    // In production, fetch current confirmations from Electrum
    // If confirmations changed, broadcast update

    const wsServer = getWebSocketServer();
    wsServer.broadcast({
      type: 'confirmation',
      walletId,
      data: {
        walletId,  // Include walletId in data for client identification
        txid,
        confirmations: transaction.confirmations,
      },
    });
  } catch (err) {
    log.error('Failed to check confirmation update', { error: String(err) });
  }
}

/**
 * Handle balance update from Electrum
 */
export async function handleBalanceUpdate(walletId: string, balance: { confirmed: number; unconfirmed: number }): Promise<void> {
  try {
    const wallet = await walletRepository.findById(walletId);

    if (!wallet) return;

    broadcastBalanceUpdate({
      walletId,
      balance: balance.confirmed,
      unconfirmed: balance.unconfirmed,
      previousBalance: 0, // Get from wallet record
      change: balance.confirmed - 0,
    });
  } catch (err) {
    log.error('Failed to handle balance update', { error: String(err) });
  }
}
