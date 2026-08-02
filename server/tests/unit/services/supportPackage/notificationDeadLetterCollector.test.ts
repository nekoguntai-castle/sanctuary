import { describe, expect, it, vi } from 'vitest';

const { definitions, mockRead } = vi.hoisted(() => ({
  definitions: new Map<string, Record<string, unknown>>(),
  mockRead: vi.fn(),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerShareableCollector: (name: string, definition: Record<string, unknown>) => {
    definitions.set(name, definition);
  },
}));

vi.mock('../../../../src/services/notifications/deadLetterAggregates', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../src/services/notifications/deadLetterAggregates')
  >();
  return {
    ...actual,
    NotificationDeadLetterAggregateReader: class { read = mockRead; },
  };
});

import '../../../../src/services/supportPackage/collectors/notificationDeadLetters';
import { notificationDeadLetterSnapshotSchema } from '../../../../src/services/notifications/deadLetterAggregates';

describe('notification dead-letter support collector', () => {
  it('registers strict aggregate-only provenance and returns fixed failure state', async () => {
    mockRead.mockResolvedValue({
      version: 1,
      observation: 'unavailable',
      coverage: 'unavailable',
      retention: {
        window: 'seven_days',
        counts: 'best_effort_exhaustion_attempt',
        duplicateCallbacks: 'may_increment',
        retryClaimRemovalEffect: 'historical_event_retained_until_expiry',
      },
      records: [],
      truncated: false,
      droppedDimensionBucket: 'zero',
    });
    const definition = definitions.get('notificationDeadLetters') as {
      collect: () => Promise<unknown>;
      schema: typeof notificationDeadLetterSnapshotSchema;
      sourceProcess: string;
      sourceKind: string;
      authoritativeFor: string[];
      notAuthoritativeFor: string[];
    };

    expect(definition).toEqual(expect.objectContaining({
      schema: notificationDeadLetterSnapshotSchema,
      sourceProcess: 'redis_shared',
      sourceKind: 'rolling_aggregate',
      authoritativeFor: ['worker_delivery_aggregates'],
      notAuthoritativeFor: ['worker_delivery'],
    }));
    const result = await definition.collect();
    expect(notificationDeadLetterSnapshotSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/payload|error|stack|walletId|userId|txid|jobId/i);
  });
});
