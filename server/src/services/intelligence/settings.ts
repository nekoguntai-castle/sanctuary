/**
 * Treasury Intelligence Settings
 *
 * Per-wallet intelligence notification preferences.
 * Stored in user.preferences.intelligence (same pattern as autopilot/settings.ts).
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { WalletIntelligenceSettings, IntelligenceConfig } from './types';
import { DEFAULT_INTELLIGENCE_SETTINGS } from './types';

const log = createLogger('INTELLIGENCE:SVC_SETTINGS');

/**
 * Get intelligence settings for a specific wallet from a user's preferences.
 */
export async function getWalletIntelligenceSettings(
  userId: string,
  walletId: string
): Promise<WalletIntelligenceSettings> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    if (!user?.preferences) return { ...DEFAULT_INTELLIGENCE_SETTINGS };

    const prefs = user.preferences as Record<string, unknown>;
    const intelligence = prefs.intelligence as IntelligenceConfig | undefined;
    const walletSettings = intelligence?.wallets?.[walletId];

    if (!walletSettings) return { ...DEFAULT_INTELLIGENCE_SETTINGS };

    return {
      enabled: walletSettings.enabled ?? DEFAULT_INTELLIGENCE_SETTINGS.enabled,
      notifyTelegram: walletSettings.notifyTelegram ?? DEFAULT_INTELLIGENCE_SETTINGS.notifyTelegram,
      notifyPush: walletSettings.notifyPush ?? DEFAULT_INTELLIGENCE_SETTINGS.notifyPush,
      severityFilter: walletSettings.severityFilter ?? DEFAULT_INTELLIGENCE_SETTINGS.severityFilter,
      typeFilter: walletSettings.typeFilter ?? DEFAULT_INTELLIGENCE_SETTINGS.typeFilter,
    };
  } catch (error) {
    log.error('Failed to get intelligence settings', { userId, walletId, error: getErrorMessage(error) });
    return { ...DEFAULT_INTELLIGENCE_SETTINGS };
  }
}

/**
 * Update intelligence settings for a specific wallet.
 */
export async function updateWalletIntelligenceSettings(
  userId: string,
  walletId: string,
  settings: Partial<WalletIntelligenceSettings>
): Promise<WalletIntelligenceSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  const prefs = (user?.preferences as Record<string, unknown>) ?? {};
  const intelligence = (prefs.intelligence as IntelligenceConfig) ?? { wallets: {} };
  const existing = intelligence.wallets?.[walletId] ?? { ...DEFAULT_INTELLIGENCE_SETTINGS };

  const updated: WalletIntelligenceSettings = {
    enabled: settings.enabled ?? existing.enabled,
    notifyTelegram: settings.notifyTelegram ?? existing.notifyTelegram,
    notifyPush: settings.notifyPush ?? existing.notifyPush,
    severityFilter: settings.severityFilter ?? existing.severityFilter,
    typeFilter: settings.typeFilter ?? existing.typeFilter,
  };

  intelligence.wallets = intelligence.wallets ?? {};
  intelligence.wallets[walletId] = updated;
  prefs.intelligence = intelligence;

  await prisma.user.update({
    where: { id: userId },
    data: { preferences: prefs as any },
  });

  return updated;
}

/**
 * Get all wallets with intelligence enabled across all users.
 * Returns walletId + userId + settings for each.
 */
export async function getEnabledIntelligenceWallets(): Promise<
  Array<{ walletId: string; walletName: string; userId: string; settings: WalletIntelligenceSettings }>
> {
  const results: Array<{
    walletId: string;
    walletName: string;
    userId: string;
    settings: WalletIntelligenceSettings;
  }> = [];

  try {
    // Find all users with their wallet associations
    const users = await prisma.user.findMany({
      select: {
        id: true,
        preferences: true,
        wallets: {
          select: {
            wallet: { select: { id: true, name: true } },
          },
        },
      },
    });

    for (const user of users) {
      if (!user.preferences) continue;
      const prefs = user.preferences as Record<string, unknown>;
      const intelligence = prefs?.intelligence as IntelligenceConfig | undefined;
      if (!intelligence?.wallets) continue;

      for (const [walletId, settings] of Object.entries(intelligence.wallets)) {
        if (!settings?.enabled) continue;

        // Find wallet name from user's wallets
        const walletUser = user.wallets.find((wu: { wallet: { id: string; name: string } }) => wu.wallet.id === walletId);
        if (!walletUser) continue;

        results.push({
          walletId,
          walletName: walletUser.wallet.name,
          userId: user.id,
          settings: {
            enabled: settings.enabled ?? false,
            notifyTelegram: settings.notifyTelegram ?? true,
            notifyPush: settings.notifyPush ?? true,
            severityFilter: settings.severityFilter ?? 'info',
            typeFilter: settings.typeFilter ?? ['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation'],
          },
        });
      }
    }
  } catch (error) {
    log.error('Failed to get enabled intelligence wallets', { error: getErrorMessage(error) });
  }

  return results;
}
