import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User, UserPreferences } from '../types';
import { themeRegistry } from '../themes';
import * as authApi from '../src/api/auth';
import * as twoFactorApi from '../src/api/twoFactor';
import { ApiError } from '../src/api/client';
import { onTerminalLogout, triggerLogout } from '../src/api/refresh';
import { createLogger } from '../utils/logger';

const log = createLogger('UserContext');

interface TwoFactorPending {
  tempToken: string;
}

interface LoginResult {
  success: boolean;
  requires2FA?: boolean;
  tempToken?: string;
}

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  twoFactorPending: TwoFactorPending | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  register: (username: string, password: string, email?: string) => Promise<boolean>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);

  // Check for existing authentication on mount.
  //
  // ADR 0001 / 0002 Phase 4: the browser has no access to the
  // HttpOnly access cookie, so "am I authenticated?" is determined by
  // calling /auth/me and interpreting the response. 200 → hydrate the
  // user object and schedule the next refresh from the
  // X-Access-Expires-At header (ApiClient forwards it automatically).
  // 401 after the ApiClient has attempted one refresh means the user is
  // not authenticated, so render the login screen. /auth/me is
  // refresh-eligible because it is both the boot probe and the
  // mid-session continuity check.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser as User);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Not authenticated — normal state on fresh boot. Render login.
        } else {
          log.error('Auth check failed', { error: err });
        }
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Subscribe to terminal logout broadcasts from the refresh module.
  //
  // Fires when:
  //   - Another tab explicitly logs out and broadcasts logout-broadcast
  //   - This tab or another tab hit a terminal refresh failure
  //     (revoked refresh token, user deleted, etc.)
  //
  // React to it by clearing local auth state. The backend cookies are
  // already cleared by the server response; there is nothing else for
  // the frontend to do besides updating the React tree.
  useEffect(() => {
    return onTerminalLogout(() => {
      setUser(null);
      setTwoFactorPending(null);
      setError(null);
    });
  }, []);

  // Initialize theme based on user preferences whenever user changes
  useEffect(() => {
    if (user && user.preferences) {
      const { darkMode, theme, background, contrastLevel, patternOpacity, flyoutOpacity } = user.preferences;

      // Toggle Dark Mode
      if (darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Apply theme using the theme registry (with contrast adjustment)
      const mode = darkMode ? 'dark' : 'light';
      themeRegistry.applyTheme(theme, mode, contrastLevel ?? 0);

      // Apply background pattern using the theme registry
      themeRegistry.applyPattern(background, theme);

      // Apply pattern opacity (default to 50 if not set)
      themeRegistry.applyPatternOpacity(patternOpacity ?? 50);

      // Apply flyout opacity (default to near-solid glass if not set)
      themeRegistry.applyFlyoutOpacity(flyoutOpacity ?? 92);

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    } else {
      // Default fallback (Login / Public)
      document.documentElement.classList.add('dark'); // Default to Dark
      themeRegistry.applyTheme('sanctuary', 'dark', 0);
      themeRegistry.applyPattern('sanctuary-hero', 'sanctuary');
      themeRegistry.applyPatternOpacity(50); // Default opacity
      themeRegistry.applyFlyoutOpacity(92); // Default flyout opacity

      // Add smooth transition
      document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
    }
  }, [user]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login({ username, password });

      // Check if 2FA is required
      if (authApi.requires2FA(response)) {
        setTwoFactorPending({ tempToken: response.tempToken });
        return { success: false, requires2FA: true, tempToken: response.tempToken };
      }

      // Full login success (no 2FA)
      setUser(response.user as User);
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      setError(message);
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const verify2FA = useCallback(async (code: string): Promise<boolean> => {
    if (!twoFactorPending) {
      setError('No 2FA verification pending');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await twoFactorApi.verify2FA({
        tempToken: twoFactorPending.tempToken,
        code,
      });
      setUser(response.user as User);
      setTwoFactorPending(null);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid verification code';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [twoFactorPending]);

  const cancel2FA = useCallback(() => {
    setTwoFactorPending(null);
    setError(null);
  }, []);

  const register = useCallback(async (username: string, password: string, email?: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const { user: authUser } = await authApi.register({ username, password, email });
      setUser(authUser as User);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Registration failed';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // Best-effort backend logout: revokes the session server-side and
    // clears the response cookies. Swallowed inside authApi.logout() so
    // a network failure does not prevent local cleanup.
    await authApi.logout();
    // Clear local refresh state (timer + in-memory expiry) and broadcast
    // the logout event so other tabs log out in lockstep.
    triggerLogout();
    setUser(null);
    setTwoFactorPending(null);
    setError(null);
  }, []);

  const updatePreferences = useCallback(async (newPrefs: Partial<UserPreferences>) => {
    setUser(currentUser => {
      if (!currentUser || !currentUser.preferences) return currentUser;

      const updatedPrefs = { ...currentUser.preferences, ...newPrefs };
      const updatedUser = { ...currentUser, preferences: updatedPrefs };

      // Async update in background
      authApi.updatePreferences(updatedPrefs)
        .then(apiUser => setUser(apiUser as User))
        .catch(err => {
          const message = err instanceof ApiError ? err.message : 'Failed to update preferences';
          setError(message);
          // Revert optimistic update on error
          setUser(currentUser);
        });

      return updatedUser; // Optimistic update
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<UserContextType>(() => ({
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    twoFactorPending,
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
    updatePreferences,
    clearError,
  }), [
    user,
    isLoading,
    error,
    twoFactorPending,
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
    updatePreferences,
    clearError,
  ]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within UserProvider');
  return context;
};

/**
 * Hook for components that only need authentication status
 * Reduces re-renders when user preferences change
 */
export const useAuth = () => {
  const { isAuthenticated, isLoading, error, login, logout, register, clearError } = useUser();
  return { isAuthenticated, isLoading, error, login, logout, register, clearError };
};

/**
 * Hook for components that only need the current user object
 */
export const useCurrentUser = () => {
  const { user } = useUser();
  return user;
};

/**
 * Hook for components that need user preferences
 */
export const useUserPreferences = () => {
  const { user, updatePreferences } = useUser();
  return {
    preferences: user?.preferences ?? null,
    updatePreferences,
  };
};

/**
 * Hook for two-factor authentication flow
 */
export const useTwoFactor = () => {
  const { twoFactorPending, verify2FA, cancel2FA } = useUser();
  return { twoFactorPending, verify2FA, cancel2FA };
};
