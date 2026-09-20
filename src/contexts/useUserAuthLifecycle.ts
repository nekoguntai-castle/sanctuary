import { useEffect } from 'react';
import type React from 'react';
import type { User } from '../types';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { onTerminalLogout } from '../api/refresh';
import { createLogger } from '../utils/logger';
import { toContextUser } from './userModel';

const log = createLogger('UserContext');

interface AuthBootstrapArgs {
  authEpochRef: { current: number };
  resetPreferenceTracking: () => void;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

export function useAuthBootstrap({
  authEpochRef,
  resetPreferenceTracking,
  setIsLoading,
  setUser,
}: AuthBootstrapArgs): void {
  // ADR 0001 / 0002: browser auth is cookie-backed. The frontend cannot
  // read the HttpOnly access cookie, so "am I authenticated?" is determined
  // by /auth/me. A 401 after the ApiClient has attempted refresh is the
  // normal unauthenticated boot state; any other failure is logged without
  // evicting credentials.
  useEffect(() => {
    let active = true;
    // Logout or a newer auth result invalidates this request's session view.
    const authEpoch = authEpochRef.current;
    const isCurrent = () => active && authEpochRef.current === authEpoch;
    const checkAuth = async () => {
      try {
        const currentUser = await authApi.getCurrentUser();
        if (isCurrent()) {
          resetPreferenceTracking();
          setUser(toContextUser(currentUser));
        }
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) {
          log.error('Auth check failed', { error: err });
        }
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    };

    void checkAuth();
    return () => { active = false; };
  }, [authEpochRef, resetPreferenceTracking, setIsLoading, setUser]);
}

export function useTerminalLogoutSubscription(clearSessionState: () => void): void {
  useEffect(() => onTerminalLogout(clearSessionState), [clearSessionState]);
}
