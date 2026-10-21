import type { TelegramConfig } from '../../../types';

type TelegramGlobalSettings = Pick<TelegramConfig, 'botToken' | 'chatId' | 'enabled'>;

export interface TelegramTestResult {
  success: boolean;
  message: string;
}

export interface TelegramConfigTestResponse {
  success: boolean;
  error?: string;
}

export interface TelegramChatIdResponse {
  success: boolean;
  chatId?: string;
  username?: string;
  error?: string;
}

/**
 * The global Telegram save never sends `wallets`: the server merges `telegram`
 * one level deep, so per-wallet settings written since login are preserved
 * instead of being replaced by the login-time copy.
 */
export function buildTelegramPreferences({
  botToken,
  chatId,
  enabled,
}: TelegramGlobalSettings): { telegram: TelegramGlobalSettings } {
  return { telegram: { botToken, chatId, enabled } };
}

export function telegramTestResultMessage(result: TelegramConfigTestResponse): TelegramTestResult {
  if (result.success) {
    return { success: true, message: 'Test message sent successfully!' };
  }

  return {
    success: false,
    message: result.error || 'Failed to send test message',
  };
}

export function telegramChatIdResultMessage(result: TelegramChatIdResponse): TelegramTestResult {
  if (result.success && result.chatId) {
    return {
      success: true,
      message: `Chat ID found${telegramUsernameSuffix(result.username)}!`,
    };
  }

  return {
    success: false,
    message: result.error || 'Failed to fetch chat ID',
  };
}

function telegramUsernameSuffix(username?: string): string {
  return username ? ` (@${username})` : '';
}
