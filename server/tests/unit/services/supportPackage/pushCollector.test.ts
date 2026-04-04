import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHealthCheck, mockGroupBy, collectorMap } = vi.hoisted(() => ({
  mockHealthCheck: vi.fn(),
  mockGroupBy: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/push/pushService', () => ({
  getPushService: () => ({
    healthCheck: () => mockHealthCheck(),
  }),
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: {
    pushDevice: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/push';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('push collector', () => {
  beforeEach(() => {
    mockHealthCheck.mockResolvedValue({ healthy: true, providers: { apns: true, fcm: false } });
    mockGroupBy.mockResolvedValue([
      { platform: 'ios', _count: { _all: 3 } },
      { platform: 'android', _count: { _all: 5 } },
    ]);
  });

  const getCollector = () => {
    const c = collectorMap.get('push');
    if (!c) throw new Error('push collector not registered');
    return c;
  };

  it('registers itself as push', () => {
    expect(collectorMap.has('push')).toBe(true);
  });

  it('returns health and device counts', async () => {
    const result = await getCollector()(makeContext());
    expect((result.health as any).healthy).toBe(true);
    expect((result.health as any).providers.apns).toBe(true);
    expect((result.devices as any).ios).toBe(3);
    expect((result.devices as any).android).toBe(5);
    expect(result.totalDevices).toBe(8);
  });

  it('returns error on failure', async () => {
    mockHealthCheck.mockRejectedValue(new Error('provider init failed'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('provider init failed');
  });
});
