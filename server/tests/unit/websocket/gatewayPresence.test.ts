import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pipeline = {
    zadd: vi.fn(),
    zremrangebyscore: vi.fn(),
    pexpire: vi.fn(),
    exec: vi.fn(async () => []),
  };
  pipeline.zadd.mockReturnValue(pipeline);
  pipeline.zremrangebyscore.mockReturnValue(pipeline);
  pipeline.pexpire.mockReturnValue(pipeline);
  return {
  pipeline,
  redis: {
    multi: vi.fn(() => pipeline),
    zrem: vi.fn(async () => 1),
    zcount: vi.fn(async () => 0),
    zrangebyscore: vi.fn(async (): Promise<string[]> => []),
  },
  redisAvailable: true,
  connected: true,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: () => (mocks.redisAvailable ? mocks.redis : null),
  isRedisConnected: () => mocks.connected,
}));
vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: { getInstanceId: () => 'api-1' },
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));

import {
  GATEWAY_PRESENCE_KEY,
  GATEWAY_PRESENCE_TTL_MS,
  clearGatewayConnected,
  isAnyGatewayConnected,
  isGatewayConnectedElsewhere,
  markGatewayConnected,
} from '../../../src/websocket/gatewayPresence';

describe('gateway presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisAvailable = true;
    mocks.connected = true;
    mocks.redis.zcount.mockResolvedValue(0);
    mocks.redis.zrangebyscore.mockResolvedValue([]);
    mocks.redis.multi.mockReturnValue(mocks.pipeline);
    mocks.pipeline.zadd.mockReturnValue(mocks.pipeline);
    mocks.pipeline.zremrangebyscore.mockReturnValue(mocks.pipeline);
    mocks.pipeline.pexpire.mockReturnValue(mocks.pipeline);
    mocks.pipeline.exec.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records this instance with an expiry so a crashed API process ages out', async () => {
    await markGatewayConnected();

    expect(mocks.pipeline.zadd).toHaveBeenCalledWith(
      GATEWAY_PRESENCE_KEY,
      1_000_000 + GATEWAY_PRESENCE_TTL_MS,
      'api-1',
    );
    // Records left by instances that died are pruned, and the key lapses when
    // no gateway is attached anywhere.
    expect(mocks.pipeline.zremrangebyscore).toHaveBeenCalledWith(GATEWAY_PRESENCE_KEY, '-inf', 1_000_000);
    expect(mocks.pipeline.pexpire).toHaveBeenCalledWith(GATEWAY_PRESENCE_KEY, GATEWAY_PRESENCE_TTL_MS);
    expect(mocks.pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('removes this instance when its gateway disconnects', async () => {
    await clearGatewayConnected();

    expect(mocks.redis.zrem).toHaveBeenCalledWith(GATEWAY_PRESENCE_KEY, 'api-1');
  });

  it('counts only unexpired records', async () => {
    mocks.redis.zcount.mockResolvedValue(1);

    await expect(isAnyGatewayConnected()).resolves.toBe(true);
    expect(mocks.redis.zcount).toHaveBeenCalledWith(GATEWAY_PRESENCE_KEY, `(${1_000_000}`, '+inf');

    mocks.redis.zcount.mockResolvedValue(0);
    await expect(isAnyGatewayConnected()).resolves.toBe(false);
  });

  it('does not count this instance\'s own record as a gateway held elsewhere', async () => {
    // Left behind when Redis was unreachable as this instance's gateway closed.
    mocks.redis.zrangebyscore.mockResolvedValue(['api-1']);
    await expect(isGatewayConnectedElsewhere()).resolves.toBe(false);
    expect(mocks.redis.zrangebyscore).toHaveBeenCalledWith(GATEWAY_PRESENCE_KEY, `(${1_000_000}`, '+inf');

    mocks.redis.zrangebyscore.mockResolvedValue(['api-1', 'api-2']);
    await expect(isGatewayConnectedElsewhere()).resolves.toBe(true);

    mocks.redis.zrangebyscore.mockResolvedValue([]);
    await expect(isGatewayConnectedElsewhere()).resolves.toBe(false);
  });

  it('is a no-op without Redis and reports no gateway', async () => {
    mocks.connected = false;
    await markGatewayConnected();
    await clearGatewayConnected();
    await expect(isAnyGatewayConnected()).resolves.toBe(false);
    await expect(isGatewayConnectedElsewhere()).resolves.toBe(false);

    mocks.connected = true;
    mocks.redisAvailable = false;
    await markGatewayConnected();
    await clearGatewayConnected();
    await expect(isAnyGatewayConnected()).resolves.toBe(false);
    await expect(isGatewayConnectedElsewhere()).resolves.toBe(false);

    expect(mocks.redis.multi).not.toHaveBeenCalled();
    expect(mocks.redis.zrem).not.toHaveBeenCalled();
    expect(mocks.redis.zcount).not.toHaveBeenCalled();
  });

  it('logs and swallows write failures, but surfaces read failures', async () => {
    mocks.pipeline.exec.mockRejectedValueOnce(new Error('write failed'));
    mocks.redis.zrem.mockRejectedValueOnce(new Error('remove failed'));

    await expect(markGatewayConnected()).resolves.toBeUndefined();
    await expect(clearGatewayConnected()).resolves.toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledTimes(2);

    mocks.redis.zcount.mockRejectedValueOnce(new Error('read failed'));
    await expect(isAnyGatewayConnected()).rejects.toThrow('read failed');
    mocks.redis.zrangebyscore.mockRejectedValueOnce(new Error('range failed'));
    await expect(isGatewayConnectedElsewhere()).rejects.toThrow('range failed');
  });
});
