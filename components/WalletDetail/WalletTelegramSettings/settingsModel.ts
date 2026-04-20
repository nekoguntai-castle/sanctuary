import { ApiError } from '../../../src/api/client';
import type { User, WalletTelegramSettings as WalletTelegramSettingsType } from '../../../types';
import type { NotificationToggleOption, TelegramAvailability } from './types';

export const DEFAULT_WALLET_TELEGRAM_SETTINGS: WalletTelegramSettingsType = {
  enabled: false,
  notifyReceived: true,
  notifySent: true,
  notifyConsolidation: true,
  notifyDraft: true,
};

export const NOTIFICATION_TOGGLE_OPTIONS: NotificationToggleOption[] = [
  { field: 'notifyReceived', label: 'Bitcoin received' },
  { field: 'notifySent', label: 'Bitcoin sent' },
  { field: 'notifyConsolidation', label: 'Consolidation transactions' },
  { field: 'notifyDraft', label: 'Draft transactions (awaiting signature)' },
];

export function getTelegramAvailability(user: User | null): TelegramAvailability {
  const telegram = user?.preferences?.telegram;

  if (!telegram?.botToken || !telegram.chatId) {
    return 'not-configured';
  }

  return telegram.enabled ? 'available' : 'disabled';
}

export function getWalletTelegramSaveErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Failed to update settings';
}
