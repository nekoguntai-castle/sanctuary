/**
 * Treasury Autopilot Settings
 *
 * Per-wallet autopilot settings CRUD, stored in user.preferences.autopilot.
 * Follows the same pattern as telegram/settings.ts.
 */

import { Prisma } from '@prisma/client';
import { db as prisma } from '../../repositories/db';
import type { WalletAutopilotSettings, AutopilotConfig } from './types';
import { DEFAULT_AUTOPILOT_SETTINGS } from './types';

/**
 * Get a user's autopilot settings for a specific wallet
 */
export async function getWalletAutopilotSettings(
  userId: string,
  walletId: string
): Promise<WalletAutopilotSettings | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  if (!user) return null;

  const prefs = user.preferences as Record<string, unknown> | null;
  const autopilot = prefs?.autopilot as AutopilotConfig | undefined;

  return autopilot?.wallets?.[walletId] || null;
}

/**
 * Update a user's autopilot settings for a specific wallet
 */
export async function updateWalletAutopilotSettings(
  userId: string,
  walletId: string,
  settings: WalletAutopilotSettings
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const autopilot = (prefs.autopilot as AutopilotConfig) || { wallets: {} };

  autopilot.wallets = autopilot.wallets || {};
  autopilot.wallets[walletId] = settings;

  const updatedPrefs = {
    ...prefs,
    autopilot: {
      wallets: autopilot.wallets,
    },
  };

  await prisma.user.update({
    where: { id: userId },
    data: {
      preferences: updatedPrefs as unknown as Prisma.InputJsonValue,
    },
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
  const users = await prisma.user.findMany({
    where: {
      preferences: {
        path: ['autopilot'],
        not: Prisma.DbNull,
      },
    },
    select: {
      id: true,
      preferences: true,
      wallets: {
        select: {
          wallet: { select: { id: true, name: true } },
        },
      },
      groupMemberships: {
        select: {
          group: {
            select: {
              wallets: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

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
