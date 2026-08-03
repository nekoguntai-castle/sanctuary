import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider, useUser } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import {
  PREFERENCE_WRITE_DEBOUNCE_MS,
  PREFERENCE_WRITE_MAX_WAIT_MS,
} from '../../src/contexts/useUserPreferenceMutation';
import { mockUser } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/api/auth');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function PreferenceValueConsumer() {
  const { user: currentUser, login, logout, updatePreferences, error } = useUser();
  return (
    <div>
      <span data-testid="user">{currentUser?.username ?? 'null'}</span>
      <span data-testid="authenticated">{String(Boolean(currentUser))}</span>
      <span data-testid="loading">false</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <span data-testid="dark-value">{String(currentUser?.preferences?.darkMode)}</span>
      <span data-testid="fiat-value">{String(currentUser?.preferences?.fiatCurrency)}</span>
      <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
      <button data-testid="logout" onClick={logout}>Logout</button>
      <button data-testid="update-prefs" onClick={() => updatePreferences({ darkMode: false })}>Dark</button>
    </div>
  );
}

async function renderLoggedIn(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
  vi.mocked(authApi.requires2FA).mockReturnValue(false);

  const rendered = render(
    <UserProvider>
      <PreferenceValueConsumer />
    </UserProvider>
  );

  await waitFor(() => {
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
  await user.click(screen.getByTestId('login'));
  await waitFor(() => {
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });
  return rendered;
}

describe('preference write coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.updatePreferences).mockReset();
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('no session'));
  });

  it('collapses a burst of writes into a single request', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue(mockUser);

    await renderLoggedIn(user);

    // Five clicks well inside the debounce window.
    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByTestId('update-prefs'));
    }

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });
    // The point of the change: five writes, one PATCH.
    expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('persists on the max-wait bound while the write stream is still running', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue(mockUser);

    await renderLoggedIn(user);

    // Write continuously with gaps strictly shorter than the debounce, so the
    // debounce alone can never fire. Assert DURING the stream: if the max-wait
    // bound were removed, nothing would have been sent yet.
    const gapMs = Math.floor(PREFERENCE_WRITE_DEBOUNCE_MS / 2);
    const deadline = Date.now() + PREFERENCE_WRITE_MAX_WAIT_MS + gapMs * 4;
    let sentDuringStream = 0;
    while (Date.now() < deadline) {
      await user.click(screen.getByTestId('update-prefs'));
      await new Promise(resolve => setTimeout(resolve, gapMs));
      sentDuringStream = vi.mocked(authApi.updatePreferences).mock.calls.length;
    }

    expect(gapMs).toBeLessThan(PREFERENCE_WRITE_DEBOUNCE_MS);
    expect(sentDuringStream).toBeGreaterThan(0);
  }, 20_000);

  it('ignores a response that settles after the auth session changed mid-flight', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<authApi.User>();
    vi.mocked(authApi.updatePreferences).mockReturnValue(inFlight.promise);
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never);

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    // Wait until the batch has actually flushed, so the request is in flight
    // rather than still buffered — the buffered case is dropped instead.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    inFlight.resolve(mockUser);

    // The stale success must not resurrect a user after logout.
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('ignores a failure that settles after the auth session changed mid-flight', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<authApi.User>();
    vi.mocked(authApi.updatePreferences).mockReturnValue(inFlight.promise);
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never);

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    inFlight.reject(new Error('too late'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });
    // No error surfaced for a session that no longer exists.
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('flushes a buffered write before logout tears the session down', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue(mockUser);
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never);

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    // Log out immediately, inside the debounce window.
    await user.click(screen.getByTestId('logout'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    // The write must reach the server while the session cookie is still valid.
    // Dropping it here would lose the toggle unrecoverably.
    expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
  });

  it('drops a buffered write when a different session takes over', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue(mockUser);

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    // A fresh login supersedes the session before the debounce elapses. The
    // buffered patch belongs to the old epoch and must not be written under it.
    await user.click(screen.getByTestId('login'));
    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    expect(authApi.updatePreferences).not.toHaveBeenCalled();
  });

  it('ignores a success payload addressed to a different user id', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<authApi.User>();
    vi.mocked(authApi.updatePreferences).mockReturnValue(inFlight.promise);

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    // Payload for a different account carrying a different preference value.
    inFlight.resolve({
      ...mockUser,
      id: 'someone-else',
      preferences: { ...mockUser.preferences, darkMode: true, fiatCurrency: 'JPY' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    });
    // The foreign payload must not be adopted into this session's preferences.
    expect(screen.getByTestId('fiat-value')).toHaveTextContent('USD');
    expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('sends the buffered patch when the provider unmounts mid-debounce', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue(mockUser);

    const { unmount } = await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    expect(authApi.updatePreferences).not.toHaveBeenCalled();

    // Unmount before the debounce elapses. The write is still sent, but the
    // response is deliberately not resolved into a torn-down tree.
    unmount();

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
    });
  });
  it('keeps a newer optimistic value when an older response claims the same key', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<authApi.User>();
    vi.mocked(authApi.updatePreferences)
      .mockReturnValueOnce(inFlight.promise)
      // The second (newer) request confirms darkMode:false from the server.
      .mockResolvedValue({
        ...mockUser,
        preferences: { ...mockUser.preferences, darkMode: false },
      });

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });

    // Second write opens a new batch and takes ownership of darkMode.
    await user.click(screen.getByTestId('update-prefs'));
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(2);
    });

    // The first response now arrives carrying the pre-write server value. It
    // must not be adopted for a key a newer write already owns.
    inFlight.resolve({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: true },
    });

    // darkMode is owned by the newer batch, so the older response's `true`
    // must not overwrite the newer optimistic `false`.
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('swallows a failure from the unmount-time send', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new Error('gone'));

    const { unmount } = await renderLoggedIn(user);

    await user.click(screen.getByTestId('update-prefs'));
    unmount();

    // There is no tree left to surface the error to; it must not escape as an
    // unhandled rejection.
    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false });
    });
  });
});
