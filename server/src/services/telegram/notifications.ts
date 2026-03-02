/**
 * Telegram Notifications
 *
 * Functions for sending transaction and draft notifications to eligible users.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { sendTelegramMessage } from './api';
import { getWalletUsers, formatTransactionMessage, formatDraftMessage } from './formatting';
import type { TelegramConfig, TransactionData, DraftData } from './types';

const log = createLogger('TELEGRAM');

/**
 * Notify all eligible users about new transactions
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<void> {
  if (transactions.length === 0) return;

  try {
    // Get wallet info
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, name: true },
    });
    if (!wallet) return;

    // Get explorer URL from node config
    let explorerUrl = 'https://mempool.space';
    try {
      const nodeConfig = await prisma.nodeConfig.findFirst();
      if (nodeConfig?.explorerUrl) {
        explorerUrl = nodeConfig.explorerUrl;
      }
    } catch {
      // Use default
    }

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    for (const user of users) {
      const prefs = user.preferences as Record<string, unknown> | null;
      const telegram = prefs?.telegram as TelegramConfig | undefined;

      // Skip if Telegram not configured or not enabled
      if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) {
        continue;
      }

      // Get wallet-specific settings
      const walletSettings = telegram.wallets?.[walletId];
      if (!walletSettings?.enabled) {
        continue;
      }

      // Send notification for each transaction that matches user's preferences
      for (const tx of transactions) {
        const shouldNotify =
          (tx.type === 'received' && walletSettings.notifyReceived) ||
          (tx.type === 'sent' && walletSettings.notifySent) ||
          (tx.type === 'consolidation' && walletSettings.notifyConsolidation);

        if (shouldNotify) {
          const message = formatTransactionMessage(tx, wallet, explorerUrl);
          const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);

          if (result.success) {
            log.debug(`Sent Telegram notification to ${user.username} for tx ${tx.txid.slice(0, 8)}...`);
          } else {
            log.warn(`Failed to send Telegram to ${user.username}: ${result.error}`);
          }
        }
      }
    }
  } catch (err) {
    log.error(`Error sending Telegram notifications: ${err}`);
  }
}

/**
 * Notify all eligible users about a new draft transaction
 */
export async function notifyNewDraft(
  walletId: string,
  draft: DraftData,
  createdByUserId: string
): Promise<void> {
  try {
    // Get wallet info
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, name: true },
    });
    if (!wallet) return;

    // Get creator's username
    const creator = await prisma.user.findUnique({
      where: { id: createdByUserId },
      select: { username: true },
    });
    const createdBy = creator?.username || 'Unknown';

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    for (const user of users) {
      // Skip notifying the creator (they already know)
      if (user.id === createdByUserId) continue;

      const prefs = user.preferences as Record<string, unknown> | null;
      const telegram = prefs?.telegram as TelegramConfig | undefined;

      // Skip if Telegram not configured or not enabled
      if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) {
        continue;
      }

      // Get wallet-specific settings
      const walletSettings = telegram.wallets?.[walletId];
      if (!walletSettings?.enabled || !walletSettings?.notifyDraft) {
        continue;
      }

      const message = formatDraftMessage(draft, wallet, createdBy);
      const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);

      if (result.success) {
        log.debug(`Sent draft notification to ${user.username}`);
      } else {
        log.warn(`Failed to send draft notification to ${user.username}: ${result.error}`);
      }
    }
  } catch (err) {
    log.error(`Error sending draft notifications: ${err}`);
  }
}
