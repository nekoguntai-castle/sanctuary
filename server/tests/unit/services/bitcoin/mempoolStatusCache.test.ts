import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBlocksAndMempool } = vi.hoisted(() => ({
  getBlocksAndMempool: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/mempool', () => ({
  getBlocksAndMempool,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  getCachedMempoolStatus,
  resetMempoolStatusCacheForTests,
} from '../../../../src/services/bitcoin/mempoolStatusCache';

describe('P3-6 consolidated mempool status cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMempoolStatusCacheForTests();
  });

  it('coalesces concurrent cold fetches for the same network into a single upstream call', async () => {
    let resolveFetch!: (value: unknown) => void;
    getBlocksAndMempool.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const first = getCachedMempoolStatus('mainnet');
    const second = getCachedMempoolStatus('mainnet');

    expect(getBlocksAndMempool).toHaveBeenCalledTimes(1);
    const payload = { mempoolInfo: { count: 42 }, blocks: [] };
    resolveFetch(payload);

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.data).toEqual(payload);
    expect(r2.data).toEqual(payload);
    expect(r1.stale).toBe(false);
    expect(r2.stale).toBe(false);
  });

  it('forwards cancellation and propagates the upstream error when no cached status exists', async () => {
    const signal = AbortSignal.abort();
    getBlocksAndMempool.mockRejectedValueOnce(signal.reason);

    await expect(getCachedMempoolStatus('mainnet', { signal })).rejects.toBe(signal.reason);
    expect(getBlocksAndMempool).toHaveBeenCalledWith('mainnet', { signal });
  });

  it('returns cached data within fresh TTL and falls back to stale within stale TTL', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-25T00:00:00.000Z'));
      const payload = { mempoolInfo: { count: 7 }, blocks: [] };
      getBlocksAndMempool
        .mockResolvedValueOnce(payload)
        .mockRejectedValueOnce(new Error('mempool down'));

      const fresh = await getCachedMempoolStatus('mainnet');
      expect(fresh.fromCache).toBe(false);
      expect(fresh.stale).toBe(false);

      // Still within 15s fresh TTL
      vi.setSystemTime(new Date('2026-11-25T00:00:05.000Z'));
      const cached = await getCachedMempoolStatus('mainnet');
      expect(cached.fromCache).toBe(true);
      expect(cached.stale).toBe(false);
      expect(getBlocksAndMempool).toHaveBeenCalledTimes(1);

      // Past 15s fresh TTL, within 5m stale TTL
      vi.setSystemTime(new Date('2026-11-25T00:00:20.000Z'));
      const stale = await getCachedMempoolStatus('mainnet');
      expect(stale.fromCache).toBe(true);
      expect(stale.stale).toBe(true);
      expect(stale.data).toEqual({ ...payload, stale: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
