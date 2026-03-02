/**
 * Telegram Service Types
 *
 * Shared type definitions for the Telegram notification service.
 */

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
}

export interface DraftData {
  id: string;
  amount: bigint;
  recipient: string;
  label?: string | null;
  feeRate: number;
}
