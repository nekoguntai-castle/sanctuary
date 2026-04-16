/**
 * Unified Notification Service
 *
 * Central dispatcher for all notification channels using the channel registry.
 * Call this service from blockchain.ts when new transactions are detected.
 *
 * Channels are pluggable - to add new channels (Webhook, Slack, Discord, Email):
 *   1. Create handler implementing NotificationChannelHandler
 *   2. Register in channels/index.ts
 */

import { notificationChannelRegistry, type TransactionNotification, type DraftNotification } from './channels';
import { createLogger } from '../../utils/logger';

const log = createLogger('NOTIFY:SVC');
const DRAFT_NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000;
const DRAFT_NOTIFICATION_DEDUPE_MAX_KEYS = 1_000;
const recentDraftNotificationKeys = new Map<string, number>();

// Re-export types for backward compatibility
export type TransactionData = TransactionNotification;
export type DraftData = DraftNotification;

/**
 * Notify all eligible users about new transactions
 *
 * Dispatches notifications to all registered and enabled channels.
 * Each channel checks its own per-wallet settings independently.
 *
 * @param walletId - The wallet that received/sent transactions
 * @param transactions - Array of new transactions to notify about
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<void> {
  if (transactions.length === 0) return;

  log.debug(`Sending notifications for ${transactions.length} transactions in wallet ${walletId}`);

  // Dispatch to all registered channels via registry
  const results = await notificationChannelRegistry.notifyTransactions(
    walletId,
    transactions as TransactionNotification[]
  );

  // Log results
  for (const result of results) {
    if (!result.success && result.errors?.length) {
      log.error(`${result.channelId} notification failed: ${result.errors.join(', ')}`);
    }
  }
}

/**
 * Notify all eligible users about a new draft transaction
 *
 * Useful for multi-user wallets where one person creates the draft
 * and another needs to sign it with their hardware wallet.
 *
 * @param walletId - The wallet the draft was created for
 * @param draft - The draft transaction data
 * @param createdByUserId - The user who created the draft (won't be notified). Null notifies all users.
 * @param createdByLabel - Optional display label when the creator is not a human user.
 */
export async function notifyNewDraft(
  walletId: string,
  draft: DraftData,
  createdByUserId: string | null,
  createdByLabel?: string
): Promise<void> {
  log.debug(`Sending draft notification for wallet ${walletId}`);

  if (draft.dedupeKey && isRecentDraftNotification(draft.dedupeKey)) {
    log.info('Skipping duplicate draft notification', { walletId, draftId: draft.id, dedupeKey: draft.dedupeKey });
    return;
  }

  // Dispatch to all registered channels that support drafts
  const results = await notificationChannelRegistry.notifyDraft(
    walletId,
    draft as DraftNotification,
    createdByUserId,
    createdByLabel
  );

  // Log results
  for (const result of results) {
    if (!result.success && result.errors?.length) {
      log.error(`${result.channelId} draft notification failed: ${result.errors.join(', ')}`);
    }
  }
}

function isRecentDraftNotification(dedupeKey: string): boolean {
  const now = Date.now();
  pruneRecentDraftNotificationKeys(now);

  const expiresAt = recentDraftNotificationKeys.get(dedupeKey);
  if (expiresAt && expiresAt > now) {
    return true;
  }

  recentDraftNotificationKeys.set(dedupeKey, now + DRAFT_NOTIFICATION_DEDUPE_TTL_MS);
  return false;
}

function pruneRecentDraftNotificationKeys(now: number): void {
  for (const [key, expiresAt] of recentDraftNotificationKeys.entries()) {
    if (expiresAt <= now) {
      recentDraftNotificationKeys.delete(key);
    }
  }

  while (recentDraftNotificationKeys.size >= DRAFT_NOTIFICATION_DEDUPE_MAX_KEYS) {
    const oldestKey = recentDraftNotificationKeys.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    recentDraftNotificationKeys.delete(oldestKey);
  }
}

/**
 * Get list of available notification channels
 */
export function getAvailableChannels() {
  return notificationChannelRegistry.getAll().map((handler) => ({
    id: handler.id,
    name: handler.name,
    description: handler.description,
    capabilities: handler.capabilities,
  }));
}
