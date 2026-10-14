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
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';

vi.mock('../../src/api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  login: vi.fn(),
  requires2FA: vi.fn().mockReturnValue(false),
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
      invalidateAuthBootstrap: vi.fn(),
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

describe('useUserAuthActions login failures', () => {
  function setupLogin() {
    const setError = vi.fn();
    const { result } = renderHook(() => useUserAuthActions({
      invalidateAuthBootstrap: vi.fn(),
      resetPreferenceTracking: vi.fn(),
      flushPreferenceWrites: vi.fn().mockResolvedValue(undefined),
      setError,
      setIsLoading: vi.fn(),
      setNotice: vi.fn(),
      setTwoFactorPending: vi.fn(),
      setUser: vi.fn(),
      twoFactorPending: null,
    }));
    return { result, setError };
  }

  it('surfaces emailVerificationRequired from a 403 login response', async () => {
    const { result, setError } = setupLogin();
    vi.mocked(authApi.login).mockRejectedValue(new ApiError(
      'Please verify your email address before logging in.',
      403,
      { emailVerificationRequired: true, canResend: true },
    ));

    let loginResult;
    await act(async () => {
      loginResult = await result.current.login('alice', 'pw');
    });

    expect(loginResult).toEqual({ success: false, emailVerificationRequired: true });
    expect(setError).toHaveBeenCalledWith('Please verify your email address before logging in.');
  });

  it.each([
    ['a 401 ApiError', new ApiError('Invalid username or password', 401, { error: 'Unauthorized' })],
    ['a 403 without the flag', new ApiError('Forbidden', 403, { error: 'Forbidden' })],
    ['a 403 with no body', new ApiError('Forbidden', 403)],
    ['a non-ApiError', new Error('network timeout')],
  ])('does not flag %s as email verification required', async (_name, error) => {
    const { result } = setupLogin();
    vi.mocked(authApi.login).mockRejectedValue(error);

    let loginResult;
    await act(async () => {
      loginResult = await result.current.login('alice', 'pw');
    });

    expect(loginResult).toEqual({ success: false, emailVerificationRequired: false });
  });
});
