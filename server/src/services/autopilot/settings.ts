/**
 * Treasury Autopilot Settings
 *
 * Per-wallet autopilot settings CRUD, stored in user.preferences.autopilot.
 * Follows the same pattern as telegram/settings.ts.
 */

import type { Prisma } from '../../generated/prisma/client';
import { userRepository } from '../../repositories';
import type { WalletAutopilotSettings, AutopilotConfig } from './types';
import { DEFAULT_AUTOPILOT_SETTINGS } from './types';

type AutopilotPreferenceRecord = Partial<AutopilotConfig> & Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getOwnWalletSettings(
  wallets: AutopilotConfig['wallets'] | undefined,
  walletId: string,
): WalletAutopilotSettings | null {
  const descriptor = wallets
    ? Object.getOwnPropertyDescriptor(wallets, walletId)
    : undefined;
  return descriptor ? descriptor.value as WalletAutopilotSettings : null;
}

function setWalletSettings(
  autopilot: AutopilotPreferenceRecord,
  walletId: string,
  settings: WalletAutopilotSettings,
): AutopilotConfig['wallets'] {
  return Object.fromEntries([
    ...Object.entries(asRecord(autopilot.wallets)),
    [walletId, settings],
  ]) as AutopilotConfig['wallets'];
}

/**
 * Get a user's autopilot settings for a specific wallet
 */
export async function getWalletAutopilotSettings(
  userId: string,
  walletId: string
): Promise<WalletAutopilotSettings | null> {
  const user = await userRepository.findByIdWithSelect(userId, { preferences: true });

  if (!user) return null;

  const prefs = user.preferences as Record<string, unknown> | null;
  const autopilot = prefs?.autopilot as AutopilotConfig | undefined;

  return getOwnWalletSettings(autopilot?.wallets, walletId);
}

/**
 * Update a user's autopilot settings for a specific wallet
 */
export async function updateWalletAutopilotSettings(
  userId: string,
  walletId: string,
  settings: WalletAutopilotSettings
): Promise<void> {
  await userRepository.updatePreferencesAtomically(userId, (currentPreferences) => {
    const prefs = asRecord(currentPreferences);
    const autopilot = asRecord(prefs.autopilot) as AutopilotPreferenceRecord;

    return {
      preferences: {
        ...prefs,
        autopilot: {
          ...autopilot,
          wallets: setWalletSettings(autopilot, walletId, settings),
        },
      } as unknown as Prisma.InputJsonValue,
      result: undefined,
    };
  });
}

/**
 * Get all wallets with autopilot enabled across all users.
 * Returns wallet IDs and the associated user's settings.
 */
export async function getEnabledAutopilotWallets(): Promise<
  Array<{ walletId: string; walletName: string; userId: string; settings: WalletAutopilotSettings }>
> {
  // Find all users that have autopilot preferences set
  const users = await userRepository.findWithAutopilotPreferences();

  const results: Array<{
    walletId: string;
    walletName: string;
    userId: string;
    settings: WalletAutopilotSettings;
  }> = [];

  for (const user of users) {
    const prefs = user.preferences as Record<string, unknown> | null;
    const autopilot = prefs?.autopilot as AutopilotConfig | undefined;

    if (!autopilot?.wallets) continue;

    // Build set of wallet IDs this user has access to (for name lookup)
    const accessibleWallets = new Map<string, string>();
    for (const uw of user.wallets) {
      accessibleWallets.set(uw.wallet.id, uw.wallet.name);
    }
    for (const gm of user.groupMemberships) {
      for (const w of gm.group.wallets) {
        accessibleWallets.set(w.id, w.name);
      }
    }

    for (const [walletId, settings] of Object.entries(autopilot.wallets)) {
      if (settings.enabled && accessibleWallets.has(walletId)) {
        results.push({
          walletId,
          walletName: accessibleWallets.get(walletId) || 'Unknown',
          userId: user.id,
          settings: { ...DEFAULT_AUTOPILOT_SETTINGS, ...settings },
        });
      }
    }
  }

  return results;
}
