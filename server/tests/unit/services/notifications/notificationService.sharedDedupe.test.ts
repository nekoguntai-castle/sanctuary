import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression: draft-notification dedupe was a per-process Map, so the same
// agent draft reaching two API replicas notified twice. The key was also
// recorded before sending, so a send that failed on every channel blocked a
// retry for the whole 10-minute TTL.

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      eval: vi.fn(async (_script: string, _keys: number, key: string, token: string) => {
        if (store.get(key) !== token) return 0;
        store.delete(key);
        return 1;
      }),
    },
    redisAvailable: true,
    redisConnected: true,
    notifyDraft: vi.fn(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../../../../src/infrastructure/redis', () => ({
  getRedisClient: () => (mocks.redisAvailable ? mocks.redis : null),
  isRedisConnected: () => mocks.redisAvailable && mocks.redisConnected,
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: { notifyDraft: mocks.notifyDraft, getAll: vi.fn(() => []) },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mocks.log,
}));

import { notifyNewDraft } from '../../../../src/services/notifications/notificationService';

const draft = (id: string, dedupeKey: string) => ({
  id,
  amount: 7_000n,
  recipient: 'tb1qexample',
  feeRate: 3,
  dedupeKey,
});

describe('draft notification dedupe across processes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store.clear();
    mocks.redisAvailable = true;
    mocks.redisConnected = true;
    mocks.notifyDraft.mockResolvedValue([{ channelId: 'telegram', success: true }]);
  });

  it('skips a draft another process already notified', async () => {
    // Another API replica claimed this key first.
    mocks.store.set('notifications:draft-dedupe:shared-key', 'other-process-token');

    await notifyNewDraft('wallet-1', draft('draft-2', 'shared-key'), null, 'Agent');

    expect(mocks.notifyDraft).not.toHaveBeenCalled();
    expect(mocks.redis.set).toHaveBeenCalledWith(
      'notifications:draft-dedupe:shared-key', expect.any(String), 'PX', expect.any(Number), 'NX',
    );
  });

  it('releases the claim when every channel failed so a retry can deliver', async () => {
    mocks.notifyDraft.mockResolvedValueOnce([{ channelId: 'telegram', success: false, errors: ['down'] }]);

    await notifyNewDraft('wallet-1', draft('draft-1', 'retry-key'), null, 'Agent');
    await notifyNewDraft('wallet-1', draft('draft-1-retry', 'retry-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(2);
  });

  it('releases the claim when dispatch throws', async () => {
    mocks.notifyDraft.mockRejectedValueOnce(new Error('registry down'));

    await expect(notifyNewDraft('wallet-1', draft('draft-1', 'throw-key'), null, 'Agent'))
      .rejects.toThrow('registry down');
    await notifyNewDraft('wallet-1', draft('draft-1-retry', 'throw-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(2);
  });

  it('keeps the claim when at least one channel delivered', async () => {
    mocks.notifyDraft.mockResolvedValueOnce([
      { channelId: 'telegram', success: false, errors: ['down'] },
      { channelId: 'push', success: true },
    ]);

    await notifyNewDraft('wallet-1', draft('draft-1', 'partial-key'), null, 'Agent');
    await notifyNewDraft('wallet-1', draft('draft-2', 'partial-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(1);
  });

  it('does not release a claim another process took after this one expired', async () => {
    mocks.notifyDraft.mockImplementationOnce(async () => {
      // Our claim expired mid-send and another process claimed the key.
      mocks.store.set('notifications:draft-dedupe:expired-key', 'other-process-token');
      return [{ channelId: 'telegram', success: false }];
    });

    await notifyNewDraft('wallet-1', draft('draft-1', 'expired-key'), null, 'Agent');

    expect(mocks.store.get('notifications:draft-dedupe:expired-key')).toBe('other-process-token');
  });

  it('uses per-process dedupe while Redis is disconnected', async () => {
    mocks.redisConnected = false;

    await notifyNewDraft('wallet-1', draft('draft-1', 'offline-key'), null, 'Agent');
    await notifyNewDraft('wallet-1', draft('draft-2', 'offline-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(1);
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it('releases a per-process claim when every channel failed', async () => {
    mocks.redisConnected = false;
    mocks.notifyDraft.mockResolvedValueOnce([{ channelId: 'telegram', success: false }]);

    await notifyNewDraft('wallet-1', draft('draft-1', 'offline-retry-key'), null, 'Agent');
    await notifyNewDraft('wallet-1', draft('draft-1-retry', 'offline-retry-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(2);
  });

  it('rethrows a dispatch failure for a draft without a dedupe key', async () => {
    mocks.notifyDraft.mockRejectedValueOnce(new Error('registry down'));
    const { dedupeKey: _omitted, ...undeduped } = draft('draft-1', 'unused');

    await expect(notifyNewDraft('wallet-1', undeduped, null, 'Agent')).rejects.toThrow('registry down');
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it('falls back to per-process dedupe when Redis errors', async () => {
    mocks.redis.set.mockRejectedValueOnce(new Error('redis down')).mockRejectedValueOnce(new Error('redis down'));

    await notifyNewDraft('wallet-1', draft('draft-1', 'fallback-key'), null, 'Agent');
    await notifyNewDraft('wallet-1', draft('draft-2', 'fallback-key'), null, 'Agent');

    expect(mocks.notifyDraft).toHaveBeenCalledTimes(1);
    expect(mocks.log.warn).toHaveBeenCalled();
  });

  it('tolerates a failed release', async () => {
    mocks.notifyDraft.mockResolvedValueOnce([{ channelId: 'telegram', success: false }]);
    mocks.redis.eval.mockRejectedValueOnce(new Error('redis down'));

    await expect(notifyNewDraft('wallet-1', draft('draft-1', 'release-key'), null, 'Agent')).resolves.toBeUndefined();
    expect(mocks.log.warn).toHaveBeenCalled();
  });
});
