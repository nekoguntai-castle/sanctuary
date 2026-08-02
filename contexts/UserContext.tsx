import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { User } from '../types';
import { useAuthBootstrap, useTerminalLogoutSubscription } from './useUserAuthLifecycle';
import { useUserAuthActions } from './useUserAuthActions';
import { useUserPreferenceMutation } from './useUserPreferenceMutation';
import { useUserTheme } from './useUserTheme';
import type {
  TwoFactorPending,
  UserContextType,
} from './userContextTypes';
import { getUserPreferenceRecord } from './userModel';

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [twoFactorPending, setTwoFactorPending] = useState<TwoFactorPending | null>(null);
  const { resetPreferenceTracking, updatePreferences, flushPreferenceWrites } = useUserPreferenceMutation({
    setError,
    setUser,
    user,
  });

  useAuthBootstrap({ resetPreferenceTracking, setIsLoading, setUser });

  const clearSessionState = useCallback(() => {
    resetPreferenceTracking();
    setUser(null);
    setTwoFactorPending(null);
    setError(null);
    setNotice(null);
  }, [resetPreferenceTracking]);

  useTerminalLogoutSubscription(clearSessionState);
  useUserTheme(user);

  const {
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
  } = useUserAuthActions({
    resetPreferenceTracking,
    flushPreferenceWrites,
    setError,
    setIsLoading,
    setNotice,
    setTwoFactorPending,
    setUser,
    twoFactorPending,
  });

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
