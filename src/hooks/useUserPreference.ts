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

import { useState, useCallback } from 'react';
import { useCurrentUser, useUserPreferences } from '../contexts/UserContext';
import { createLogger } from '../utils/logger';
import { safeJsonParse } from '../utils/safeJson';
import {
  asPreferenceRecord,
  buildPreferencePathPatch,
  getPreferencePathValue,
} from '../utils/preferencePaths';

const log = createLogger('useUserPreference');

const STORAGE_PREFIX = 'sanctuary_pref_';

function readLocalPreference<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (stored !== null) {
      const parsed = safeJsonParse(stored);
      if (parsed.success) {
        return parsed.data as T;
      }
    }
  } catch (err) {
    log.debug('Failed to read localStorage preference', { key, error: err });
  }
  return defaultValue;
}

export function useUserPreference<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const user = useCurrentUser();
  const { preferences, updatePreferences } = useUserPreferences();
  const isLoggedIn = !!user;
  const serverPreferences = asPreferenceRecord(preferences);

  // Key-scoped local value so switching `key` re-reads localStorage immediately
  // without persisting stale values under the new key or writing on mount.
  const [storedEntry, setStoredEntry] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readLocalPreference(key, defaultValue),
  }));
  const localValue = storedEntry.key === key
    ? storedEntry.value
    : readLocalPreference(key, defaultValue);

  // Derive the current value: server preferences take priority when logged in
  const serverValue = isLoggedIn
    ? (getPreferencePathValue(serverPreferences, key) as T | undefined)
    : undefined;

  const currentValue = isLoggedIn
    ? (serverValue !== undefined ? serverValue : defaultValue)
    : localValue;

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
        setStoredEntry({ key, value: newValue });
        try {
          localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(newValue));
        } catch (err) {
          log.debug('Failed to write localStorage preference', { key, error: err });
        }
      }
    },
    [isLoggedIn, serverPreferences, key, updatePreferences]
  );

  return [currentValue, setValue];
}
