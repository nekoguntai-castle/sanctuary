import { parseStrictIsoInstant } from '../../utils/isoInstant';

export interface MergeableWalletLogEntry {
  id: string;
  timestamp: string;
}

const DEFAULT_MAX_ENTRIES = 500;
const MAX_MAX_ENTRIES = 500;

export function normalizeWalletLogMaxEntries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_ENTRIES;
  }

  return Math.min(Math.trunc(value), MAX_MAX_ENTRIES);
}

function isoTimestampValue(timestamp: string): number | null {
  return parseStrictIsoInstant(timestamp);
}

function compareWalletLogs<T extends MergeableWalletLogEntry>(left: T, right: T): number {
  const leftTime = isoTimestampValue(left.timestamp);
  const rightTime = isoTimestampValue(right.timestamp);

  if (leftTime === null) return rightTime === null ? 0 : 1;
  if (rightTime === null) return -1;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}

export function mergeWalletLogEntries<T extends MergeableWalletLogEntry>(
  current: readonly T[],
  incoming: readonly T[],
  maxEntries: number,
): T[] {
  if (maxEntries === 0) return [];

  const byId = new Map<string, T>();
  for (const entry of [...current, ...incoming]) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  const ordered = [...byId.values()].sort(compareWalletLogs);
  return ordered.length > maxEntries ? ordered.slice(-maxEntries) : ordered;
}
