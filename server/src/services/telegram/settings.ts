/**
 * Telegram Settings
 *
 * Functions for managing per-wallet Telegram notification settings.
 */

import type { Prisma } from '../../generated/prisma/client';
import { userRepository } from '../../repositories';
import type { TelegramConfig, WalletTelegramSettings } from './types';

type TelegramPreferenceRecord = Partial<TelegramConfig> & Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getOwnWalletSettings(
  wallets: TelegramConfig['wallets'] | undefined,
  walletId: string,
): WalletTelegramSettings | null {
  const descriptor = wallets
    ? Object.getOwnPropertyDescriptor(wallets, walletId)
    : undefined;
  return descriptor ? descriptor.value as WalletTelegramSettings : null;
}

function setWalletSettings(
  telegram: TelegramPreferenceRecord,
  walletId: string,
  settings: WalletTelegramSettings,
): TelegramConfig['wallets'] {
  return Object.fromEntries([
    ...Object.entries(asRecord(telegram.wallets)),
    [walletId, settings],
  ]) as TelegramConfig['wallets'];
}

/**
 * Update a user's Telegram settings for a specific wallet
 */
export async function updateWalletTelegramSettings(
  userId: string,
  walletId: string,
  settings: WalletTelegramSettings
): Promise<void> {
  const user = await userRepository.findByIdWithSelect(userId, { preferences: true });

  if (!user) {
    throw new Error('User not found');
  }

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const telegram = asRecord(prefs.telegram) as TelegramPreferenceRecord;

  // Save updated preferences
  const updatedPrefs = {
    ...prefs,
    telegram: {
      ...telegram,
      botToken: typeof telegram.botToken === 'string' ? telegram.botToken : '',
      chatId: typeof telegram.chatId === 'string' ? telegram.chatId : '',
      enabled: typeof telegram.enabled === 'boolean' ? telegram.enabled : false,
      wallets: setWalletSettings(telegram, walletId, settings),
    },
  };

  await userRepository.updatePreferences(userId, updatedPrefs as unknown as Prisma.InputJsonValue);
}

/**
 * Get a user's Telegram settings for a specific wallet
 */
export async function getWalletTelegramSettings(
  userId: string,
  walletId: string
): Promise<WalletTelegramSettings | null> {
  const user = await userRepository.findByIdWithSelect(userId, { preferences: true });

  if (!user) return null;

  const prefs = user.preferences as Record<string, unknown> | null;
  const telegram = prefs?.telegram as TelegramConfig | undefined;

  return getOwnWalletSettings(telegram?.wallets, walletId);
}
