/** Tests authentication, user management, and preference handling in UserContext. */

import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import {
useAuth,
useCurrentUser,
UserProvider,
useTwoFactor,
useUser,
useUserPreferences,
} from '../../contexts/UserContext';
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import * as twoFactorApi from '../../src/api/twoFactor';
import {
  mockTwoFactorResponse,
  mockUser,
  TestConsumer,
} from './UserContext.test.fixtures';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the APIs. ADR 0001 / 0002 Phase 4: isAuthenticated() was removed
// — authentication state is determined by calling /auth/me and inspecting
// the status, so tests mock getCurrentUser directly (resolve = hydrated,
// reject with 401 = not authenticated).
vi.mock('../../src/api/auth', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
  requires2FA: vi.fn(() => false),
}));

vi.mock('../../src/api/twoFactor', () => ({
  verify2FA: vi.fn(),
}));

// Mock the refresh module. UserContext subscribes to onTerminalLogout on
// mount and calls triggerLogout on explicit logout. Neither should
// actually exercise the Web Lock / BroadcastChannel paths in these
// tests — those have their own dedicated tests in tests/api/refresh.test.ts.
const mockOnTerminalLogout = vi.fn<(cb: () => void) => () => void>(() => () => {});
const mockTriggerLogout = vi.fn<() => void>();
vi.mock('../../src/api/refresh', () => ({
  onTerminalLogout: (cb: () => void) => mockOnTerminalLogout(cb),
  triggerLogout: () => mockTriggerLogout(),
}));

// Mock theme registry
vi.mock('../../themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
    applyPatternOpacity: vi.fn(),
  },
}));

describe('UserContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset document classes
    document.documentElement.classList.remove('dark');
  });

  function registerProviderInitializationTests(): void {
    describe('Provider initialization', () => {
    it('initializes with unauthenticated state when /auth/me returns 401', async () => {
      // Phase 4: UserContext calls /auth/me on mount. A 401 means the
      // user is not authenticated (or never was) — render login.
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new ApiError('Unauthorized', 401));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      expect(authApi.getCurrentUser).toHaveBeenCalled();
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });

    it('hydrates the user state from /auth/me when the call succeeds', async () => {
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(authApi.getCurrentUser).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });
    });

    it('swallows non-401 /auth/me failures without calling logout', async () => {
      // Phase 4 UserContext does NOT call authApi.logout when the boot
      // /auth/me call fails — server or network errors should not evict
      // the user; they just render the login screen and let the user
      // try again. This matches the "don't evict credentials on server-
      // side failures" lesson captured in tasks/lessons.md after the
      // Phase 2 rotation-500 fix.
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('network down'));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      expect(authApi.logout).not.toHaveBeenCalled();
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    });

    it('subscribes to terminal logout broadcasts on mount', async () => {
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new ApiError('Unauthorized', 401));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(mockOnTerminalLogout).toHaveBeenCalled();
      });
    });

    it('clears user state when a terminal logout broadcast fires', async () => {
      // Drive the terminal-logout listener directly: capture the
      // callback that UserContext passed to onTerminalLogout, render
      // the provider with a hydrated user, then invoke the callback and
      // assert the user is cleared.
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      let capturedListener: (() => void) | null = null;
      mockOnTerminalLogout.mockImplementation((cb: () => void) => {
        capturedListener = cb;
        return () => {};
      });

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
      });

      // Simulate a logout-broadcast delivered by refresh.ts.
      if (!capturedListener) throw new Error('terminal logout listener not captured');
      act(() => {
        (capturedListener as () => void)();
      });

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('null');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });

    it('applies default dark theme when no user', async () => {
      vi.mocked(authApi.getCurrentUser).mockRejectedValue(new ApiError('Unauthorized', 401));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    });
  }

  function registerLoginTests(): void {
    describe('Login', () => {
    it('logs in successfully', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
      vi.mocked(authApi.requires2FA).mockReturnValue(false);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });
    });

    it('handles login error', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockRejectedValue(new ApiError('Invalid credentials', 401));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Invalid credentials');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });

    it('uses fallback login error message for non-ApiError failures', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockRejectedValue(new Error('network timeout'));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Login failed');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });

    it('triggers 2FA flow when required', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      });
    });
    });
  }

  function registerTwoFactorTests(): void {
    describe('Two-Factor Authentication', () => {
    it('verifies 2FA code successfully', async () => {
      const user = userEvent.setup();

      // First trigger 2FA
      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes');
      });

      // Now verify 2FA
      vi.mocked(twoFactorApi.verify2FA).mockResolvedValue({ user: mockUser });

      await user.click(screen.getByTestId('verify-2fa'));

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('no');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });
    });

    it('handles 2FA verification failure', async () => {
      const user = userEvent.setup();

      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes');
      });

      vi.mocked(twoFactorApi.verify2FA).mockRejectedValue(new ApiError('Invalid code', 400));

      await user.click(screen.getByTestId('verify-2fa'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Invalid code');
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes'); // Still pending
      });
    });

    it('uses fallback message when 2FA verification throws non-ApiError', async () => {
      const user = userEvent.setup();

      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes');
      });

      vi.mocked(twoFactorApi.verify2FA).mockRejectedValue(new Error('backend unavailable'));
      await user.click(screen.getByTestId('verify-2fa'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Invalid verification code');
      });
    });

    it('cancels 2FA flow', async () => {
      const user = userEvent.setup();

      vi.mocked(authApi.login).mockResolvedValue(mockTwoFactorResponse);
      vi.mocked(authApi.requires2FA).mockReturnValue(true);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes');
      });

      await user.click(screen.getByTestId('cancel-2fa'));

      expect(screen.getByTestId('2fa-pending')).toHaveTextContent('no');
    });

    it('returns error if verify2FA called without pending 2FA', async () => {
      const user = userEvent.setup();

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('verify-2fa'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('No 2FA verification pending');
      });
    });
    });
  }

  function registerRegistrationTests(): void {
    describe('Registration', () => {
    it('registers successfully', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.register).mockResolvedValue({ user: mockUser });

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('register'));

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });
    });

    it('handles registration error', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.register).mockRejectedValue(new ApiError('Username taken', 409));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('register'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Username taken');
      });
    });

    it('uses fallback registration error message for non-ApiError failures', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.register).mockRejectedValue(new Error('registration service down'));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('register'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Registration failed');
      });
    });
    });
  }

  function registerLogoutTests(): void {
    describe('Logout', () => {
    it('logs out user', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
      vi.mocked(authApi.requires2FA).mockReturnValue(false);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      // Login first
      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
      });

      // Then logout. Phase 4 expects both the backend call (authApi.logout)
      // and the refresh-module cleanup (triggerLogout) to run in lockstep.
      await user.click(screen.getByTestId('logout'));

      await waitFor(() => {
        expect(authApi.logout).toHaveBeenCalled();
        expect(mockTriggerLogout).toHaveBeenCalled();
      });
      expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
      expect(screen.getByTestId('user')).toHaveTextContent('null');
    });
    });
  }

  function registerPreferenceTests(): void {
    describe('Preferences', () => {
    it('updates preferences optimistically', async () => {
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
        expect(authApi.updatePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ darkMode: false })
        );
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
  }

  function registerErrorHandlingTests(): void {
    describe('Error handling', () => {
    it('clears error', async () => {
      const user = userEvent.setup();
      vi.mocked(authApi.login).mockRejectedValue(new ApiError('Error', 500));

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Error');
      });

      await user.click(screen.getByTestId('clear-error'));

      expect(screen.getByTestId('error')).toHaveTextContent('null');
    });
    });
  }

  function registerUseUserHookTests(): void {
    describe('useUser hook', () => {
    it('throws when used outside provider', () => {
      const TestComponent = () => {
        useUser();
        return null;
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<TestComponent />)).toThrow(
        'useUser must be used within UserProvider'
      );

      consoleSpy.mockRestore();
    });
    });
  }

  function registerSpecializedHookTests(): void {
    describe('Specialized hooks', () => {
    it('useAuth returns auth-related values', async () => {
      const user = userEvent.setup();

      const TestAuth = () => {
        const { isAuthenticated, isLoading, login } = useAuth();
        return (
          <div>
            <span data-testid="auth">{isAuthenticated.toString()}</span>
            <span data-testid="loading">{isLoading.toString()}</span>
            <button data-testid="login" onClick={() => login('user', 'pass')}>Login</button>
          </div>
        );
      };

      vi.mocked(authApi.login).mockResolvedValue({ user: mockUser });
      vi.mocked(authApi.requires2FA).mockReturnValue(false);

      render(<UserProvider><TestAuth /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('auth')).toHaveTextContent('false');

      await user.click(screen.getByTestId('login'));

      await waitFor(() => {
        expect(screen.getByTestId('auth')).toHaveTextContent('true');
      });
    });

    it('useCurrentUser returns user object', async () => {
      const TestCurrentUser = () => {
        const user = useCurrentUser();
        return <span data-testid="user">{user?.username ?? 'null'}</span>;
      };

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(<UserProvider><TestCurrentUser /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
      });
    });

    it('useUserPreferences returns preferences', async () => {
      const TestPrefs = () => {
        const { preferences, updatePreferences } = useUserPreferences();
        return (
          <div>
            <span data-testid="theme">{preferences?.theme ?? 'null'}</span>
            <button data-testid="update" onClick={() => updatePreferences({ theme: 'forest' })}>
              Update
            </button>
          </div>
        );
      };

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(<UserProvider><TestPrefs /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('theme')).toHaveTextContent('sanctuary');
      });
    });

    it('useTwoFactor returns 2FA state', async () => {
      const Test2FA = () => {
        const { twoFactorPending, cancel2FA } = useTwoFactor();
        return (
          <div>
            <span data-testid="pending">{twoFactorPending ? 'yes' : 'no'}</span>
            <button data-testid="cancel" onClick={cancel2FA}>Cancel</button>
          </div>
        );
      };

      render(<UserProvider><Test2FA /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('pending')).toHaveTextContent('no');
      });
    });
    });
  }

  function registerThemeApplicationTests(): void {
    describe('Theme application', () => {
    beforeEach(async () => {
      // Clear theme registry mocks before each theme test
      const { themeRegistry } = await import('../../themes');
      vi.mocked(themeRegistry.applyTheme).mockClear();
      vi.mocked(themeRegistry.applyPattern).mockClear();
      vi.mocked(themeRegistry.applyPatternOpacity).mockClear();
      // Also ensure document is in clean state (redundant but ensures isolation)
      document.documentElement.classList.remove('dark');
      // Reset auth mocks to prevent pollution from previous tests
      vi.mocked(authApi.getCurrentUser).mockReset();
    });

    it('applies user theme preferences', async () => {
      const { themeRegistry } = await import('../../themes');

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
      });

      // Wait for the theme effect to apply user preferences after state update
      await waitFor(() => {
        expect(themeRegistry.applyPattern).toHaveBeenCalledWith('minimal', 'sanctuary');
      });
      expect(themeRegistry.applyTheme).toHaveBeenCalledWith('sanctuary', 'dark', 0);
    });

    it('applies light mode when darkMode is false', async () => {
      const { themeRegistry } = await import('../../themes');

      const lightUser = {
        ...mockUser,
        preferences: { ...mockUser.preferences, darkMode: false },
      };

      vi.mocked(authApi.getCurrentUser).mockResolvedValue(lightUser);

      render(<UserProvider><TestConsumer /></UserProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('user')).toHaveTextContent('testuser');
      });

      // Wait for the theme effect to apply user preferences after state update
      await waitFor(() => {
        expect(themeRegistry.applyTheme).toHaveBeenCalledWith('sanctuary', 'light', 0);
      });
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    });
  }

  registerProviderInitializationTests();
  registerLoginTests();
  registerTwoFactorTests();
  registerRegistrationTests();
  registerLogoutTests();
  registerPreferenceTests();
  registerErrorHandlingTests();
  registerUseUserHookTests();
  registerSpecializedHookTests();
  registerThemeApplicationTests();
});
