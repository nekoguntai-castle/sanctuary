/**
 * Telegram Service Types
 *
 * Shared type definitions for the Telegram notification service.
 */

import type {
  NotificationFailureClass,
  NotificationOutcome,
} from '../notifications/outcomes';

/** Shape of a Telegram Bot API error response */
export interface TelegramErrorResponse {
  ok: false;
  error_code: number;
  description: string;
}

/** Shape of a Telegram Bot API getUpdates success response */
export interface TelegramGetUpdatesResponse {
  ok: true;
  result: TelegramUpdate[];
}

export interface TelegramChat {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat };
}

export interface TelegramNotificationSummary {
  usersNotified: number;
  attempted: number;
  errors: string[];
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
}

/**
 * Result of a `notifyNewDraft` call. Mirrors
 * `pushService.NotifyTransactionsResult` (#1137): a wallet/user lookup
 * failure (or any other throw before delivery is known) is reported as
 * `success: false` with the error message instead of being logged and
 * swallowed, so callers can distinguish "nothing to notify" from
 * "notification delivery was not attempted or was not confirmed." Zero
 * eligible recipients is `success: true, usersNotified: 0` -- there was
 * nothing to fail. `recorded` mirrors the push channel's opt-out flag for
 * `recordChannelDeliveryFailures`; the Telegram path never self-records a
 * delivery failure, so it is always `false` when `success` is `false`.
 */
export interface TelegramDraftNotificationResult {
  success: boolean;
  usersNotified: number;
  error?: string;
  recorded?: boolean;
}

export interface TelegramTransportResult {
  success: boolean;
  outcome: Extract<NotificationOutcome, 'accepted' | 'rejected' | 'ambiguous'>;
  failureClass: NotificationFailureClass;
  retryable: boolean;
  acknowledgement: 'accepted' | 'not_accepted' | 'unknown';
  /** Compatibility-only operational detail. Never persist or export this field. */
  error?: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
  notifyDraft: boolean;
}

export interface TransactionData {
  txid: string;
  type: string;
  amount: bigint;
  feeSats?: bigint | null;
  agentId?: string | null;
  agentName?: string | null;
  agentOperationalSpend?: boolean;
  agentDestinationClassification?: string | null;
  agentUnknownDestinationHandlingMode?: string | null;
}

export interface DraftData {
  id: string;
  amount: bigint;
  recipient: string;
  label?: string | null;
  feeRate: number;
  agentId?: string | null;
  agentName?: string | null;
  agentOperationalWalletId?: string | null;
  agentOperationalWalletName?: string | null;
  agentSigned?: boolean;
  dedupeKey?: string;
}
