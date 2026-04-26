import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mcpReadRepository: {
    getLatestFeeEstimate: vi.fn(),
    getLatestPrice: vi.fn(),
    checkDatabase: vi.fn(),
  },
  isRedisConnected: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  assistantReadRepository: mocks.mcpReadRepository,
  mcpReadRepository: mocks.mcpReadRepository,
}));

vi.mock('../../../src/infrastructure', () => ({
  isRedisConnected: mocks.isRedisConnected,
}));

vi.mock('../../../src/config', () => ({
  default: {
    mcp: {
      enabled: true,
      host: '127.0.0.1',
      port: 3003,
    },
  },
}));

import { getCachedBtcPrice, getCachedFeeEstimates } from '../../../src/mcp/cache';
import { getMcpHealth } from '../../../src/mcp/health';

describe('MCP cache and health helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns unavailable and stale fee estimates when cache is empty', async () => {
    mocks.mcpReadRepository.getLatestFeeEstimate.mockResolvedValue(null);

    await expect(getCachedFeeEstimates()).resolves.toEqual({
      available: false,
      fastest: null,
      halfHour: null,
      hour: null,
      source: 'database',
      asOf: null,
      stale: true,
    });
  });

  it('returns fee estimate freshness based on age', async () => {
    mocks.mcpReadRepository.getLatestFeeEstimate.mockResolvedValue({
      fastest: 8,
      halfHour: 4,
      hour: 2,
      createdAt: new Date('2026-04-15T23:55:00.000Z'),
    });

    await expect(getCachedFeeEstimates()).resolves.toMatchObject({
      available: true,
      fastest: 8,
      stale: false,
    });

    mocks.mcpReadRepository.getLatestFeeEstimate.mockResolvedValue({
      fastest: 8,
      halfHour: 4,
      hour: 2,
      createdAt: new Date('2026-04-15T23:40:00.000Z'),
    });
    await expect(getCachedFeeEstimates()).resolves.toMatchObject({ stale: true });
  });

  it('normalizes BTC price currency and handles missing cache rows', async () => {
    mocks.mcpReadRepository.getLatestPrice.mockResolvedValueOnce(null);
    await expect(getCachedBtcPrice(' eur ')).resolves.toEqual({
      available: false,
      currency: 'EUR',
      price: null,
      source: 'database',
      asOf: null,
      stale: true,
    });
    expect(mocks.mcpReadRepository.getLatestPrice).toHaveBeenCalledWith('EUR');

    mocks.mcpReadRepository.getLatestPrice.mockResolvedValueOnce({
      currency: 'USD',
      price: 65000,
      source: 'coingecko',
      createdAt: new Date('2026-04-15T23:59:00.000Z'),
    });
    await expect(getCachedBtcPrice()).resolves.toMatchObject({
      available: true,
      currency: 'USD',
      price: 65000,
      source: 'coingecko',
      stale: false,
    });
  });

  it('reports MCP health from database and redis dependencies', async () => {
    mocks.mcpReadRepository.checkDatabase.mockResolvedValue(true);
    mocks.isRedisConnected.mockReturnValue(true);

    await expect(getMcpHealth()).resolves.toMatchObject({
      status: 'ok',
      mcp: { enabled: true, host: '127.0.0.1', port: 3003, stateless: true },
      dependencies: { database: true, redis: true },
    });

    mocks.mcpReadRepository.checkDatabase.mockResolvedValue(false);
    mocks.isRedisConnected.mockReturnValue(true);
    await expect(getMcpHealth()).resolves.toMatchObject({
      status: 'degraded',
      dependencies: { database: false, redis: true },
    });
  });
});
