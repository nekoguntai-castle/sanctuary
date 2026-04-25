/**
 * Telegram Notification Service
 *
 * Re-export shim — all functionality has been split into focused domain modules:
 *   - types.ts: Type definitions
 *   - api.ts: Telegram Bot API communication + circuit breaker
 *   - formatting.ts: Message formatting helpers
 *   - notifications.ts: Transaction & draft notification logic
 *   - settings.ts: Per-wallet settings management
 */

export type {
  TelegramConfig,
  TelegramNotificationSummary,
  WalletTelegramSettings,
  TransactionData,
  DraftData,
} from './types';

export { sendTelegramMessage, getChatIdFromBot, testTelegramConfig } from './api';
export { getWalletUsers, formatTransactionMessage, formatDraftMessage, escapeHtml } from './formatting';
export { notifyNewTransactions, notifyNewDraft } from './notifications';
export { updateWalletTelegramSettings, getWalletTelegramSettings } from './settings';
