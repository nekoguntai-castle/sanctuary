import { useCallback } from 'react';
import type React from 'react';
import type { User } from '../types';
import * as authApi from '../src/api/auth';
import * as twoFactorApi from '../src/api/twoFactor';
import { ApiError } from '../src/api/client';
import { triggerLogout } from '../src/api/refresh';
import type {
  LoginResult,
  RegistrationResult,
  TwoFactorPending,
} from './userContextTypes';
import { toContextUser } from './userModel';

interface UserAuthActionsArgs {
  resetPreferenceTracking: () => void;
  flushPreferenceWrites: () => Promise<void>;
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

function getApiMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function useUserAuthActions({
  resetPreferenceTracking,
  flushPreferenceWrites,
  setError,
  setIsLoading,
  setNotice,
  setTwoFactorPending,
  setUser,
  twoFactorPending,
}: UserAuthActionsArgs): UserAuthActions {
  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await authApi.login({ username, password });
      if (authApi.requires2FA(response)) {
        setTwoFactorPending({ tempToken: response.tempToken });
        return { success: false, requires2FA: true, tempToken: response.tempToken };
      }

      resetPreferenceTracking();
      setUser(toContextUser(response.user));
      setNotice(null);
      return { success: true };
    } catch (err) {
      setError(getApiMessage(err, 'Login failed'));
      return { success: false };
    } finally {
      setIsLoading(false);
    }
  }, [resetPreferenceTracking, setError, setIsLoading, setNotice, setTwoFactorPending, setUser]);

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
      setError(getApiMessage(err, 'Invalid verification code'));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [
    resetPreferenceTracking,
    setError,
    setIsLoading,
    setNotice,
    setTwoFactorPending,
    setUser,
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
      const message = getApiMessage(err, 'Registration failed');
      setError(message);
      setNotice(null);
      return { success: false, message };
    } finally {
      setIsLoading(false);
    }
  }, [resetPreferenceTracking, setError, setIsLoading, setNotice, setUser]);

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
    triggerLogout();
    resetPreferenceTracking();
    setUser(null);
    setTwoFactorPending(null);
    setError(null);
    setNotice(null);
  }, [flushPreferenceWrites, resetPreferenceTracking, setError, setNotice, setTwoFactorPending, setUser]);

  return {
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
  };
}
