import { useEffect } from 'react';
import type React from 'react';
import type { User } from '../types';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { onPeerLogin, onTerminalLogout } from '../api/refresh';
import { createLogger } from '../utils/logger';
import { applyHardwareWalletAttestationFromUser } from '../services/hardwareWallet/operatorAttestation';
import { toContextUser } from './userModel';

const log = createLogger('UserContext');

interface AuthBootstrapArgs {
  authEpochRef: { current: number };
  /** Changes when the session must be re-read from the server. */
  bootstrapRun: number;
  resetPreferenceTracking: () => void;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}

export function useAuthBootstrap({
  authEpochRef,
  bootstrapRun,
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
          applyHardwareWalletAttestationFromUser(currentUser);
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
  }, [authEpochRef, bootstrapRun, resetPreferenceTracking, setIsLoading, setUser]);
}

export function useTerminalLogoutSubscription(clearSessionState: () => void): void {
  useEffect(() => onTerminalLogout(clearSessionState), [clearSessionState]);
}

/**
 * Follow a login made in another tab. The session cookie is shared, so once
 * another tab logs in as a different user this tab's requests already run as
 * that user; `onSessionReplaced` must drop the old session view and re-read it.
 *
 * Every peer login is counted in `peerLoginSeqRef`, whoever it was for, so a
 * login request that was in flight in this tab can tell that it raced one.
 */
export function usePeerLoginSubscription(
  userIdRef: { current: string | null },
  peerLoginSeqRef: { current: number },
  onSessionReplaced: () => void,
): void {
  useEffect(() => onPeerLogin((userId) => {
    peerLoginSeqRef.current += 1;
    if (userIdRef.current !== userId) onSessionReplaced();
  }), [onSessionReplaced, peerLoginSeqRef, userIdRef]);
}
