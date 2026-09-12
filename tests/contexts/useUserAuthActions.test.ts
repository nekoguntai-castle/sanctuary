/**
 * Phase 6 of the auth cache remediation plan: logout must clear the React
 * Query cache so a second user logging in within the same tab cannot see
 * the first user's cached wallet data. This covers the explicit-logout
 * path (useUserAuthActions.logout) and asserts the cache-clear helper runs
 * AFTER setUser(null), so no authenticated query can remount against the
 * cleared cache before the tree unmounts.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserAuthActions } from '../../src/contexts/useUserAuthActions';

vi.mock('../../src/api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/api/refresh', () => ({
  triggerLogout: vi.fn(),
}));
const mockClearQueryCacheForLogout = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/providers/queryCacheReset', () => ({
  clearQueryCacheForLogout: () => mockClearQueryCacheForLogout(),
}));

describe('useUserAuthActions logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearQueryCacheForLogout.mockResolvedValue(undefined);
  });

  function setup() {
    const setUser = vi.fn();
    const { result } = renderHook(() => useUserAuthActions({
      resetPreferenceTracking: vi.fn(),
      flushPreferenceWrites: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      setIsLoading: vi.fn(),
      setNotice: vi.fn(),
      setTwoFactorPending: vi.fn(),
      setUser,
      twoFactorPending: null,
    }));
    return { result, setUser };
  }

  it('clears the query cache on logout', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.logout();
    });

    expect(mockClearQueryCacheForLogout).toHaveBeenCalledTimes(1);
  });

  it('clears the query cache AFTER setUser(null)', async () => {
    const { result, setUser } = setup();

    await act(async () => {
      await result.current.logout();
    });

    expect(setUser).toHaveBeenCalledWith(null);
    const setUserOrder = setUser.mock.invocationCallOrder[0];
    const clearCacheOrder = mockClearQueryCacheForLogout.mock.invocationCallOrder[0];
    expect(setUserOrder).toBeLessThan(clearCacheOrder);
  });
});
