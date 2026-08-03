export type PreferenceRecord = Record<string, unknown>;

export interface PreferenceRollbackEntry {
  existed: boolean;
  value: unknown;
}

export type PreferenceRollbackSnapshot = Record<string, PreferenceRollbackEntry>;

// These keys can mutate object prototypes when assigned through dynamic paths.
const UNSAFE_PREFERENCE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isPreferenceRecord(value: unknown): value is PreferenceRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asPreferenceRecord(value: unknown): PreferenceRecord {
  return isPreferenceRecord(value) ? value : {};
}

function assertSafePreferenceKey(key: string): void {
  if (key.length === 0) {
    throw new Error('Preference path cannot contain empty segments');
  }
  if (UNSAFE_PREFERENCE_KEYS.has(key)) {
    throw new Error(`Preference path contains unsafe segment: ${key}`);
  }
}

export function parsePreferencePath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Preference path must be a non-empty string');
  }

  const keys = path.split('.');
  for (const key of keys) {
    assertSafePreferenceKey(key);
  }
  return keys;
}

/** Reads a dot-path value from preferences without treating arrays as objects. */
export function getPreferencePathValue(preferences: unknown, path: string): unknown {
  const keys = parsePreferencePath(path);
  let current: unknown = asPreferenceRecord(preferences);

  for (const key of keys) {
    if (!isPreferenceRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

function buildNestedPreferencePatch(
  keys: string[],
  value: unknown,
  existing: PreferenceRecord,
): PreferenceRecord {
  const [key, ...rest] = keys;
  if (rest.length === 0) {
    return { [key]: value };
  }

  const existingChild = asPreferenceRecord(existing[key]);
  return {
    [key]: {
      ...existingChild,
      ...buildNestedPreferencePatch(rest, value, existingChild),
    },
  };
}

/** Builds a top-level patch that preserves existing object siblings along the path. */
export function buildPreferencePathPatch(
  path: string,
  value: unknown,
  existingPreferences: unknown,
): PreferenceRecord {
  return buildNestedPreferencePatch(
    parsePreferencePath(path),
    value,
    asPreferenceRecord(existingPreferences),
  );
}

/** Returns validated top-level patch keys for generation and rollback tracking. */
export function getPreferencePatchKeys(patch: PreferenceRecord): string[] {
  const keys = Object.keys(patch);
  for (const key of keys) {
    assertSafePreferenceKey(key);
  }
  return keys;
}

/** Applies the backend's top-level preference patch semantics on the client. */
export function mergePreferencePatch(
  preferences: unknown,
  patch: PreferenceRecord,
): PreferenceRecord {
  return {
    ...asPreferenceRecord(preferences),
    ...patch,
  };
}

/** Captures previous top-level values so failed optimistic writes can roll back narrowly. */
export function capturePreferenceRollback(
  preferences: unknown,
  keys: string[],
): PreferenceRollbackSnapshot {
  const current = asPreferenceRecord(preferences);
  return Object.fromEntries(
    keys.map(key => [
      key,
      {
        existed: Object.prototype.hasOwnProperty.call(current, key),
        value: current[key],
      },
    ]),
  );
}

/** Restores captured keys that are still owned by the failed request generation. */
export function applyPreferenceRollback(
  preferences: unknown,
  snapshot: PreferenceRollbackSnapshot,
  shouldRollback: (key: string) => boolean,
): PreferenceRecord {
  const next = { ...asPreferenceRecord(preferences) };

  for (const [key, entry] of Object.entries(snapshot)) {
    if (!shouldRollback(key)) continue;

    if (entry.existed) {
      next[key] = entry.value;
    } else {
      delete next[key];
    }
  }

  return next;
}
