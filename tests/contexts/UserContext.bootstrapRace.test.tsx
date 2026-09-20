/** Regression tests for auth transitions while /auth/me bootstrap is pending. */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '../../src/api/auth';
import * as twoFactorApi from '../../src/api/twoFactor';
import { UserProvider } from '../../src/contexts/UserContext';
import { queryClient } from '../../src/providers/QueryProvider';
import { walletKeys } from '../../src/hooks/queries/useWallets';
import { mockTwoFactorResponse, mockUser, TestConsumer } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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

vi.mock('../../src/api/twoFactor', () => ({ verify2FA: vi.fn() }));

const mockOnTerminalLogout = vi.fn<(cb: () => void) => () => void>(() => () => {});
const mockTriggerLogout = vi.fn<() => void>();
vi.mock('../../src/api/refresh', () => ({
  onTerminalLogout: (cb: () => void) => mockOnTerminalLogout(cb),
  triggerLogout: () => mockTriggerLogout(),
}));

vi.mock('../../src/themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
    applyPatternOpacity: vi.fn(),
    applyFlyoutOpacity: vi.fn(),
  },
}));

function deferAuthBootstrap() {
  let resolve!: (user: typeof mockUser) => void;
  const pending = new Promise<typeof mockUser>((done) => { resolve = done; });
  vi.mocked(authApi.getCurrentUser).mockReturnValue(pending);
  return { pending, resolve };
}

describe('UserContext pending bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    document.documentElement.classList.remove('dark');
  });

    it('ignores an auth bootstrap response after terminal logout', async () => {
      const bootstrap = deferAuthBootstrap();
      queryClient.setQueryData(walletKeys.lists(), [{ id: 'old-wallet' }]);
      let terminalLogout: (() => void) | null = null;
      mockOnTerminalLogout.mockImplementation((listener) => {
        terminalLogout = listener;
        return () => {};
      });

      render(<UserProvider><TestConsumer /></UserProvider>);
      expect(screen.getByTestId('loading')).toHaveTextContent('true');
      if (!terminalLogout) throw new Error('terminal logout listener not captured');

      act(() => {
        (terminalLogout as () => void)();
      });
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('user')).toHaveTextContent('null');

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('null');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    it('does not replace a successful login with an older bootstrap user', async () => {
      const user = userEvent.setup();
      const bootstrap = deferAuthBootstrap();
      vi.mocked(authApi.login).mockResolvedValue({ user: { ...mockUser, username: 'newuser' } });
      vi.mocked(authApi.requires2FA).mockReturnValue(false);

      render(<UserProvider><TestConsumer /></UserProvider>);
      await user.click(screen.getByTestId('login'));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('newuser'));

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('newuser');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    it('ignores an auth bootstrap response after explicit logout', async () => {
      const user = userEvent.setup();
      const bootstrap = deferAuthBootstrap();
      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      render(<UserProvider><TestConsumer /></UserProvider>);
      await user.click(screen.getByTestId('logout'));
      await waitFor(() => expect(mockTriggerLogout).toHaveBeenCalled());
      expect(screen.getByTestId('loading')).toHaveTextContent('false');

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('null');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    it('does not replace a verified 2FA user with an older bootstrap user', async () => {
      const user = userEvent.setup();
      const bootstrap = deferAuthBootstrap();
      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);
      vi.mocked(twoFactorApi.verify2FA).mockResolvedValue({ user: { ...mockUser, username: 'newuser' } });

      render(<UserProvider><TestConsumer /></UserProvider>);
      await user.click(screen.getByTestId('login'));
      await waitFor(() => expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes'));
      await user.click(screen.getByTestId('verify-2fa'));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('newuser'));

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('newuser');
      expect(screen.getByTestId('2fa-pending')).toHaveTextContent('no');
    });

    it('does not replace a successful registration with an older bootstrap user', async () => {
      const user = userEvent.setup();
      const bootstrap = deferAuthBootstrap();
      vi.mocked(authApi.register).mockResolvedValue({ user: { ...mockUser, username: 'newuser' } });

      render(<UserProvider><TestConsumer /></UserProvider>);
      await user.click(screen.getByTestId('register'));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('newuser'));

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('newuser');
    });

    it('keeps pending email verification after an older bootstrap response', async () => {
      const user = userEvent.setup();
      const bootstrap = deferAuthBootstrap();
      vi.mocked(authApi.register).mockResolvedValue({
        emailVerificationRequired: true,
        verificationEmailSent: true,
        email: 'new@example.com',
        message: 'Check your email to verify your account.',
      });

      render(<UserProvider><TestConsumer /></UserProvider>);
      await user.click(screen.getByTestId('register'));
      await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Check your email'));

      await act(async () => {
        bootstrap.resolve(mockUser);
        await bootstrap.pending;
      });
      expect(screen.getByTestId('user')).toHaveTextContent('null');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('notice')).toHaveTextContent('Check your email');
    });

});
