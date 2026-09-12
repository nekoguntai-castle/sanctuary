/**
 * Contract: `updatePreferences` never rejects. It resolves to a
 * `PreferenceSaveResult` — `{ ok: true }` on success, `{ ok: false, error }`
 * on failure — so awaiting callers can branch on `.ok` instead of relying on
 * a rejection the implementation has never actually produced (flush always
 * ends in `finally { resolve() }`).
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { UserProvider, useUser } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import type { PreferenceSaveResult } from '../../src/contexts/useUserPreferenceMutation';
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

function formatResult(result: PreferenceSaveResult | null): string {
  if (!result) return 'none';
  return result.ok ? 'ok' : `error:${result.error}`;
}

function SaveResultConsumer() {
  const { user: currentUser, login, updatePreferences, error } = useUser();
  const [darkResult, setDarkResult] = React.useState<PreferenceSaveResult | null>(null);
  const [fiatResult, setFiatResult] = React.useState<PreferenceSaveResult | null>(null);

  return React.createElement(
    'div',
    null,
    React.createElement(
      'button',
      { 'data-testid': 'login', onClick: () => login('testuser', 'password') },
      'Login',
    ),
    React.createElement(
      'button',
      {
        'data-testid': 'dark',
        onClick: () => {
          void updatePreferences({ darkMode: false }).then(setDarkResult);
        },
      },
      'Dark',
    ),
    React.createElement(
      'button',
      {
        'data-testid': 'fiat',
        onClick: () => {
          void updatePreferences({ fiatCurrency: 'EUR' }).then(setFiatResult);
        },
      },
      'Fiat',
    ),
    React.createElement('span', { 'data-testid': 'authenticated' }, String(Boolean(currentUser))),
    React.createElement('span', { 'data-testid': 'dark-value' }, String(currentUser?.preferences?.darkMode)),
    React.createElement('span', { 'data-testid': 'dark-result' }, formatResult(darkResult)),
    React.createElement('span', { 'data-testid': 'fiat-result' }, formatResult(fiatResult)),
    React.createElement('span', { 'data-testid': 'context-error' }, error ?? 'null'),
  );
}

async function renderLoggedIn(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
  vi.mocked(authApi.requires2FA).mockReturnValue(false);
  vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('no session'));

  render(React.createElement(UserProvider, null, React.createElement(SaveResultConsumer)));

  await user.click(screen.getByTestId('login'));
  await waitFor(() => {
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });
}

describe('useUserPreferenceMutation save result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.updatePreferences).mockReset();
  });

  it('resolves to { ok: false, error } on a failed PATCH without rejecting', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new ApiError('Preference save failed', 500));

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('dark'));

    await waitFor(() => {
      expect(screen.getByTestId('dark-result')).toHaveTextContent('error:Preference save failed');
    });
    // The context-level error surface still gets the rollback message.
    expect(screen.getByTestId('context-error')).toHaveTextContent('Preference save failed');
    // Rollback: optimistic value reverted since the write failed.
    expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
  });

  it('resolves to { ok: true } on a successful PATCH', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockResolvedValue({
      ...mockUser,
      preferences: { ...mockUser.preferences, darkMode: false },
    });

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('dark'));

    await waitFor(() => {
      expect(screen.getByTestId('dark-result')).toHaveTextContent('ok');
    });
    expect(screen.getByTestId('dark-value')).toHaveTextContent('false');
  });

  it('gives every write coalesced into one failed batch the same failure result', async () => {
    const user = userEvent.setup();
    const inFlight = deferred<authApi.User>();
    vi.mocked(authApi.updatePreferences).mockReturnValue(inFlight.promise);

    await renderLoggedIn(user);

    // Both clicks land inside the debounce window, so they coalesce into one
    // batch and therefore one `settled` promise.
    await user.click(screen.getByTestId('dark'));
    await user.click(screen.getByTestId('fiat'));

    await waitFor(() => {
      expect(authApi.updatePreferences).toHaveBeenCalledTimes(1);
    });
    expect(authApi.updatePreferences).toHaveBeenCalledWith({ darkMode: false, fiatCurrency: 'EUR' });

    await act(async () => {
      inFlight.reject(new ApiError('batch failed', 500));
      // Let the flush's catch/finally run.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('dark-result')).toHaveTextContent('error:batch failed');
    });
    await waitFor(() => {
      expect(screen.getByTestId('fiat-result')).toHaveTextContent('error:batch failed');
    });
  });

  it('still rolls back state and sets UserContext.error on failure', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updatePreferences).mockRejectedValue(new Error('network down'));

    await renderLoggedIn(user);

    await user.click(screen.getByTestId('dark'));

    await waitFor(() => {
      expect(screen.getByTestId('dark-result')).toHaveTextContent('error:Failed to update preferences');
    });
    expect(screen.getByTestId('context-error')).toHaveTextContent('Failed to update preferences');
    expect(screen.getByTestId('dark-value')).toHaveTextContent('true');
  });
});
