import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import * as twoFactorApi from '../api/twoFactor';
import { createRequestOwnership } from '../hooks/requestOwnership';
import type { User } from '../types';

interface TwoFactorActionsArgs {
  user: User | null;
  setUser: Dispatch<SetStateAction<User | null>>;
  authEpochRef: MutableRefObject<number>;
}

/** Management results belong to the authenticated session, not the Account route. */
export function useUserTwoFactorActions({ user, setUser, authEpochRef }: TwoFactorActionsArgs) {
  const [lifetime] = useState(() => createRequestOwnership('two-factor'));
  const mounted = useRef(true);
  const currentUser = useRef(user);
  currentUser.current = user;
  const pending = useRef<{ epoch: number; lifetimeEpoch: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.invalidate();
    };
  }, [lifetime]);

  const run = useCallback(async <T,>(enabled: boolean, request: () => Promise<T>): Promise<T | null> => {
    const userId = currentUser.current?.id;
    if (!userId || !mounted.current) return null;
    const epoch = authEpochRef.current;
    const token = lifetime.captureRoute('two-factor');
    if (pending.current?.epoch === epoch && pending.current.lifetimeEpoch === token.routeEpoch) return null;
    const operation = { epoch, lifetimeEpoch: token.routeEpoch };
    pending.current = operation;
    const ownsSession = () => mounted.current && authEpochRef.current === epoch && lifetime.isRouteOwner(token);
    try {
      const result = await request();
      if (!ownsSession() || currentUser.current?.id !== userId) return null;
      // React may defer this updater until after finally releases admission.
      // Session/lifetime ownership therefore does not depend on pending.current.
      setUser(latest => !ownsSession() || latest?.id !== userId
        ? latest
        : { ...latest, twoFactorEnabled: enabled });
      return result;
    } catch (error) {
      if (!ownsSession() || currentUser.current?.id !== userId) return null;
      throw error;
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  }, [authEpochRef, lifetime, setUser]);

  const enableTwoFactor = useCallback((code: string) => run(true, () => twoFactorApi.enable2FA(code)), [run]);
  const disableTwoFactor = useCallback((data: twoFactorApi.TwoFactorDisableRequest) => (
    run(false, () => twoFactorApi.disable2FA(data))
  ), [run]);
  return { enableTwoFactor, disableTwoFactor };
}
