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

// Register handlers
notificationChannelRegistry.register(telegramChannelHandler);
notificationChannelRegistry.register(pushChannelHandler);

// Export the registry and types
export { notificationChannelRegistry } from './registry';
export type {
  NotificationChannelHandler,
  TransactionNotification,
  DraftNotification,
  ConsolidationSuggestionNotification,
  NotificationResult,
  ChannelCapabilities,
} from './types';

// Export individual handlers for direct use if needed
export { telegramChannelHandler } from './telegram';
export { pushChannelHandler } from './push';
