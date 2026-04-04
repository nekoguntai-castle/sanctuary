/**
 * Notification Channel Registry
 *
 * Central registry for notification channel handlers.
 * Allows registration of new channels (Telegram, Push, Webhook, Slack, etc.)
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type {
  NotificationChannelHandler,
  TransactionNotification,
  DraftNotification,
  AIInsightNotification,
  NotificationResult,
} from './types';

const log = createLogger('NOTIFY:SVC_REGISTRY');

/**
 * Notification Channel Registry
 *
 * Manages registration and dispatching to notification channels.
 */
class NotificationChannelRegistry {
  private handlers: Map<string, NotificationChannelHandler> = new Map();

  /**
   * Register a new notification channel handler
   */
  register(handler: NotificationChannelHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Notification channel '${handler.id}' is already registered`);
    }

    this.handlers.set(handler.id, handler);
    log.debug('Registered notification channel', {
      id: handler.id,
      name: handler.name,
      capabilities: handler.capabilities,
    });
  }

  /**
   * Unregister a channel by ID
   */
  unregister(id: string): boolean {
    return this.handlers.delete(id);
  }

  /**
   * Get a handler by ID
   */
  get(id: string): NotificationChannelHandler | undefined {
    return this.handlers.get(id);
  }

  /**
   * Get all registered handlers
   */
  getAll(): NotificationChannelHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * Get all channel IDs
   */
  getIds(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if a channel is registered
   */
  has(id: string): boolean {
    return this.handlers.has(id);
  }

  /**
   * Get channels that support transaction notifications
   */
  getTransactionCapable(): NotificationChannelHandler[] {
    return this.getAll().filter((h) => h.capabilities.supportsTransactions);
  }

  /**
   * Get channels that support draft notifications
   */
  getDraftCapable(): NotificationChannelHandler[] {
    return this.getAll().filter((h) => h.capabilities.supportsDrafts && h.notifyDraft);
  }

  /**
   * Dispatch transaction notifications to all enabled channels
   */
  async notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[]
  ): Promise<NotificationResult[]> {
    if (transactions.length === 0) return [];

    const handlers = this.getTransactionCapable();
    const results: NotificationResult[] = [];

    // Dispatch to all channels in parallel
    const promises = handlers.map(async (handler) => {
      try {
        const isEnabled = await handler.isEnabled();
        if (!isEnabled) {
          return {
            success: true,
            channelId: handler.id,
            usersNotified: 0,
          };
        }

        return await handler.notifyTransactions(walletId, transactions);
      } catch (err) {
        log.error(`Channel ${handler.id} notification failed`, { error: err });
        return {
          success: false,
          channelId: handler.id,
          usersNotified: 0,
          errors: [getErrorMessage(err)],
        };
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          channelId: 'unknown',
          usersNotified: 0,
          errors: [result.reason?.message || 'Unknown error'],
        });
      }
    }

    return results;
  }

  /**
   * Dispatch draft notification to all enabled channels
   */
  async notifyDraft(
    walletId: string,
    draft: DraftNotification,
    createdByUserId: string
  ): Promise<NotificationResult[]> {
    const handlers = this.getDraftCapable();
    const results: NotificationResult[] = [];

    const promises = handlers.map(async (handler) => {
      try {
        const isEnabled = await handler.isEnabled();
        if (!isEnabled || !handler.notifyDraft) {
          return {
            success: true,
            channelId: handler.id,
            usersNotified: 0,
          };
        }

        return await handler.notifyDraft(walletId, draft, createdByUserId);
      } catch (err) {
        log.error(`Channel ${handler.id} draft notification failed`, { error: err });
        return {
          success: false,
          channelId: handler.id,
          usersNotified: 0,
          errors: [getErrorMessage(err)],
        };
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          channelId: 'unknown',
          usersNotified: 0,
          errors: [result.reason?.message || 'Unknown error'],
        });
      }
    }

    return results;
  }

  /**
   * Get channels that support AI insight notifications
   */
  getInsightCapable(): NotificationChannelHandler[] {
    return this.getAll().filter((h) => h.capabilities.supportsAIInsights && h.notifyAIInsight);
  }

  /**
   * Dispatch AI insight notification to all enabled channels
   */
  async notifyInsight(
    walletId: string,
    insight: AIInsightNotification
  ): Promise<NotificationResult[]> {
    const handlers = this.getInsightCapable();
    const results: NotificationResult[] = [];

    const promises = handlers.map(async (handler) => {
      try {
        const isEnabled = await handler.isEnabled();
        if (!isEnabled || !handler.notifyAIInsight) {
          return {
            success: true,
            channelId: handler.id,
            usersNotified: 0,
          };
        }

        return await handler.notifyAIInsight(walletId, insight);
      } catch (err) {
        log.error(`Channel ${handler.id} insight notification failed`, { error: err });
        return {
          success: false,
          channelId: handler.id,
          usersNotified: 0,
          errors: [getErrorMessage(err)],
        };
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          channelId: 'unknown',
          usersNotified: 0,
          errors: [result.reason?.message || 'Unknown error'],
        });
      }
    }

    return results;
  }

  /**
   * Get handler count
   */
  get count(): number {
    return this.handlers.size;
  }
}

// Singleton instance
export const notificationChannelRegistry = new NotificationChannelRegistry();

// Also export class for testing
export { NotificationChannelRegistry };
