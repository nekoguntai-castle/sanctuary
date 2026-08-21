import type { AgeBucket, CountBucket } from './protocol';

export function bucketCount(value: number): CountBucket {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value <= 1) return '1';
  if (value <= 5) return '2-5';
  if (value <= 20) return '6-20';
  if (value <= 100) return '21-100';
  return '101+';
}

export function bucketAge(timestamp: number | string | null, nowMs: number): AgeBucket {
  // The diagnostics protocol intentionally coarsens absent and unparseable
  // timestamps to the same non-sensitive bucket.
  if (timestamp === null) return 'never';
  const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(value)) return 'never';
  const age = Math.max(0, nowMs - value);
  if (age < 60_000) return '<1m';
  if (age < 15 * 60_000) return '1m-15m';
  if (age < 60 * 60_000) return '15m-1h';
  if (age < 24 * 60 * 60_000) return '1h-24h';
  return '1d+';
}
