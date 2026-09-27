import { StrictMode, useEffect, useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider, useUser } from '../../src/contexts/UserContext';
import { useUserTwoFactorActions } from '../../src/contexts/useUserTwoFactorActions';
import type { User } from '../../src/types';
import { triggerLogout } from '../../src/api/refresh';

const api = vi.hoisted(() => ({ me: vi.fn(), login: vi.fn(), logout: vi.fn(), enable: vi.fn(), disable: vi.fn(), preferences: vi.fn() }));
vi.mock('../../src/api/auth', async original => ({ ...await original(), getCurrentUser: api.me, login: api.login, logout: api.logout, updatePreferences: api.preferences }));
vi.mock('../../src/api/twoFactor', async original => ({ ...await original(), enable2FA: api.enable, disable2FA: api.disable }));
vi.mock('../../src/contexts/useUserTheme', () => ({ useUserTheme: () => {} }));

const user: User = { id: 'u1', username: 'alice', isAdmin: false, createdAt: '2026-01-01', preferences: {}, twoFactorEnabled: false };
const codes = { success: true, backupCodes: ['private-code'] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function mountedProvider() {
  const hook = renderHook(() => useUser(), { wrapper: UserProvider });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.me.mockResolvedValue({ ...user });
  api.login.mockResolvedValue({ user: { ...user } });
  api.logout.mockResolvedValue(undefined);
  api.enable.mockResolvedValue(codes);
  api.disable.mockResolvedValue({ success: true });
});

describe('session-owned two-factor management', () => {
  it('does not admit a request without an authenticated user', async () => {
    api.me.mockRejectedValue(new Error('no session'));
    const { result } = await mountedProvider();
    await expect(result.current.enableTwoFactor('123456')).resolves.toBeNull();
    await expect(result.current.disableTwoFactor({ password: 'p', token: '123456' })).resolves.toBeNull();
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.disable).not.toHaveBeenCalled();
  });

  it.each(['logout', 'terminal', 'same-user', 'different-user'] as const)('retires success after %s', async transition => {
    const pending = deferred<typeof codes>();
    api.enable.mockReturnValue(pending.promise);
    const { result } = await mountedProvider();
    let request!: Promise<typeof codes | null>;
    act(() => { request = result.current.enableTwoFactor('123456'); });
    await act(async () => {
      if (transition === 'terminal') triggerLogout();
      else await result.current.logout();
      if (transition.endsWith('user')) {
        api.login.mockResolvedValue({ user: { ...user, id: transition === 'different-user' ? 'u2' : user.id } });
        await result.current.login('alice', 'password');
      }
    });
    await act(async () => { pending.resolve(codes); expect(await request).toBeNull(); });
    expect(result.current.user?.twoFactorEnabled ?? false).toBe(false);
  });

  it.each(['terminal', 'same-user'] as const)('retires errors after %s without reporting them to replacement session', async transition => {
    const pending = deferred<typeof codes>();
    api.enable.mockReturnValue(pending.promise);
    const { result } = await mountedProvider();
    let request!: Promise<typeof codes | null>;
    act(() => { request = result.current.enableTwoFactor('123456'); });
    await act(async () => {
      triggerLogout();
      if (transition === 'same-user') await result.current.login('alice', 'password');
    });
    await act(async () => { pending.reject(new Error('old failure')); expect(await request).toBeNull(); });
    expect(result.current.error).toBeNull();
  });

  it('does not let an old finally release a newer session request', async () => {
    const old = deferred<typeof codes>();
    const current = deferred<typeof codes>();
    api.enable.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result } = await mountedProvider();
    let first!: Promise<typeof codes | null>;
    act(() => { first = result.current.enableTwoFactor('111111'); });
    await act(async () => { await result.current.logout(); await result.current.login('alice', 'password'); });
    let second!: Promise<typeof codes | null>;
    act(() => { second = result.current.enableTwoFactor('222222'); });
    await act(async () => { old.resolve(codes); expect(await first).toBeNull(); });
    await expect(result.current.disableTwoFactor({ password: 'p', token: '333333' })).resolves.toBeNull();
    expect(api.disable).not.toHaveBeenCalled();
    await act(async () => { current.resolve(codes); expect(await second).toEqual(codes); });
    expect(result.current.user?.twoFactorEnabled).toBe(true);
  });

  it('propagates current errors and releases admission for retry', async () => {
    const error = new Error('invalid token');
    api.enable.mockRejectedValueOnce(error);
    const { result } = await mountedProvider();
    await expect(result.current.enableTwoFactor('111111')).rejects.toBe(error);
    await act(async () => { expect(await result.current.enableTwoFactor('222222')).toEqual(codes); });
    expect(result.current.user?.twoFactorEnabled).toBe(true);
  });

  it.each(['success', 'error'] as const)('rejects a retired provider %s and retained admission', async outcome => {
    const pending = deferred<typeof codes>();
    api.enable.mockReturnValue(pending.promise);
    const { result, unmount } = await mountedProvider();
    const retained = result.current.enableTwoFactor;
    const request = retained('123456');
    unmount();
    if (outcome === 'success') pending.resolve(codes); else pending.reject(new Error('retired'));
    await expect(request).resolves.toBeNull();
    await expect(retained('654321')).resolves.toBeNull();
    expect(api.enable).toHaveBeenCalledTimes(1);
  });

  it('preserves canonical security status when a delayed preference response completes', async () => {
    const pending = deferred<User>();
    api.preferences.mockReturnValue(pending.promise);
    const { result } = await mountedProvider();
    let saved!: ReturnType<typeof result.current.updatePreferences>;
    act(() => { saved = result.current.updatePreferences({ darkMode: true }); });
    await waitFor(() => expect(api.preferences).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.enableTwoFactor('123456'); });
    await act(async () => { pending.resolve({ ...user, preferences: { darkMode: true } }); await saved; });
    expect(result.current.user?.twoFactorEnabled).toBe(true);
    expect(result.current.user?.preferences?.darkMode).toBe(true);
  });

  it('retires StrictMode first-lifetime results while the replay admits a fresh operation', async () => {
    const old = deferred<typeof codes>();
    const current = deferred<typeof codes>();
    api.enable.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const requests: Array<Promise<typeof codes | null>> = [];
    const { result } = renderHook(() => {
      const [state, setState] = useState<User | null>({ ...user });
      const epoch = useRef(0);
      const actions = useUserTwoFactorActions({ user: state, setUser: setState, authEpochRef: epoch });
      useEffect(() => { requests.push(actions.enableTwoFactor('123456')); }, [actions.enableTwoFactor]);
      return state;
    }, { wrapper: StrictMode });
    expect(api.enable).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(codes); expect(await requests[0]).toBeNull(); });
    expect(result.current?.twoFactorEnabled).toBe(false);
    await act(async () => { current.resolve(codes); expect(await requests[1]).toEqual(codes); });
    expect(result.current?.twoFactorEnabled).toBe(true);
  });

  it.each(['epoch', 'identity'] as const)('rechecks %s ownership when React applies a deferred functional update', async guard => {
    const queued: Array<import('react').SetStateAction<User | null>> = [];
    const { result } = renderHook(() => {
      const [state, setState] = useState<User | null>({ ...user });
      const epoch = useRef(0);
      // Control dispatch timing, but apply the real updater through React state.
      const actions = useUserTwoFactorActions({ user: state, setUser: update => { queued.push(update); }, authEpochRef: epoch });
      return { state, setState, epoch, actions };
    });
    await act(async () => { await result.current.actions.enableTwoFactor('123456'); });
    expect(queued).toHaveLength(1);
    act(() => {
      if (guard === 'epoch') result.current.epoch.current += 1;
      result.current.setState({ ...user, id: guard === 'identity' ? 'u2' : user.id, username: 'replacement session' });
      result.current.setState(queued[0]);
    });
    expect(result.current.state?.username).toBe('replacement session');
    expect(result.current.state?.twoFactorEnabled).toBe(false);
  });
});
