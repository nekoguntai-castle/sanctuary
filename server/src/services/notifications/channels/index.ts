/**
 * Notification Channel Registry
 *
 * Central registry for notification channels.
 *
 * Usage:
 *   import { notificationChannelRegistry } from './channels';
 *
 *   // Dispatch to all channels
 *   await notificationChannelRegistry.notifyTransactions(walletId, transactions);
 *
 * Adding new channels:
 *   1. Create handler implementing NotificationChannelHandler
 *   2. Import and register below
 */

import { notificationChannelRegistry } from './registry';

// Import handlers
import { telegramChannelHandler } from './telegram';
import { pushChannelHandler } from './push';
import { aiInsightsChannelHandler } from './aiInsights';
import { webhookChannelHandler } from './webhook';

// Register handlers
notificationChannelRegistry.register(telegramChannelHandler);
notificationChannelRegistry.register(pushChannelHandler);
notificationChannelRegistry.register(aiInsightsChannelHandler);
notificationChannelRegistry.register(webhookChannelHandler);

// Export the registry and types
export { notificationChannelRegistry } from './registry';
export type {
  NotificationChannelHandler,
  TransactionNotification,
  DraftNotification,
  ConsolidationSuggestionNotification,
  AIInsightNotification,
  NotificationResult,
  NotificationDispatchContext,
  ChannelCapabilities,
} from './types';
export type {
  NotificationFailureClass,
  NotificationOutcome,
  SafeChannelOutcome,
  SafeNotificationOutcome,
} from '../outcomes';
export { summarizeSafeNotificationOutcome, toSafeChannelOutcome } from '../outcomes';

// Export individual handlers for direct use if needed
export { telegramChannelHandler } from './telegram';
export { pushChannelHandler } from './push';
export { aiInsightsChannelHandler } from './aiInsights';
export { webhookChannelHandler } from './webhook';
