/**
 * Wallet Logs Collector
 *
 * Collects recent wallet sync/notification log entries with anonymized wallet IDs.
 * These logs capture the notification decision chain (e.g., "sent Telegram notification",
 * "skipped notification") which is critical for diagnosing fire-and-forget failures.
 */

import { walletLogBuffer } from '../../walletLogBuffer';
import { redactDeep } from '../../../utils/redact';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';

registerCollector('walletLogs', async (context: CollectorContext) => {
  const stats = walletLogBuffer.getStats();
  const allBuffers = walletLogBuffer.getAll();

  const wallets: Record<string, unknown[]> = {};
  for (const [walletId, entries] of allBuffers) {
    const anonId = context.anonymize('wallet', walletId);
    wallets[anonId] = entries.map(entry => {
      const sanitized = redactDeep(entry) as unknown as Record<string, unknown>;
      // Strip the real wallet ID from any log message text
      if (typeof sanitized.message === 'string') {
        sanitized.message = sanitized.message.split(walletId).join(anonId);
      }
      return sanitized;
    });
  }

  return {
    stats,
    wallets,
  };
});
