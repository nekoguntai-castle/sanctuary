import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User, UserPreferences } from '../types';
import type { AuthUser } from '@sanctuary/shared/types/api';
import { themeRegistry } from '../themes';
import * as authApi from '../src/api/auth';
import * as twoFactorApi from '../src/api/twoFactor';
import { ApiError } from '../src/api/client';
import { onTerminalLogout, triggerLogout } from '../src/api/refresh';
import { createLogger } from '../utils/logger';
import {
  applyPreferenceRollback,
  asPreferenceRecord,
  capturePreferenceRollback,
  getPreferencePatchKeys,
  mergePreferencePatch,
  type PreferenceRecord,
} from '../utils/preferencePaths';

const log = createLogger('UserContext');

const DEFAULT_AUTHENTICATED_PREFERENCES: UserPreferences = {
  darkMode: true,
  theme: 'sanctuary',
  background: 'zen',
  unit: 'sats',
  fiatCurrency: 'USD',
  showFiat: true,
  priceProvider: 'auto',
};

type UserPreferenceRecord = Partial<UserPreferences> & PreferenceRecord;
type PreferenceGenerations = Record<string, number>;
type PendingPreferenceRequests = Record<number, string[]>;

function getUserPreferenceRecord(user: User): UserPreferenceRecord {
  return asPreferenceRecord(user.preferences) as UserPreferenceRecord;
}

function toContextUser(apiUser: AuthUser): User {
  return {
    id: apiUser.id,
    username: apiUser.username,
    email: apiUser.email,
    emailVerified: apiUser.emailVerified,
    isAdmin: apiUser.isAdmin,
    preferences: apiUser.preferences,
    createdAt: apiUser.createdAt,
    twoFactorEnabled: apiUser.twoFactorEnabled,
    usingDefaultPassword: apiUser.usingDefaultPassword,
  };
}

function hasNewerPreferenceWrite(generations: PreferenceGenerations, requestId: number): boolean {
  return Object.values(generations).some(generation => generation > requestId);
}

// Preference writes are optimistic and may resolve out of order. The invariant:
// last write wins per top-level preference key, while in-flight sibling keys keep
// their local optimistic value until their own request resolves or rolls back.
function hasOtherPendingPreferenceWrite(
  pendingRequests: PendingPreferenceRequests,
  requestId: number,
): boolean {
  return Object.keys(pendingRequests).some(pendingId => Number(pendingId) !== requestId);
}

function mergePreferenceResponseForRequest(
  currentUser: User,
  apiUser: AuthUser,
  patchKeys: string[],
  requestId: number,
  generations: PreferenceGenerations,
  hasOtherPendingWrite: boolean,
): User {
  const serverUser = toContextUser(apiUser);
  const baseUser: User = {
    ...currentUser,
    ...serverUser,
    emailVerified: serverUser.emailVerified ?? currentUser.emailVerified,
    usingDefaultPassword: serverUser.usingDefaultPassword ?? currentUser.usingDefaultPassword,
  };

  if (!hasOtherPendingWrite && !hasNewerPreferenceWrite(generations, requestId)) {
    return baseUser;
  }

  const nextPreferences = { ...getUserPreferenceRecord(currentUser) };
  const serverPreferences = asPreferenceRecord(serverUser.preferences);

  for (const key of patchKeys) {
    if (generations[key] !== requestId) continue;

    if (Object.prototype.hasOwnProperty.call(serverPreferences, key)) {
      nextPreferences[key] = serverPreferences[key];
    } else {
      delete nextPreferences[key];
    }
  }

  return {
    ...baseUser,
    preferences: nextPreferences,
  };
}

interface TwoFactorPending {
  tempToken: string;
}

interface LoginResult {
  success: boolean;
  requires2FA?: boolean;
  tempToken?: string;
}

/**
 * Result of submitting the registration form. When `pendingVerification` is
 * true, the account was created but no authenticated session was started.
 */
interface RegistrationResult {
  success: boolean;
  pendingVerification?: boolean;
  message?: string;
}

interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  notice: string | null;
  twoFactorPending: TwoFactorPending | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  register: (username: string, password: string, email: string) => Promise<RegistrationResult>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);
  const userRef = useRef<User | null>(null);
  const preferenceSessionIdRef = useRef(0);
  const preferenceRequestIdRef = useRef(0);
  const preferenceGenerationsRef = useRef<PreferenceGenerations>({});
  const pendingPreferenceRequestsRef = useRef<PendingPreferenceRequests>({});

  // Preference requests can outlive logout or re-login. Bump this auth-session
  // epoch when identity state is refreshed so stale responses cannot mutate it.
  const resetPreferenceTracking = useCallback(() => {
    preferenceSessionIdRef.current += 1;
    preferenceGenerationsRef.current = {};
    pendingPreferenceRequestsRef.current = {};
  }, []);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Check for existing authentication on mount.
  //
  // ADR 0001 / 0002: browser auth is cookie-backed. The frontend cannot
  // read the HttpOnly access cookie, so "am I authenticated?" is
  // determined by calling /auth/me and interpreting the response. 200 → hydrate the
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
        resetPreferenceTracking();
        setUser(toContextUser(currentUser));
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
  }, [resetPreferenceTracking]);

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
      resetPreferenceTracking();
      setUser(null);
      setTwoFactorPending(null);
      setError(null);
      setNotice(null);
    });
  }, [resetPreferenceTracking]);

  // Initialize theme based on user preferences whenever user changes
  useEffect(() => {
    if (user) {
      const preferences = {
        ...DEFAULT_AUTHENTICATED_PREFERENCES,
        ...getUserPreferenceRecord(user),
      };
      const { darkMode, theme, background, contrastLevel, patternOpacity, flyoutOpacity } = preferences;

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
    setNotice(null);

    try {
      const response = await authApi.login({ username, password });

      // Check if 2FA is required
      if (authApi.requires2FA(response)) {
        setTwoFactorPending({ tempToken: response.tempToken });
        return { success: false, requires2FA: true, tempToken: response.tempToken };
      }

      // Full login success (no 2FA)
      resetPreferenceTracking();
      setUser(toContextUser(response.user));
      setNotice(null);
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed';
      setError(message);
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  }, [resetPreferenceTracking]);

  const verify2FA = useCallback(async (code: string): Promise<boolean> => {
    if (!twoFactorPending) {
      setError('No 2FA verification pending');
      return false;
    }

    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await twoFactorApi.verify2FA({
        tempToken: twoFactorPending.tempToken,
        code,
      });
      resetPreferenceTracking();
      setUser(toContextUser(response.user));
      setTwoFactorPending(null);
      setNotice(null);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid verification code';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [resetPreferenceTracking, twoFactorPending]);

  const cancel2FA = useCallback(() => {
    setTwoFactorPending(null);
    setError(null);
  }, []);

  const register = useCallback(async (username: string, password: string, email: string): Promise<RegistrationResult> => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await authApi.register({ username, password, email });
      if (authApi.isPendingEmailVerification(response)) {
        resetPreferenceTracking();
        setUser(null);
        setNotice(response.message);
        return {
          success: true,
          pendingVerification: true,
          message: response.message,
        };
      }

      resetPreferenceTracking();
      setUser(toContextUser(response.user));
      setNotice(null);
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Registration failed';
      setError(message);
      setNotice(null);
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  }, [resetPreferenceTracking]);

  const logout = useCallback(async () => {
    // Best-effort backend logout: revokes the session server-side and
    // clears the response cookies. Swallowed inside authApi.logout() so
    // a network failure does not prevent local cleanup.
    await authApi.logout();
    // Clear local refresh state (timer + in-memory expiry) and broadcast
    // the logout event so other tabs log out in lockstep.
    triggerLogout();
    resetPreferenceTracking();
    setUser(null);
    setTwoFactorPending(null);
    setError(null);
    setNotice(null);
  }, [resetPreferenceTracking]);

  const updatePreferences = useCallback(async (newPrefs: Partial<UserPreferences>) => {
    const currentUser = userRef.current;
    if (!currentUser) return;

    const preferencePatch = asPreferenceRecord(newPrefs);
    const patchKeys = getPreferencePatchKeys(preferencePatch);
    if (patchKeys.length === 0) return;

    const preferenceSessionId = preferenceSessionIdRef.current;
    const requestId = preferenceRequestIdRef.current + 1;
    preferenceRequestIdRef.current = requestId;

    for (const key of patchKeys) {
      preferenceGenerationsRef.current[key] = requestId;
    }
    pendingPreferenceRequestsRef.current[requestId] = patchKeys;

    const rollbackSnapshot = capturePreferenceRollback(currentUser.preferences, patchKeys);
    const updatedUser = {
      ...currentUser,
      preferences: mergePreferencePatch(currentUser.preferences, preferencePatch),
    };

    userRef.current = updatedUser;
    setUser(updatedUser);

    try {
      const apiUser = await authApi.updatePreferences(preferencePatch);
      if (preferenceSessionIdRef.current !== preferenceSessionId) return;

      const hasOtherPendingWrite = hasOtherPendingPreferenceWrite(
        pendingPreferenceRequestsRef.current,
        requestId,
      );
      delete pendingPreferenceRequestsRef.current[requestId];

      setUser(latestUser => {
        if (!latestUser || latestUser.id !== currentUser.id || apiUser.id !== currentUser.id) {
          userRef.current = latestUser;
          return latestUser;
        }

        const nextUser = mergePreferenceResponseForRequest(
          latestUser,
          apiUser,
          patchKeys,
          requestId,
          preferenceGenerationsRef.current,
          hasOtherPendingWrite,
        );
        userRef.current = nextUser;
        return nextUser;
      });
    } catch (err) {
      if (preferenceSessionIdRef.current !== preferenceSessionId) return;

      delete pendingPreferenceRequestsRef.current[requestId];
      const message = err instanceof ApiError ? err.message : 'Failed to update preferences';
      setError(message);

      setUser(latestUser => {
        /* v8 ignore next 4 -- defensive guard if auth state changes outside the tracked session epoch. */
        if (!latestUser || latestUser.id !== currentUser.id) {
          userRef.current = latestUser;
          return latestUser;
        }

        const nextUser = {
          ...latestUser,
          preferences: applyPreferenceRollback(
            latestUser.preferences,
            rollbackSnapshot,
            key => preferenceGenerationsRef.current[key] === requestId,
          ),
        };
        userRef.current = nextUser;
        return nextUser;
      });
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<UserContextType>(() => ({
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    notice,
    twoFactorPending,
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
    updatePreferences,
    clearError,
    clearNotice,
  }), [
    user,
    isLoading,
    error,
    notice,
    twoFactorPending,
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
    updatePreferences,
    clearError,
    clearNotice,
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
  const { isAuthenticated, isLoading, error, notice, login, logout, register, clearError, clearNotice } = useUser();
  return { isAuthenticated, isLoading, error, notice, login, logout, register, clearError, clearNotice };
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
    preferences: user ? getUserPreferenceRecord(user) : null,
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
