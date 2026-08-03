/** Tests preference handling in UserContext. */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider, useUser } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import { mockUser, TestConsumer } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/api/auth', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
  requires2FA: vi.fn(() => false),
  isPendingEmailVerification: vi.fn((response) => response?.emailVerificationRequired === true),
}));

vi.mock('../../src/api/twoFactor', () => ({
  verify2FA: vi.fn(),
}));

vi.mock('../../src/api/refresh', () => ({
  onTerminalLogout: () => () => {},
  triggerLogout: vi.fn(),
}));

vi.mock('../../src/themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
    applyPatternOpacity: vi.fn(),
    applyFlyoutOpacity: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('UserContext preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks clears recorded calls but NOT queued mockReturnValueOnce
    // implementations. Preference writes are coalesced, so a test that queues
    // two responses may legitimately issue one request and leak the unconsumed
    // queue entry into the next test, where it silently outranks that test's
    // own mock. Reset the queue explicitly.
    vi.mocked(authApi.updatePreferences).mockReset();
    document.documentElement.classList.remove('dark');
  });

  it('updates preferences optimistically and sends only the changed patch', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockResolvedValue({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false },
    });

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('update-prefs'));

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
    });
  });

  it('persists preferences for authenticated users with null preferences', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({
      user: { ...mockUser, preferences: null },
    });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockResolvedValue({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false },
    });

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('update-prefs'));

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
    });
  });

  it('sends patches instead of stale full snapshots so backend preserves unknown keys', async () => {
    const user = userEvent.setup();
    const legacyPreferences = {
      ...mockUser.preferences,
      experimentalPane: { enabled: true },
    };
    vi.mocked(authApi.login).mockResolvedValue({
      user: { ...mockUser, preferences: legacyPreferences },
    });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockResolvedValue({
      ...mockUser,
      preferences: { ...legacyPreferences, darkMode: false },
    });

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('update-prefs'));

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
    });
  });

  it('does not send empty preference patches', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);

    function EmptyPatchConsumer() {
      const { login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="empty-patch" onClick={() => updatePreferences({})}>Empty Patch</button>
        </div>
      );
    }

    render(<UserProvider><EmptyPatchConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await user.click(screen.getByTestId('empty-patch'));

    expect(authApi.updatePreferences).not.toHaveBeenCalled();
  });

  it('does not let a failed earlier preference write roll back a later update', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();
    const secondUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    function PreferenceRaceConsumer() {
      const { user: currentUser, login, updatePreferences, error } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <button data-testid="fiat" onClick={() => updatePreferences({ fiatCurrency: 'EUR' })}>Fiat</button>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
          <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
          <span data-testid="error">{error ?? 'null'}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceRaceConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('undefined');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    });

    await user.click(screen.getByTestId('dark'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });

    // Coalescing: writes inside the debounce window merge into one request. Wait
    // until the first is actually in flight so the second opens its own batch —
    // two independent requests is precisely the invariant under test.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('fiat'));
    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');
    });
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(2);
    });

    firstUpdate.reject(new ApiError('Preference save failed', 500));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Preference save failed');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');

    secondUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: true, fiatCurrency: 'EUR' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');
    });
  });

  it('does not let an older success response overwrite a newer optimistic key', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();
    const secondUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    function PreferenceRaceConsumer() {
      const { user: currentUser, login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <button data-testid="fiat" onClick={() => updatePreferences({ fiatCurrency: 'EUR' })}>Fiat</button>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
          <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceRaceConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    });

    await user.click(screen.getByTestId('dark'));
    // Coalescing: writes inside the debounce window merge into one request.
    // Wait until the first is in flight so the second opens its own batch —
    // two independent requests is the invariant under test, and leaving a
    // queued mockReturnValueOnce unconsumed leaks it into the next test.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('fiat'));

    firstUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false, fiatCurrency: 'USD' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');

    secondUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false, fiatCurrency: 'EUR' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');
    });
  });

  it('does not let an older success response overwrite a newer optimistic write to the same key', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();
    const secondUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    function PreferenceRaceConsumer() {
      const { user: currentUser, login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="dark-off" onClick={() => updatePreferences({ darkMode: false })}>Dark Off</button>
          <button data-testid="dark-on" onClick={() => updatePreferences({ darkMode: true })}>Dark On</button>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceRaceConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('dark-off'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('dark-on'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    await act(async () => {
      firstUpdate.resolve({
        ...mockUser,
        preferences: { ...mockUser.preferences, darkMode: false },
      });
      await firstUpdate.promise;
    });

    expect(screen.getByTestId('dark-value')).toHaveTextContent('true');

    await act(async () => {
      secondUpdate.resolve({
        ...mockUser,
        preferences: { ...mockUser.preferences, darkMode: true },
      });
      await secondUpdate.promise;
    });
  });

  it('ignores preference success payloads for a different user id', async () => {
    const user = userEvent.setup();
    const update = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockReturnValueOnce(update.promise);

    function PreferenceUserMismatchConsumer() {
      const { user: currentUser, login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
          <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceUserMismatchConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    });

    await user.click(screen.getByTestId('dark'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });

    await act(async () => {
      update.resolve({
        ...mockUser,
        id: 'other-user',
        preferences: { ...mockUser.preferences, darkMode: true, fiatCurrency: 'EUR' },
      });
      await update.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
  });

  it('does not let a newer success response overwrite an older pending key', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();
    const secondUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    function PreferenceRaceConsumer() {
      const { user: currentUser, login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <button data-testid="fiat" onClick={() => updatePreferences({ fiatCurrency: 'EUR' })}>Fiat</button>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
          <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceRaceConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('dark'));
    // Coalescing: writes inside the debounce window merge into one request.
    // Wait until the first is in flight so the second opens its own batch —
    // two independent requests is the invariant under test, and leaving a
    // queued mockReturnValueOnce unconsumed leaks it into the next test.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('fiat'));

    secondUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: true, fiatCurrency: 'EUR' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('EUR');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('false');

    firstUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false, fiatCurrency: 'EUR' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });
  });

  it('applies server deletion of a patched key while preserving other pending keys', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();
    const secondUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    function PreferenceRaceConsumer() {
      const { user: currentUser, login, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="fiat" onClick={() => updatePreferences({ fiatCurrency: 'EUR' })}>Fiat</button>
          <button data-testid="theme" onClick={() => updatePreferences({ theme: 'forest' })}>Theme</button>
          <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
          <span data-testid="theme-value">{String(currentUser?.preferences?.theme)}</span>
        </div>
      );
    }

    render(<UserProvider><PreferenceRaceConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    });

    await user.click(screen.getByTestId('fiat'));

    // Coalescing: writes inside the debounce window merge into one request. Wait
    // until the first is actually in flight so the second opens its own batch —
    // two independent requests is precisely the invariant under test.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('theme'));
    await waitFor(() => {
      expect(screen.getByTestId('theme-value')).toHaveTextContent('forest');
    });
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(2);
    });

    const preferencesWithoutFiat: Record<string, unknown> = { ...mockUser.preferences };
    delete preferencesWithoutFiat.fiatCurrency;

    await act(async () => {
      firstUpdate.resolve({
        ...mockUser,
        preferences: preferencesWithoutFiat as authApi.User['preferences'],
      });
      await firstUpdate.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('fiat-value')).toHaveTextContent('undefined');
    });
    expect(screen.getByTestId('theme-value')).toHaveTextContent('forest');

    await act(async () => {
      secondUpdate.resolve({
        ...mockUser,
        preferences: { ...mockUser.preferences, theme: 'forest' },
      });
      await secondUpdate.promise;
    });
  });

  it('ignores stale preference failures after the auth session changes', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockReturnValueOnce(firstUpdate.promise);

    function SessionChangeConsumer() {
      const { user: currentUser, login, logout, updatePreferences, error } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="logout" onClick={logout}>Logout</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <span data-testid="authenticated">{String(Boolean(currentUser))}</span>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
          <span data-testid="error">{error ?? 'null'}</span>
        </div>
      );
    }

    render(<UserProvider><SessionChangeConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('dark'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    firstUpdate.reject(new ApiError('stale save failed', 500));
    await expect(firstUpdate.promise).rejects.toThrow('stale save failed');

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
  });

  it('ignores stale preference successes after the auth session changes', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred<authApi.User>();

    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockReturnValueOnce(firstUpdate.promise);

    function SessionChangeConsumer() {
      const { user: currentUser, login, logout, updatePreferences } = useUser();
      return (
        <div>
          <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
          <button data-testid="logout" onClick={logout}>Logout</button>
          <button data-testid="dark" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
          <span data-testid="authenticated">{String(Boolean(currentUser))}</span>
          <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
        </div>
      );
    }

    render(<UserProvider><SessionChangeConsumer /></UserProvider>);

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('dark'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });

    firstUpdate.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false },
    });
    await firstUpdate.promise;

    await waitFor(() => {
      expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
    });
  });

  it('does not call updatePreferences when no authenticated user is loaded', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new ApiError('Unauthorized', 401));

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('update-prefs'));

    expect(authApi.updatePreferences).not.toHaveBeenCalled();
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('reverts optimistic preference update and uses ApiError message on failure', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new ApiError('Preference save failed', 500));

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('update-prefs'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Preference save failed');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('testuser');
  });

  it('uses fallback preference update error for non-ApiError failures', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new Error('network down'));

    render(<UserProvider><TestConsumer /></UserProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByTestId('update-prefs'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to update preferences');
    });
  });
});
