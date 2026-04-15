import { describe, it, expect, vi } from 'vitest';

const {
  mockCheckDatabase,
  mockCheckDiskSpace,
  mockCheckMemory,
  mockCheckElectrum,
  mockCheckWebSocket,
  mockCheckSync,
  mockCheckRedis,
  mockCheckJobQueue,
  collectorMap,
} = vi.hoisted(() => ({
  mockCheckDatabase: vi.fn(),
  mockCheckDiskSpace: vi.fn(),
  mockCheckMemory: vi.fn(),
  mockCheckElectrum: vi.fn(),
  mockCheckWebSocket: vi.fn(),
  mockCheckSync: vi.fn(),
  mockCheckRedis: vi.fn(),
  mockCheckJobQueue: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/health', () => ({
  checkDatabase: mockCheckDatabase,
  checkDiskSpace: mockCheckDiskSpace,
  checkMemory: mockCheckMemory,
  checkElectrum: mockCheckElectrum,
  checkWebSocket: mockCheckWebSocket,
  checkSync: mockCheckSync,
  checkRedis: mockCheckRedis,
  checkJobQueue: mockCheckJobQueue,
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/health';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('health collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('health');
    if (!c) throw new Error('health collector not registered');
    return c;
  };

  it('registers itself as health', () => {
    expect(collectorMap.has('health')).toBe(true);
  });

  it('returns all 8 health checks', async () => {
    mockCheckDatabase.mockResolvedValue({ status: 'ok', latencyMs: 5 });
    mockCheckRedis.mockResolvedValue({ status: 'ok', latencyMs: 2 });
    mockCheckJobQueue.mockResolvedValue({ status: 'ok', activeJobs: 0 });
    mockCheckElectrum.mockReturnValue({ status: 'ok', connected: true });
    mockCheckWebSocket.mockReturnValue({ status: 'ok', connections: 3 });
    mockCheckSync.mockReturnValue({ status: 'ok', syncing: false });
    mockCheckMemory.mockReturnValue({ status: 'ok', usedMB: 512 });
    mockCheckDiskSpace.mockResolvedValue({ status: 'ok', freeGB: 50 });

    const result = await getCollector()(makeContext());

    expect(result.database).toEqual({ status: 'ok', latencyMs: 5 });
    expect(result.redis).toEqual({ status: 'ok', latencyMs: 2 });
    expect(result.jobQueue).toEqual({ status: 'ok', activeJobs: 0 });
    expect(result.electrum).toEqual({ status: 'ok', connected: true });
    expect(result.websocket).toEqual({ status: 'ok', connections: 3 });
    expect(result.sync).toEqual({ status: 'ok', syncing: false });
    expect(result.memory).toEqual({ status: 'ok', usedMB: 512 });
    expect(result.disk).toEqual({ status: 'ok', freeGB: 50 });
  });

  it('calls async checks with Promise.all (database, redis, jobQueue)', async () => {
    mockCheckDatabase.mockResolvedValue({ status: 'ok' });
    mockCheckRedis.mockResolvedValue({ status: 'ok' });
    mockCheckJobQueue.mockResolvedValue({ status: 'ok' });
    mockCheckElectrum.mockReturnValue({ status: 'ok' });
    mockCheckWebSocket.mockReturnValue({ status: 'ok' });
    mockCheckSync.mockReturnValue({ status: 'ok' });
    mockCheckMemory.mockReturnValue({ status: 'ok' });
    mockCheckDiskSpace.mockResolvedValue({ status: 'ok' });

    await getCollector()(makeContext());

    expect(mockCheckDatabase).toHaveBeenCalled();
    expect(mockCheckRedis).toHaveBeenCalled();
    expect(mockCheckJobQueue).toHaveBeenCalled();
    expect(mockCheckElectrum).toHaveBeenCalled();
    expect(mockCheckWebSocket).toHaveBeenCalled();
    expect(mockCheckSync).toHaveBeenCalled();
    expect(mockCheckMemory).toHaveBeenCalled();
    expect(mockCheckDiskSpace).toHaveBeenCalled();
  });
});
