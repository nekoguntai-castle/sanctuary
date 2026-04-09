/**
 * Telegram Collector (Priority)
 *
 * Diagnoses Telegram notification issues by inspecting per-user config,
 * per-wallet settings, circuit breaker state, DLQ entries, and
 * automatically detecting common misconfiguration issues.
 */

import { userRepository, walletRepository } from '../../../repositories';
import { circuitBreakerRegistry } from '../../circuitBreaker';
import { deadLetterQueue } from '../../deadLetterQueue';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';
import type { TelegramConfig } from '../../telegram/types';

registerCollector('telegram', async (context: CollectorContext) => {
  const commonIssues: string[] = [];

  // 1. Get all users with their preferences and wallet relationships
  const users = await userRepository.findAllWithSelect({
    id: true,
    preferences: true,
    wallets: { select: { walletId: true } },
    groupMemberships: {
      select: {
        group: {
          select: {
            wallets: { select: { id: true } },
          },
        },
      },
    },
  });

  // 2. Single pass: build wallet-user associations AND collect all wallet IDs
  const walletUserCounts = new Map<string, { direct: Set<string>; group: Set<string> }>();

  function ensureWallet(walletId: string): { direct: Set<string>; group: Set<string> } {
    let entry = walletUserCounts.get(walletId);
    if (!entry) {
      entry = { direct: new Set(), group: new Set() };
      walletUserCounts.set(walletId, entry);
    }
    return entry;
  }

  for (const user of users) {
    for (const wu of user.wallets) {
      ensureWallet(wu.walletId).direct.add(user.id);
    }
    for (const gm of user.groupMemberships) {
      for (const w of gm.group.wallets) {
        ensureWallet(w.id).group.add(user.id);
      }
    }
  }

  // 3. Get wallet types for context (uses allWalletIds from walletUserCounts)
  const wallets = await walletRepository.findAllWithSelect(
    { id: true, type: true },
    { id: { in: [...walletUserCounts.keys()] } },
  );
  const walletTypeMap = new Map(wallets.map(w => [w.id, w.type]));

  // 4. Analyze each user
  const userResults = users.map(user => {
    const anonUserId = context.anonymize('user', user.id);
    const prefs = user.preferences as Record<string, unknown> | null;
    const telegram = prefs?.telegram as Partial<TelegramConfig> | undefined;

    const globalEnabled = telegram?.enabled ?? false;
    const hasBotToken = Boolean(telegram?.botToken);
    const hasChatId = Boolean(telegram?.chatId);

    // Build accessible wallet set for this user from walletUserCounts
    const accessibleWallets = new Set<string>();
    for (const wu of user.wallets) accessibleWallets.add(wu.walletId);
    for (const gm of user.groupMemberships) {
      for (const w of gm.group.wallets) accessibleWallets.add(w.id);
    }

    // Detect: global enabled but missing credentials
    if (globalEnabled && !hasBotToken) {
      commonIssues.push(`${anonUserId} has telegram enabled but missing botToken`);
    }
    if (globalEnabled && !hasChatId) {
      commonIssues.push(`${anonUserId} has telegram enabled but missing chatId`);
    }

    // Process wallet settings
    const walletSettings = Object.entries(telegram?.wallets ?? {}).map(([walletId, settings]) => {
      const anonWalletId = context.anonymize('wallet', walletId);

      // Detect: wallet enabled but global disabled
      if (settings.enabled && !globalEnabled) {
        commonIssues.push(
          `${anonUserId} has wallet ${anonWalletId} enabled but global telegram is disabled`
        );
      }

      // Detect: orphaned wallet setting (user has no access)
      if (!accessibleWallets.has(walletId)) {
        commonIssues.push(
          `${anonUserId} has settings for wallet ${anonWalletId} but no access to it (orphaned setting)`
        );
      }

      return {
        walletId: anonWalletId,
        walletType: walletTypeMap.get(walletId) ?? 'unknown',
        enabled: settings.enabled ?? false,
        notifyReceived: settings.notifyReceived ?? false,
        notifySent: settings.notifySent ?? false,
        notifyConsolidation: settings.notifyConsolidation ?? false,
        notifyDraft: settings.notifyDraft ?? false,
      };
    });

    return {
      id: anonUserId,
      globalEnabled,
      hasBotToken,
      hasChatId,
      walletSettings,
    };
  });

  // 5. Build wallet-user associations from the map built in step 2
  const walletUserAssociations = [...walletUserCounts.entries()].map(([walletId, counts]) => ({
    walletId: context.anonymize('wallet', walletId),
    userCount: new Set([...counts.direct, ...counts.group]).size,
    hasDirectAccess: counts.direct.size > 0,
    hasGroupAccess: counts.group.size > 0,
  }));

  // 6. Circuit breaker status for telegram
  const allBreakers = circuitBreakerRegistry.getAllHealth();
  const telegramBreaker = allBreakers.find(b => b.name.toLowerCase().includes('telegram'));

  if (telegramBreaker?.state === 'open') {
    commonIssues.push('Telegram circuit breaker is OPEN — all notifications are being blocked');
  }

  // 7. DLQ telegram entries
  const telegramDlqEntries = deadLetterQueue.getByCategory('telegram');
  if (telegramDlqEntries.length > 0) {
    commonIssues.push(`${telegramDlqEntries.length} telegram entries in dead letter queue`);
  }

  return {
    users: userResults,
    walletUserAssociations,
    circuitBreaker: telegramBreaker ?? { state: 'no-breaker-registered', failures: 0 },
    dlqTelegramEntries: telegramDlqEntries.length,
    diagnostics: {
      commonIssues,
    },
  };
});
