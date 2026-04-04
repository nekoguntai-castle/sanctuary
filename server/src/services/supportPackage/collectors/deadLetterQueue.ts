/**
 * Dead Letter Queue Collector
 *
 * Collects DLQ stats and recent entries with anonymized IDs.
 */

import { deadLetterQueue } from '../../deadLetterQueue';
import { redactDeep } from '../../../utils/redact';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';

registerCollector('deadLetterQueue', async (context: CollectorContext) => {
  const stats = deadLetterQueue.getStats();
  const entries = deadLetterQueue.getAll(50);

  // Anonymize IDs in entry payloads
  const anonymizedEntries = entries.map(entry => {
    const payload = redactDeep(entry.payload) as Record<string, unknown>;

    // Anonymize known ID fields in payload
    if (typeof payload.walletId === 'string') {
      payload.walletId = context.anonymize('wallet', payload.walletId as string);
    }
    if (typeof payload.userId === 'string') {
      payload.userId = context.anonymize('user', payload.userId as string);
    }

    return {
      id: entry.id,
      category: entry.category,
      operation: entry.operation,
      payload,
      error: entry.error,
      attempts: entry.attempts,
      firstFailedAt: entry.firstFailedAt.toISOString(),
      lastFailedAt: entry.lastFailedAt.toISOString(),
    };
  });

  return {
    stats,
    recentEntries: anonymizedEntries,
  };
});
