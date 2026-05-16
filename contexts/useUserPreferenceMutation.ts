import { useCallback, useRef } from 'react';
import type React from 'react';
import type { User, UserPreferences } from '../types';
import * as authApi from '../src/api/auth';
import { ApiError } from '../src/api/client';
import {
  applyPreferenceRollback,
  asPreferenceRecord,
  capturePreferenceRollback,
  getPreferencePatchKeys,
  mergePreferencePatch,
} from '../utils/preferencePaths';
import { getUserPreferenceRecord, toContextUser } from './userModel';

type PreferenceGenerations = Record<string, number>;
type PendingPreferenceRequests = Record<number, string[]>;

interface PreferenceMutationArgs {
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  user: User | null;
}

interface PreferenceMutationController {
  resetPreferenceTracking: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
}

function hasNewerPreferenceWrite(generations: PreferenceGenerations, requestId: number): boolean {
  return Object.values(generations).some(generation => generation > requestId);
}

// Pending sibling writes keep their optimistic values while this request settles.
function hasOtherPendingPreferenceWrite(
  pendingRequests: PendingPreferenceRequests,
  requestId: number,
): boolean {
  return Object.keys(pendingRequests).some(pendingId => Number(pendingId) !== requestId);
}

// Preference writes are optimistic and may resolve out of order. The invariant:
// last write wins per top-level preference key, while in-flight sibling keys keep
// their local optimistic value until their own request resolves or rolls back.
function mergePreferenceResponseForRequest(
  currentUser: User,
  apiUser: authApi.User,
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

export function useUserPreferenceMutation({
  setError,
  setUser,
  user,
}: PreferenceMutationArgs): PreferenceMutationController {
  const userRef = useRef<User | null>(user);
  const preferenceSessionIdRef = useRef(0);
  const preferenceRequestIdRef = useRef(0);
  const preferenceGenerationsRef = useRef<PreferenceGenerations>({});
  const pendingPreferenceRequestsRef = useRef<PendingPreferenceRequests>({});
  userRef.current = user;

  const resetPreferenceTracking = useCallback(() => {
    preferenceSessionIdRef.current += 1;
    preferenceGenerationsRef.current = {};
    pendingPreferenceRequestsRef.current = {};
  }, []);

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
  }, [setError, setUser]);

  return {
    resetPreferenceTracking,
    updatePreferences,
  };
}
