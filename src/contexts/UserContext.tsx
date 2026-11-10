import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { User } from '../types';
import { useAuthBootstrap, useTerminalLogoutSubscription } from './useUserAuthLifecycle';
import { useUserTwoFactorActions } from './useUserTwoFactorActions';
import { useUserAuthActions } from './useUserAuthActions';
import { useUserPreferenceMutation } from './useUserPreferenceMutation';
import { useUserTheme } from './useUserTheme';
import type {
  TwoFactorPending,
  UserContextType,
} from './userContextTypes';
import { getUserPreferenceRecord } from './userModel';
import { clearQueryCacheForLogout } from '../providers/queryCacheReset';
import { websocketClient } from '../services/websocket';
import { clearHardwareWalletAttestation } from '../services/hardwareWallet/operatorAttestation';

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);
  const authEpochRef = useRef(0);
  const invalidateAuthBootstrap = useCallback(() => {
    authEpochRef.current += 1;
  }, []);
  const { resetPreferenceTracking, updatePreferences, flushPreferenceWrites } = useUserPreferenceMutation({
    setError,
    setUser,
    user,
  });

  useAuthBootstrap({ authEpochRef, resetPreferenceTracking, setIsLoading, setUser });

  const clearSessionState = useCallback(() => {
    invalidateAuthBootstrap();
    resetPreferenceTracking();
    clearHardwareWalletAttestation();
    setUser(null);
    setIsLoading(false);
    setTwoFactorPending(null);
    setError(null);
    setNotice(null);
    // Every logout path (explicit, forced after a failed refresh, another tab)
    // runs this listener. Close the live-update socket and drop its
    // subscriptions, or it reconnect-loops while logged out and replays the
    // previous user's channels; the next login's pages connect a fresh one.
    websocketClient.disconnect();
    // Runs after the user state is cleared above, so no authenticated query
    // can remount against the React Query cache before it is wiped. Not
    // awaited: clearSessionState is a synchronous terminal-logout listener,
    // and the helper never throws.
    void clearQueryCacheForLogout();
  }, [invalidateAuthBootstrap, resetPreferenceTracking]);

  useTerminalLogoutSubscription(clearSessionState);
  useUserTheme(user);

  const {
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
  } = useUserAuthActions({
    invalidateAuthBootstrap,
    resetPreferenceTracking,
    flushPreferenceWrites,
    setError,
    setIsLoading,
    setNotice,
    setTwoFactorPending,
    setUser,
    twoFactorPending,
  });

  const { enableTwoFactor, disableTwoFactor } = useUserTwoFactorActions({ user, setUser, authEpochRef });

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

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
    enableTwoFactor,
    disableTwoFactor,
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
    enableTwoFactor,
    disableTwoFactor,
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
