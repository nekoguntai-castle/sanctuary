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
    const payload = anonymizeKnownPayloadIds(redactDeep(entry.payload), context);

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

function anonymizeKnownPayloadIds(value: unknown, context: CollectorContext): unknown {
  if (Array.isArray(value)) {
    return value.map(item => anonymizeKnownPayloadIds(item, context));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = anonymizePayloadField(key, nestedValue, context);
  }
  return result;
}

function anonymizePayloadField(
  key: string,
  value: unknown,
  context: CollectorContext
): unknown {
  if (typeof value === 'string') {
    if (key === 'walletId') return context.anonymize('wallet', value);
    if (key === 'userId') return context.anonymize('user', value);
  }

  return anonymizeKnownPayloadIds(value, context);
}
