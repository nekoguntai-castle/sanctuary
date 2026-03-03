import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockGetRedisClient, mockIsRedisConnected, mockGetAdvancedFeeEstimates, mockLogger } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
  mockIsRedisConnected: vi.fn(),
  mockGetAdvancedFeeEstimates: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../../src/services/bitcoin/advancedTx/feeEstimation', () => ({
  getAdvancedFeeEstimates: mockGetAdvancedFeeEstimates,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  getLatestFeeSnapshot,
  getRecentFees,
  isFeeLow,
  recordFeeSnapshot,
} from '../../../../src/services/autopilot/feeMonitor';

function buildRedisMock() {
  return {
    zadd: vi.fn(),
    zcard: vi.fn(),
    zremrangebyrank: vi.fn(),
    zrangebyscore: vi.fn(),
    zrevrange: vi.fn(),
  };
}

describe('autopilot feeMonitor', () => {
  const redis = buildRedisMock();

  beforeEach(() => {
    vi.clearAllMocks();
    redis.zadd.mockReset();
    redis.zcard.mockReset();
    redis.zremrangebyrank.mockReset();
    redis.zrangebyscore.mockReset();
    redis.zrevrange.mockReset();

    (mockGetRedisClient as Mock).mockReturnValue(redis);
    (mockIsRedisConnected as Mock).mockReturnValue(true);
    (mockGetAdvancedFeeEstimates as Mock).mockResolvedValue({
      fastest: { feeRate: 40 },
      fast: { feeRate: 30 },
      medium: { feeRate: 20 },
      slow: { feeRate: 10 },
      minimum: { feeRate: 2 },
    });
  });

  it('skips recording when redis is unavailable', async () => {
    (mockGetRedisClient as Mock).mockReturnValueOnce(null);

    await recordFeeSnapshot();

    expect(mockGetAdvancedFeeEstimates).not.toHaveBeenCalled();
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('records snapshot and prunes old entries when count exceeds max', async () => {
    redis.zcard.mockResolvedValueOnce(200);

    await recordFeeSnapshot();

    expect(redis.zadd).toHaveBeenCalledTimes(1);
    expect(redis.zadd.mock.calls[0][0]).toBe('autopilot:fees');
    expect(typeof redis.zadd.mock.calls[0][1]).toBe('number');
    const payload = JSON.parse(redis.zadd.mock.calls[0][2] as string);
    expect(payload.economy).toBe(10);
    expect(payload.minimum).toBe(2);

    expect(redis.zremrangebyrank).toHaveBeenCalledWith('autopilot:fees', 0, 55);
  });

  it('does not prune when snapshot count is within retention window', async () => {
    redis.zcard.mockResolvedValueOnce(144);

    await recordFeeSnapshot();

    expect(redis.zremrangebyrank).not.toHaveBeenCalled();
  });

  it('handles snapshot errors without throwing', async () => {
    (mockGetAdvancedFeeEstimates as Mock).mockRejectedValueOnce(new Error('fee provider down'));

    await expect(recordFeeSnapshot()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('returns recent fee snapshots from redis window query', async () => {
    redis.zrangebyscore.mockResolvedValueOnce([
      JSON.stringify({
        timestamp: 1,
        fastest: 50,
        halfHour: 40,
        hour: 30,
        economy: 20,
        minimum: 5,
      }),
    ]);

    const snapshots = await getRecentFees(90);
    expect(snapshots).toEqual([
      {
        timestamp: 1,
        fastest: 50,
        halfHour: 40,
        hour: 30,
        economy: 20,
        minimum: 5,
      },
    ]);
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      'autopilot:fees',
      expect.any(Number),
      '+inf'
    );
  });

  it('returns latest snapshot or null when there is no data', async () => {
    redis.zrevrange.mockResolvedValueOnce([
      JSON.stringify({
        timestamp: 2,
        fastest: 60,
        halfHour: 45,
        hour: 35,
        economy: 25,
        minimum: 8,
      }),
    ]);

    await expect(getLatestFeeSnapshot()).resolves.toEqual({
      timestamp: 2,
      fastest: 60,
      halfHour: 45,
      hour: 35,
      economy: 25,
      minimum: 8,
    });

    redis.zrevrange.mockResolvedValueOnce([]);
    await expect(getLatestFeeSnapshot()).resolves.toBeNull();
  });

  it('evaluates fee threshold against latest snapshot', async () => {
    redis.zrevrange.mockResolvedValueOnce([
      JSON.stringify({
        timestamp: 3,
        fastest: 70,
        halfHour: 50,
        hour: 40,
        economy: 6,
        minimum: 3,
      }),
    ]);
    await expect(isFeeLow(7)).resolves.toBe(true);

    redis.zrevrange.mockResolvedValueOnce([
      JSON.stringify({
        timestamp: 4,
        fastest: 80,
        halfHour: 60,
        hour: 45,
        economy: 9,
        minimum: 4,
      }),
    ]);
    await expect(isFeeLow(7)).resolves.toBe(false);

    redis.zrevrange.mockResolvedValueOnce([]);
    await expect(isFeeLow(7)).resolves.toBe(false);
  });
});
