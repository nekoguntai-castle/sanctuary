import { useState } from 'react';

/**
 * Drop-in for `src/hooks/useUserPreference` in tests that render without a
 * UserProvider: values persist across remounts (like server preferences) in a
 * module store that each test resets.
 */
const store = new Map<string, unknown>();

export function resetInMemoryUserPreferences(): void {
  store.clear();
}

export function useUserPreference<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : defaultValue));
  return [
    value,
    (next: T) => {
      store.set(key, next);
      setValue(next);
    },
  ];
}
