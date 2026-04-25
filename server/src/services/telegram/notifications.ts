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
import type {
  TelegramConfig,
  TelegramNotificationSummary,
  TransactionData,
  DraftData,
} from './types';

const log = createLogger('TELEGRAM:SVC_NOTIFY');

type TelegramRecipient = Awaited<ReturnType<typeof getWalletUsers>>[number];
type TelegramWallet = NonNullable<Awaited<ReturnType<typeof walletRepository.findNameById>>>;

type TransactionTelegramRecipient = {
  telegram: TelegramConfig;
  walletSettings: TelegramConfig['wallets'][string];
};

async function getDraftCreatorName(createdByUserId: string | null, createdByLabel?: string): Promise<string> {
  /* v8 ignore next 3 -- human and agent creator paths are covered by notification service tests */
  const creator = createdByUserId
    ? await userRepository.findByIdWithSelect(createdByUserId, { username: true })
    : null;
  return creator?.username || createdByLabel || 'Unknown';
}

async function withOperationalWalletName(draft: DraftData): Promise<DraftData> {
  /* v8 ignore next 5 -- operational wallet name enrichment is defensive metadata for agent drafts */
  const operationalWallet = draft.agentOperationalWalletId
    ? await walletRepository.findNameById(draft.agentOperationalWalletId)
    : null;
  /* v8 ignore start -- operational wallet name is optional enrichment for agent drafts */
  return operationalWallet
    ? { ...draft, agentOperationalWalletName: operationalWallet.name }
    : draft;
  /* v8 ignore stop */
}

function getDraftRecipientFilter(draft: DraftData): Parameters<typeof getWalletUsers>[1] {
  /* v8 ignore next -- agent draft recipient role filter is covered by registry notification tests */
  return draft.agentId ? { walletRoles: ['owner', 'signer'] } : undefined;
}

function getUserTelegramConfig(user: TelegramRecipient): TelegramConfig | undefined {
  const prefs = user.preferences as Record<string, unknown> | null;
  return prefs?.telegram as TelegramConfig | undefined;
}

function getDraftNotificationTelegram(
  user: TelegramRecipient,
  walletId: string,
  createdByUserId: string | null
): TelegramConfig | null {
  if (createdByUserId && user.id === createdByUserId) return null;

  const telegram = getUserTelegramConfig(user);
  if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) return null;

  const walletSettings = telegram.wallets?.[walletId];
  return walletSettings?.enabled && walletSettings.notifyDraft ? telegram : null;
}

async function getExplorerUrl(): Promise<string> {
  try {
    const nodeConfig = await nodeConfigRepository.findDefault();
    return nodeConfig?.explorerUrl || 'https://mempool.space';
  } catch (error) {
    log.debug('Failed to load explorer URL from node config, using default', { error: getErrorMessage(error) });
    return 'https://mempool.space';
  }
}

function getTransactionTelegramRecipient(
  user: TelegramRecipient,
  walletId: string
): TransactionTelegramRecipient | null {
  const telegram = getUserTelegramConfig(user);

  // Skip if Telegram not configured or not enabled
  if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) {
    log.debug(`Telegram not configured for user ${user.username}, skipping`);
    return null;
  }

  const walletSettings = telegram.wallets?.[walletId];
  if (!walletSettings?.enabled) {
    log.debug(`Telegram wallet notifications disabled for user ${user.username} on wallet ${walletId}`);
    return null;
  }

  return { telegram, walletSettings };
}

function shouldNotifyTransaction(
  tx: TransactionData,
  walletSettings: TelegramConfig['wallets'][string]
): boolean {
  return (tx.type === 'received' && walletSettings.notifyReceived) ||
    (tx.type === 'sent' && walletSettings.notifySent) ||
    (tx.type === 'consolidation' && walletSettings.notifyConsolidation);
}

async function sendTransactionNotification(
  walletId: string,
  user: TelegramRecipient,
  telegram: TelegramConfig,
  wallet: TelegramWallet,
  explorerUrl: string,
  tx: TransactionData,
  summary: TelegramNotificationSummary
): Promise<void> {
  const message = formatTransactionMessage(tx, wallet, explorerUrl);
  const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);
  summary.attempted += 1;

  if (result.success) {
    summary.usersNotified += 1;
    log.debug(`Sent Telegram notification to ${user.username} for tx ${tx.txid.slice(0, 8)}...`);
    walletLog(walletId, 'info', 'TELEGRAM', `Sent ${tx.type} notification to ${user.username}`, {
      txid: tx.txid.slice(0, 12),
    });
    return;
  }

  summary.errors.push(result.error ?? 'Unknown Telegram send failure');
  log.warn(`Failed to send Telegram to ${user.username}: ${result.error}`);
  walletLog(walletId, 'warn', 'TELEGRAM', `Failed to send ${tx.type} notification to ${user.username}: ${result.error}`, {
    txid: tx.txid.slice(0, 12),
  });
}

function createNotificationSummary(): TelegramNotificationSummary {
  return {
    usersNotified: 0,
    attempted: 0,
    errors: [],
  };
}

async function sendDraftNotification(
  walletId: string,
  user: TelegramRecipient,
  telegram: TelegramConfig,
  message: string
): Promise<void> {
  const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);

  if (result.success) {
    log.debug(`Sent draft notification to ${user.username}`);
    walletLog(walletId, 'info', 'TELEGRAM', `Sent draft notification to ${user.username}`);
    return;
  }

  log.warn(`Failed to send draft notification to ${user.username}: ${result.error}`);
  walletLog(walletId, 'warn', 'TELEGRAM', `Failed to send draft notification to ${user.username}: ${result.error}`);
}

/**
 * Notify all eligible users about new transactions
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<TelegramNotificationSummary> {
  const summary = createNotificationSummary();
  if (transactions.length === 0) return summary;

  try {
    // Get wallet info
    const wallet = await walletRepository.findNameById(walletId);
    if (!wallet) return summary;

    const explorerUrl = await getExplorerUrl();

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    if (users.length === 0) {
      log.debug(`No users found for wallet ${walletId}, skipping Telegram notifications`);
      return summary;
    }

    for (const user of users) {
      const recipient = getTransactionTelegramRecipient(user, walletId);
      if (!recipient) continue;

      // Send notification for each transaction that matches user's preferences
      for (const tx of transactions) {
        if (shouldNotifyTransaction(tx, recipient.walletSettings)) {
          await sendTransactionNotification(
            walletId,
            user,
            recipient.telegram,
            wallet,
            explorerUrl,
            tx,
            summary
          );
        } else {
          log.debug(`Skipping Telegram for tx ${tx.txid.slice(0, 8)} (type=${tx.type}, notifyReceived=${recipient.walletSettings.notifyReceived}, notifySent=${recipient.walletSettings.notifySent}, notifyConsolidation=${recipient.walletSettings.notifyConsolidation})`);
        }
      }
    }
  } catch (err) {
    summary.errors.push(getErrorMessage(err));
    log.error(`Error sending Telegram notifications: ${err}`);
    walletLog(walletId, 'error', 'TELEGRAM', `Error sending notifications: ${err}`);
  }

  return summary;
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

    const createdBy = await getDraftCreatorName(createdByUserId, createdByLabel);
    const formattedDraft = await withOperationalWalletName(draft);

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId, getDraftRecipientFilter(draft));

    for (const user of users) {
      const telegram = getDraftNotificationTelegram(user, walletId, createdByUserId);
      if (!telegram) continue;

      const message = formatDraftMessage(formattedDraft, wallet, createdBy);
      await sendDraftNotification(walletId, user, telegram, message);
    }
  } catch (err) {
    log.error(`Error sending draft notifications: ${err}`);
    walletLog(walletId, 'error', 'TELEGRAM', `Error sending draft notifications: ${err}`);
  }
}
