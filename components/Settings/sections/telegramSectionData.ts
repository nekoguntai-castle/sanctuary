import type { TelegramConfig, User } from '../../../types';

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

export function buildTelegramPreferences({
  botToken,
  chatId,
  enabled,
  user,
}: {
  botToken: string;
  chatId: string;
  enabled: boolean;
  user: User | null;
}): { telegram: TelegramConfig } {
  return {
    telegram: {
      botToken,
      chatId,
      enabled,
      wallets: getTelegramWallets(user),
    },
  };
}

export function getTelegramWallets(user: User | null): TelegramConfig['wallets'] {
  return user?.preferences?.telegram?.wallets || {};
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
