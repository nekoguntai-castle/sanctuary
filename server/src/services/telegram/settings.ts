/**
 * Telegram Settings
 *
 * Functions for managing per-wallet Telegram notification settings.
 */

import type { Prisma } from '../../generated/prisma/client';
import { userRepository } from '../../repositories';
import { DEFAULT_WALLET_TELEGRAM_SETTINGS } from './types';
import type { TelegramConfig, WalletTelegramSettings } from './types';

type TelegramPreferenceRecord = Partial<TelegramConfig> & Record<string, unknown>;

export type TelegramSettingsPatch = Partial<WalletTelegramSettings>;

function compactNullishPatch(patch: TelegramSettingsPatch): TelegramSettingsPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined && value !== null)
  ) as TelegramSettingsPatch;
}

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
 * Update a user's Telegram settings for a specific wallet.
 *
 * `patch` is applied as `DEFAULT -> stored -> patch` against the wallet
 * record re-read fresh inside `updatePreferencesAtomically`'s transaction on
 * every attempt (including serializable-conflict retries), so two concurrent
 * single-field PATCHes each land on top of the other's committed value
 * instead of one clobbering the other via a stale pre-read.
 */
export async function updateWalletTelegramSettings(
  userId: string,
  walletId: string,
  patch: TelegramSettingsPatch
): Promise<void> {
  await userRepository.updatePreferencesAtomically(userId, (currentPreferences) => {
    const prefs = asRecord(currentPreferences);
    const telegram = asRecord(prefs.telegram) as TelegramPreferenceRecord;
    const stored = getOwnWalletSettings(telegram.wallets as TelegramConfig['wallets'] | undefined, walletId);
    const merged: WalletTelegramSettings = {
      ...DEFAULT_WALLET_TELEGRAM_SETTINGS,
      ...(stored ?? {}),
      ...compactNullishPatch(patch),
    };

    return {
      preferences: {
        ...prefs,
        telegram: {
          ...telegram,
          botToken: typeof telegram.botToken === 'string' ? telegram.botToken : '',
          chatId: typeof telegram.chatId === 'string' ? telegram.chatId : '',
          enabled: typeof telegram.enabled === 'boolean' ? telegram.enabled : false,
          wallets: setWalletSettings(telegram, walletId, merged),
        },
      } as unknown as Prisma.InputJsonValue,
      result: undefined,
    };
  });
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
