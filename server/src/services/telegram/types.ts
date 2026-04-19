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
