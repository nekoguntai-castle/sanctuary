import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { User, UserPreferences } from '../types';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import {
  applyPreferenceRollback,
  asPreferenceRecord,
  capturePreferenceRollback,
  getPreferencePatchKeys,
  mergePreferencePatch,
  type PreferenceRecord,
  type PreferenceRollbackSnapshot,
} from '../utils/preferencePaths';
import { getUserPreferenceRecord, toContextUser } from './userModel';

type PreferenceGenerations = Record<string, number>;
type PendingPreferenceRequests = Record<number, string[]>;

/**
 * Writes are coalesced before they reach the network. Previously every caller
 * issued one `PATCH /auth/me/preferences` per invocation, and the highest-volume
 * callers are `<input type="range">` sliders (contrast, pattern opacity) whose
 * `onChange` fires on every step of a drag — so a single drag could issue ~100
 * requests against a route with no rate limiter.
 *
 * The optimistic apply stays synchronous, so nothing about perceived latency
 * changes; only the network call is deferred.
 *
 * DEBOUNCE_MS is the quiet period after the last write. MAX_WAIT_MS bounds how
 * long an unbroken stream of writes can defer persistence, so a slow drag still
 * saves periodically rather than only on release.
 */
export const PREFERENCE_WRITE_DEBOUNCE_MS = 300;
export const PREFERENCE_WRITE_MAX_WAIT_MS = 2000;

interface PreferenceBatch {
  /** Shallow merge of every patch coalesced into this batch. */
  patch: PreferenceRecord;
  /**
   * Values as they were before the batch's FIRST optimistic apply, so a failed
   * flush rolls the whole batch back rather than only its last write.
   */
  rollbackSnapshot: PreferenceRollbackSnapshot;
  /**
   * Allocated when the batch opens, so it is greater than any already in-flight
   * request id. An older request settling mid-batch therefore cannot adopt
   * server values for keys this batch has since claimed.
   */
  requestId: number;
  sessionId: number;
  userId: string;
  /** Settles when the flush completes, so callers that await still work. */
  settled: Promise<void>;
  resolve: () => void;
}

interface PreferenceMutationArgs {
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  user: User | null;
}

interface PreferenceMutationController {
  resetPreferenceTracking: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  /** Sends any buffered write immediately. Used before logout tears the session down. */
  flushPreferenceWrites: () => Promise<void>;
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

  const batchRef = useRef<PreferenceBatch | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBatchTimers = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current !== null) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const resetPreferenceTracking = useCallback(() => {
    // Drop any un-flushed batch instead of flushing it. This runs on login,
    // 2FA, register and logout: flushing would either write the previous user's
    // buffer under a new session, or block logout on a request that may never
    // resolve. The optimistic value is discarded with the session regardless.
    clearBatchTimers();
    batchRef.current?.resolve();
    batchRef.current = null;

    preferenceSessionIdRef.current += 1;
    preferenceGenerationsRef.current = {};
    pendingPreferenceRequestsRef.current = {};
  }, [clearBatchTimers]);

  const flushPreferenceBatch = useCallback(async () => {
    clearBatchTimers();

    const batch = batchRef.current;
    /* v8 ignore next -- defensive: flush clears its own timers, so a second
       invocation with nothing buffered is not reachable through the timer or
       unmount paths. */
    if (!batch) return;
    batchRef.current = null;

    const {
      patch: preferencePatch,
      rollbackSnapshot,
      requestId,
      sessionId: preferenceSessionId,
      userId,
      resolve,
    } = batch;
    const patchKeys = getPreferencePatchKeys(preferencePatch);

    try {
      const apiUser = await authApi.updatePreferences(preferencePatch);
      if (preferenceSessionIdRef.current !== preferenceSessionId) return;

      const hasOtherPendingWrite = hasOtherPendingPreferenceWrite(
        pendingPreferenceRequestsRef.current,
        requestId,
      );
      delete pendingPreferenceRequestsRef.current[requestId];

      setUser(latestUser => {
        if (!latestUser || latestUser.id !== userId || apiUser.id !== userId) {
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
        if (!latestUser || latestUser.id !== userId) {
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
    } finally {
      resolve();
    }
  }, [clearBatchTimers, setError, setUser]);

  // Persist whatever is still buffered when the provider unmounts, but send the
  // request ONLY — deliberately skipping the settle path, because resolving a
  // response into setUser/setError after unmount would update state on a torn
  // down tree. Fire and forget: cleanup cannot await, and the tree is going
  // away regardless.
  useEffect(() => {
    return () => {
      clearBatchTimers();
      const batch = batchRef.current;
      batchRef.current = null;
      if (!batch) return;
      batch.resolve();
      void authApi.updatePreferences(batch.patch).catch(() => {
        // Nothing left to surface the failure to.
      });
    };
  }, [clearBatchTimers]);

  const updatePreferences = useCallback(
    (newPrefs: Partial<UserPreferences>): Promise<void> => {
      const currentUser = userRef.current;
      if (!currentUser) return Promise.resolve();

      const preferencePatch = asPreferenceRecord(newPrefs);
      const patchKeys = getPreferencePatchKeys(preferencePatch);
      if (patchKeys.length === 0) return Promise.resolve();

      const preferenceSessionId = preferenceSessionIdRef.current;
      let batch = batchRef.current;

      // A batch belongs to exactly one user and session epoch. Anything else
      // starts a fresh one rather than merging across the boundary.
      if (
        !batch ||
        batch.sessionId !== preferenceSessionId ||
        batch.userId !== currentUser.id
      ) {
        // Discarding a live batch must settle its promise and disarm its
        // timers; otherwise an awaiting caller hangs forever and the orphaned
        // max-wait timer flushes the next batch early.
        /* v8 ignore next 4 -- unreachable today: every session/user change goes
           through resetPreferenceTracking, which nulls the batch first, so the
           !batch disjunct always short-circuits. Kept because this guard was
           previously missing and would hang an awaiting caller if it ever is. */
        if (batch) {
          clearBatchTimers();
          batch.resolve();
        }

        const requestId = preferenceRequestIdRef.current + 1;
        preferenceRequestIdRef.current = requestId;

        let resolve!: () => void;
        const settled = new Promise<void>(res => {
          resolve = res;
        });

        batch = {
          patch: {},
          rollbackSnapshot: {},
          requestId,
          sessionId: preferenceSessionId,
          userId: currentUser.id,
          settled,
          resolve,
        };
        batchRef.current = batch;
      }

      // Earliest snapshot per key wins, so a failed flush rolls the whole batch
      // back to the values that preceded its first write.
      const snapshot = capturePreferenceRollback(currentUser.preferences, patchKeys);
      for (const [key, entry] of Object.entries(snapshot)) {
        if (!Object.prototype.hasOwnProperty.call(batch.rollbackSnapshot, key)) {
          batch.rollbackSnapshot[key] = entry;
        }
      }

      batch.patch = { ...batch.patch, ...preferencePatch };

      // Re-stamp on every write so the batch keeps ownership of its keys, and
      // keep the batch visible to in-flight siblings deciding whether to adopt
      // server values.
      for (const key of getPreferencePatchKeys(batch.patch)) {
        preferenceGenerationsRef.current[key] = batch.requestId;
      }
      pendingPreferenceRequestsRef.current[batch.requestId] = getPreferencePatchKeys(batch.patch);

      const updatedUser = {
        ...currentUser,
        preferences: mergePreferencePatch(currentUser.preferences, preferencePatch),
      };
      userRef.current = updatedUser;
      setUser(updatedUser);

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void flushPreferenceBatch();
      }, PREFERENCE_WRITE_DEBOUNCE_MS);

      // Only armed once per batch, so an unbroken stream of writes still
      // persists on a bounded cadence instead of only when it stops.
      if (maxWaitTimerRef.current === null) {
        maxWaitTimerRef.current = setTimeout(() => {
          void flushPreferenceBatch();
        }, PREFERENCE_WRITE_MAX_WAIT_MS);
      }

      return batch.settled;
    },
    [setUser],
  );

  return {
    resetPreferenceTracking,
    updatePreferences,
    flushPreferenceWrites: flushPreferenceBatch,
  };
}
