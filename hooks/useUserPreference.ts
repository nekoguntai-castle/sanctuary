/**
 * useUserPreference - Abstracts server vs localStorage preference fallback
 *
 * When user is logged in: reads/writes to server-side user preferences via UserContext
 * When not logged in: falls back to localStorage
 *
 * Supports dot-notation keys for nested preferences (e.g., 'viewSettings.wallets.layout').
 *
 * @example
 * // Simple top-level preference
 * const [darkMode, setDarkMode] = useUserPreference('darkMode', false);
 *
 * // Nested preference with dot notation
 * const [layout, setLayout] = useUserPreference('viewSettings.wallets.layout', 'grid');
 */

import { useState, useCallback, useEffect } from 'react';
import { useCurrentUser, useUserPreferences } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';
import {
  asPreferenceRecord,
  buildPreferencePathPatch,
  getPreferencePathValue,
} from '../utils/preferencePaths';

const log = createLogger('useUserPreference');

const STORAGE_PREFIX = 'sanctuary_pref_';

export function useUserPreference<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const user = useCurrentUser();
  const { preferences, updatePreferences } = useUserPreferences();
  const isLoggedIn = !!user;
  const serverPreferences = asPreferenceRecord(preferences);

  // Read initial value from localStorage for unauthenticated fallback
  const [localValue, setLocalValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch (err) {
      log.debug('Failed to read localStorage preference', { key, error: err });
    }
    return defaultValue;
  });

  // Derive the current value: server preferences take priority when logged in
  const serverValue = isLoggedIn
    ? (getPreferencePathValue(serverPreferences, key) as T | undefined)
    : undefined;

  const currentValue = isLoggedIn
    ? (serverValue !== undefined ? serverValue : defaultValue)
    : localValue;

  // Sync localStorage when the local value changes (unauthenticated mode)
  useEffect(() => {
    if (!isLoggedIn) {
      try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(localValue));
      } catch (err) {
        log.debug('Failed to write localStorage preference', { key, error: err });
      }
    }
  }, [isLoggedIn, localValue, key]);

  const setValue = useCallback(
    (newValue: T) => {
      if (isLoggedIn) {
        const update = buildPreferencePathPatch(
          key,
          newValue,
          serverPreferences
        );
        updatePreferences(update);
      } else {
        setLocalValue(newValue);
      }
    },
    [isLoggedIn, serverPreferences, key, updatePreferences]
  );

  return [currentValue, setValue];
}
