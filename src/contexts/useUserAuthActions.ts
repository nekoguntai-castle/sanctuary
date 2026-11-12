import { useCallback } from 'react';
import type React from 'react';
import type { User } from '../types';
import * as authApi from '../api/auth';
import * as twoFactorApi from '../api/twoFactor';
import { ApiError, apiErrorMessageOr } from '../api/client';
import { announceLogin, triggerLogout } from '../api/refresh';
import { clearQueryCacheForLogout } from '../providers/queryCacheReset';
import type {
  LoginResult,
  RegistrationResult,
  TwoFactorPending,
} from './userContextTypes';
import {
  applyHardwareWalletAttestationFromUser,
  clearHardwareWalletAttestation,
} from '../services/hardwareWallet/operatorAttestation';
import { toContextUser } from './userModel';
import type { PreferenceSaveResult } from './useUserPreferenceMutation';

interface UserAuthActionsArgs {
  invalidateAuthBootstrap: () => void;
  /** Counts logins made in other tabs; see usePeerLoginSubscription. */
  peerLoginSeqRef: { current: number };
  /** Drop this tab's session view and re-read it from the server. */
  resyncSession: () => void;
  resetPreferenceTracking: () => void;
  flushPreferenceWrites: () => Promise<PreferenceSaveResult>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setTwoFactorPending: React.Dispatch<React.SetStateAction<TwoFactorPending | null>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  twoFactorPending: TwoFactorPending | null;
}

interface UserAuthActions {
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  register: (username: string, password: string, email: string) => Promise<RegistrationResult>;
  logout: () => void;
}

/** The login 403 for an unverified account carries `emailVerificationRequired: true`. */
function isEmailVerificationRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.response?.emailVerificationRequired === true;
}

export function useUserAuthActions({
  invalidateAuthBootstrap,
  peerLoginSeqRef,
  resyncSession,
  resetPreferenceTracking,
  flushPreferenceWrites,
  setError,
  setIsLoading,
  setNotice,
  setTwoFactorPending,
  setUser,
  twoFactorPending,
}: UserAuthActionsArgs): UserAuthActions {
  // Adopt the session a login/2FA/registration response just established.
  // `peerLoginSeqAtStart` is the peer-login count from before the request: if
  // another tab logged in meanwhile, both logins raced on the server and this
  // response does not prove whose session the shared cookie holds, so the
  // session is re-read instead of trusted.
  const establishSession = useCallback((apiUser: Parameters<typeof toContextUser>[0], peerLoginSeqAtStart: number) => {
    if (peerLoginSeqRef.current !== peerLoginSeqAtStart) {
      resyncSession();
    } else {
      invalidateAuthBootstrap();
      resetPreferenceTracking();
      applyHardwareWalletAttestationFromUser(apiUser);
      setUser(toContextUser(apiUser));
    }
    // Other tabs share the session cookie and must follow this login.
    announceLogin(apiUser.id);
  }, [invalidateAuthBootstrap, peerLoginSeqRef, resetPreferenceTracking, resyncSession, setUser]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const peerLoginSeqAtStart = peerLoginSeqRef.current;
      const response = await authApi.login({ username, password });
      if (authApi.requires2FA(response)) {
        setTwoFactorPending({ tempToken: response.tempToken });
        return { success: false, requires2FA: true, tempToken: response.tempToken };
      }

      establishSession(response.user, peerLoginSeqAtStart);
      setNotice(null);
      return { success: true };
    } catch (err) {
      setError(apiErrorMessageOr(err, 'Login failed'));
      return { success: false, emailVerificationRequired: isEmailVerificationRequired(err) };
    } finally {
      setIsLoading(false);
    }
  }, [establishSession, peerLoginSeqRef, setError, setIsLoading, setNotice, setTwoFactorPending]);

  const verify2FA = useCallback(async (code: string): Promise<boolean> => {
    if (!twoFactorPending) {
      setError('No 2FA verification pending');
      return false;
    }

    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const peerLoginSeqAtStart = peerLoginSeqRef.current;
      const response = await twoFactorApi.verify2FA({
        tempToken: twoFactorPending.tempToken,
        code,
      });
      establishSession(response.user, peerLoginSeqAtStart);
      setTwoFactorPending(null);
      setNotice(null);
      return true;
    } catch (err) {
      setError(apiErrorMessageOr(err, 'Invalid verification code'));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [
    establishSession,
    peerLoginSeqRef,
    setError,
    setIsLoading,
    setNotice,
    setTwoFactorPending,
    twoFactorPending,
  ]);

  const cancel2FA = useCallback(() => {
    setTwoFactorPending(null);
    setError(null);
  }, [setError, setTwoFactorPending]);

  const register = useCallback(async (
    username: string,
    password: string,
    email: string,
  ): Promise<RegistrationResult> => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const peerLoginSeqAtStart = peerLoginSeqRef.current;
      const response = await authApi.register({ username, password, email });
      invalidateAuthBootstrap();
      if (authApi.isPendingEmailVerification(response)) {
        resetPreferenceTracking();
        clearHardwareWalletAttestation();
        setUser(null);
        setNotice(response.message);
        return {
          success: true,
          pendingVerification: true,
          message: response.message,
        };
      }

      establishSession(response.user, peerLoginSeqAtStart);
      setNotice(null);
      return { success: true };
    } catch (err) {
      const message = apiErrorMessageOr(err, 'Registration failed');
      setError(message);
      setNotice(null);
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  }, [establishSession, invalidateAuthBootstrap, peerLoginSeqRef, resetPreferenceTracking, setError, setIsLoading, setNotice, setUser]);

  const logout = useCallback(async () => {
    // Dispatch a preference toggled within the debounce window BEFORE the
    // session cookie is torn down — resetPreferenceTracking below drops
    // whatever is still buffered, and after logout the write is unrecoverable.
    //
    // Deliberately NOT awaited: the flush resolves only when the PATCH settles,
    // so awaiting it would let a slow or hanging request block logout
    // indefinitely. Calling it runs synchronously up to its own await, which is
    // enough to put the request on the wire while the cookie is still valid.
    void flushPreferenceWrites();
    await authApi.logout();
    invalidateAuthBootstrap();
    triggerLogout();
    resetPreferenceTracking();
    clearHardwareWalletAttestation();
    setUser(null);
    setTwoFactorPending(null);
    setError(null);
    setNotice(null);
    setIsLoading(false);
    // Runs after the user state is cleared above, so no authenticated query
    // can remount against the React Query cache before it is wiped.
    await clearQueryCacheForLogout();
  }, [flushPreferenceWrites, invalidateAuthBootstrap, resetPreferenceTracking, setError, setIsLoading, setNotice, setTwoFactorPending, setUser]);

  return {
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
  };
}
