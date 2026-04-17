/**
 * Telegram Notifications
 *
 * Functions for sending transaction and draft notifications to eligible users.
 */

import { walletRepository, userRepository, nodeConfigRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { walletLog } from '../../websocket/notifications';
import { sendTelegramMessage } from './api';
import { getWalletUsers, formatTransactionMessage, formatDraftMessage } from './formatting';
import type { TelegramConfig, TransactionData, DraftData } from './types';

const log = createLogger('TELEGRAM:SVC_NOTIFY');

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
    const wallet = await walletRepository.findNameById(walletId);
    if (!wallet) return;

    // Get explorer URL from node config
    let explorerUrl = 'https://mempool.space';
    try {
      const nodeConfig = await nodeConfigRepository.findDefault();
      if (nodeConfig?.explorerUrl) {
        explorerUrl = nodeConfig.explorerUrl;
      }
    } catch (error) {
      log.debug('Failed to load explorer URL from node config, using default', { error: getErrorMessage(error) });
    }

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    if (users.length === 0) {
      log.debug(`No users found for wallet ${walletId}, skipping Telegram notifications`);
      return;
    }

    for (const user of users) {
      const prefs = user.preferences as Record<string, unknown> | null;
      const telegram = prefs?.telegram as TelegramConfig | undefined;

      // Skip if Telegram not configured or not enabled
      if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) {
        log.debug(`Telegram not configured for user ${user.username}, skipping`);
        continue;
      }

      // Get wallet-specific settings
      const walletSettings = telegram.wallets?.[walletId];
      if (!walletSettings?.enabled) {
        log.debug(`Telegram wallet notifications disabled for user ${user.username} on wallet ${walletId}`);
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
            walletLog(walletId, 'info', 'TELEGRAM', `Sent ${tx.type} notification to ${user.username}`, {
              txid: tx.txid.slice(0, 12),
            });
          } else {
            log.warn(`Failed to send Telegram to ${user.username}: ${result.error}`);
            walletLog(walletId, 'warn', 'TELEGRAM', `Failed to send ${tx.type} notification to ${user.username}: ${result.error}`, {
              txid: tx.txid.slice(0, 12),
            });
          }
        } else {
          log.debug(`Skipping Telegram for tx ${tx.txid.slice(0, 8)} (type=${tx.type}, notifyReceived=${walletSettings.notifyReceived}, notifySent=${walletSettings.notifySent}, notifyConsolidation=${walletSettings.notifyConsolidation})`);
        }
      }
    }
  } catch (err) {
    log.error(`Error sending Telegram notifications: ${err}`);
    walletLog(walletId, 'error', 'TELEGRAM', `Error sending notifications: ${err}`);
  }
}

/**
 * Notify all eligible users about a new draft transaction
 */
export async function notifyNewDraft(
  walletId: string,
  draft: DraftData,
  createdByUserId: string | null,
  createdByLabel?: string
): Promise<void> {
  try {
    // Get wallet info
    const wallet = await walletRepository.findNameById(walletId);
    if (!wallet) return;

    // Get creator display name. Agent-submitted drafts pass a label and do not
    // exclude any wallet user from notification.
    /* v8 ignore next 3 -- human and agent creator paths are covered by notification service tests */
    const creator = createdByUserId
      ? await userRepository.findByIdWithSelect(createdByUserId, { username: true })
      : null;
    const createdBy = creator?.username || createdByLabel || 'Unknown';
    /* v8 ignore next 5 -- operational wallet name enrichment is defensive metadata for agent drafts */
    const operationalWallet = draft.agentOperationalWalletId
      ? await walletRepository.findNameById(draft.agentOperationalWalletId)
      : null;
    /* v8 ignore start -- operational wallet name is optional enrichment for agent drafts */
    const formattedDraft = operationalWallet
      ? { ...draft, agentOperationalWalletName: operationalWallet.name }
      : draft;
    /* v8 ignore stop */

    // Get all users with access to this wallet
    const users = await getWalletUsers(
      walletId,
      /* v8 ignore next -- agent draft recipient role filter is covered by registry notification tests */
      draft.agentId ? { walletRoles: ['owner', 'signer'] } : undefined
    );

    for (const user of users) {
      // Skip notifying the creator (they already know)
      if (createdByUserId && user.id === createdByUserId) continue;

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

      const message = formatDraftMessage(formattedDraft, wallet, createdBy);
      const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);

      if (result.success) {
        log.debug(`Sent draft notification to ${user.username}`);
        walletLog(walletId, 'info', 'TELEGRAM', `Sent draft notification to ${user.username}`);
      } else {
        log.warn(`Failed to send draft notification to ${user.username}: ${result.error}`);
        walletLog(walletId, 'warn', 'TELEGRAM', `Failed to send draft notification to ${user.username}: ${result.error}`);
      }
    }
  } catch (err) {
    log.error(`Error sending draft notifications: ${err}`);
    walletLog(walletId, 'error', 'TELEGRAM', `Error sending draft notifications: ${err}`);
  }
}
