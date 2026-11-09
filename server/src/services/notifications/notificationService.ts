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

import {
  notificationChannelRegistry,
  type DraftNotification,
  type NotificationResult,
  type TransactionNotification,
} from './channels';
import { DRAFT_NOTIFICATION_DEDUPE_TTL_MS } from '../../constants/notifications';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { randomUUID } from 'node:crypto';
import { getRedisClient, isRedisConnected } from '../../infrastructure/redis';

const log = createLogger('NOTIFY:SVC');
const DRAFT_NOTIFICATION_DEDUPE_REDIS_PREFIX = 'notifications:draft-dedupe:';
const RELEASE_OWN_CLAIM_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;
/** Fallback when Redis is unavailable; bounded per process. */
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
): Promise<NotificationResult[]> {
  if (transactions.length === 0) return [];

  log.debug(`Sending notifications for ${transactions.length} transactions in wallet ${walletId}`);

  // Dispatch to all registered channels via registry
  const results = await notificationChannelRegistry.notifyTransactions(
    walletId,
    transactions as TransactionNotification[],
    { executionPath: 'inline' },
  );

  // Log results
  for (const result of results) {
    if (!result.success && result.errors?.length) {
      log.error(`${result.channelId} notification failed: ${result.errors.join(', ')}`);
    }
  }

  return results;
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

  const claim = draft.dedupeKey ? await claimDraftNotification(draft.dedupeKey) : null;
  if (claim === 'duplicate') {
    log.info('Skipping duplicate draft notification', { walletId, draftId: draft.id, dedupeKey: draft.dedupeKey });
    return;
  }

  // Dispatch to all registered channels that support drafts
  let results: NotificationResult[];
  try {
    results = await notificationChannelRegistry.notifyDraft(
      walletId,
      draft as DraftNotification,
      createdByUserId,
      createdByLabel
    );
  } catch (error) {
    if (claim) await claim.release();
    throw error;
  }

  // Nothing was delivered: let a retry through instead of suppressing it for the TTL.
  if (claim && results.length > 0 && results.every(result => !result.success)) {
    await claim.release();
  }

  // Log results
  for (const result of results) {
    if (!result.success && result.errors?.length) {
      log.error(`${result.channelId} draft notification failed: ${result.errors.join(', ')}`);
    }
  }
}

interface DraftNotificationClaim {
  release: () => Promise<void>;
}

/**
 * Claim a dedupe key for the TTL. Shared through Redis so the same draft
 * reaching different processes notifies once; falls back to this process's
 * memory when Redis is absent or failing.
 */
async function claimDraftNotification(
  dedupeKey: string,
): Promise<DraftNotificationClaim | 'duplicate'> {
  const redis = getRedisClient();
  if (redis && isRedisConnected()) {
    const key = `${DRAFT_NOTIFICATION_DEDUPE_REDIS_PREFIX}${dedupeKey}`;
    const token = randomUUID();
    try {
      const claimed = await redis.set(key, token, 'PX', DRAFT_NOTIFICATION_DEDUPE_TTL_MS, 'NX');
      if (claimed === null) return 'duplicate';
      return {
        release: async () => {
          try {
            // Only our own claim: after a TTL expiry another process may hold the key.
            await redis.eval(RELEASE_OWN_CLAIM_SCRIPT, 1, key, token);
          } catch (error) {
            log.warn('Could not release draft notification dedupe key', { error: getErrorMessage(error) });
          }
        },
      };
    } catch (error) {
      log.warn('Shared draft notification dedupe unavailable; using process memory', {
        error: getErrorMessage(error),
      });
    }
  }

  if (isRecentDraftNotification(dedupeKey)) return 'duplicate';
  return {
    release: async () => {
      recentDraftNotificationKeys.delete(dedupeKey);
    },
  };
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
    /* v8 ignore next -- Map cannot be at or above max size and have no first key */
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
