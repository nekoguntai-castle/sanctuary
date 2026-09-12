/**
 * Tests the shared logout cache-clear helper (Phase 6 of the auth cache
 * remediation plan): the React Query cache must not survive a logout, since
 * query keys carry no user identity and a second user logging in within
 * gcTime/staleTime would otherwise see the first user's cached wallet data.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { queryClient } from '../../src/providers/QueryProvider';
import { clearQueryCacheForLogout } from '../../src/providers/queryCacheReset';
import { walletKeys } from '../../src/hooks/queries/useWallets';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('clearQueryCacheForLogout', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('empties the query cache', async () => {
    queryClient.setQueryData(walletKeys.lists(), [{ id: 'wallet-a', name: "A's wallet" }]);
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    await clearQueryCacheForLogout();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('cancels in-flight queries before clearing the cache', async () => {
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries').mockResolvedValue(undefined);
    const clearSpy = vi.spyOn(queryClient, 'clear');

    await clearQueryCacheForLogout();

    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(cancelSpy.mock.invocationCallOrder[0]).toBeLessThan(clearSpy.mock.invocationCallOrder[0]);

    cancelSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('still clears the cache and does not throw when cancelQueries rejects', async () => {
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries').mockRejectedValue(new Error('cancel failed'));
    queryClient.setQueryData(walletKeys.lists(), [{ id: 'wallet-b', name: "B's wallet" }]);

    await expect(clearQueryCacheForLogout()).resolves.toBeUndefined();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);

    cancelSpy.mockRestore();
  });

  it('does not throw when clear() itself throws', async () => {
    const clearSpy = vi.spyOn(queryClient, 'clear').mockImplementation(() => {
      throw new Error('clear failed');
    });

    await expect(clearQueryCacheForLogout()).resolves.toBeUndefined();

    clearSpy.mockRestore();
  });
});
