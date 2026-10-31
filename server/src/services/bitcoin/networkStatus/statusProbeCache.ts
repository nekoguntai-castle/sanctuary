/**
 * Short-TTL, single-flight cache for network-status probe outcomes.
 *
 * `getBitcoinNetworkStatus` backs the unauthenticated GET /bitcoin/status
 * route and the assistant's get_bitcoin_network_status tool. Without a cache
 * every call dialled the node: a fresh direct Electrum client in singleton
 * mode, or a pool probe whose timeouts feed the pool circuit breaker.
 *
 * - Entries are keyed by network plus a fingerprint of every input that
 *   changes the probe (mode, connection config, eligible servers), so a
 *   config edit read on the next call misses the cache by construction.
 * - `invalidateNetworkStatusCache` is called from the node-client reset that
 *   follows a node-config change; a probe that was in flight across the
 *   reset is returned to its callers but never stored.
 * - Failed probes are cached for a shorter TTL so an unreachable server is
 *   not re-dialled per request but recovery is still noticed quickly.
 *
 * This module is a leaf (no bitcoin-service imports) so nodeClient can call
 * the invalidation hook without an import cycle.
 */

import { singleFlight } from '../../../utils/async';

/**
 * Successful probe TTL. The dashboard polls /bitcoin/status every 60 s and
 * marks data "last known" after 120 s; 15 s keeps every poll well inside that
 * window and under the 30 s default pool health-check interval, while capping
 * upstream probes at 4/min per network regardless of request rate.
 */
export const NETWORK_STATUS_SUCCESS_TTL_MS = 15_000;
/** Failed probe TTL: bounds re-dials of a down server to 12/min per network. */
export const NETWORK_STATUS_FAILURE_TTL_MS = 5_000;

/**
 * Expiry is measured on the monotonic clock: a wall-clock step back (NTP
 * correction, manual change) must not extend a cached success past its TTL.
 */
const monotonicNow = (): number => performance.now();

interface CacheEntry {
  fingerprint: string;
  value: unknown;
  expiresAt: number;
}

/** At most one entry per network: a new fingerprint replaces the old one. */
const entries = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;

function cachedValue<T>(network: string, fingerprint: string): T | undefined {
  const entry = entries.get(network);
  // `!(a > b)` rather than `a <= b`: a NaN expiry (a non-numeric interval
  // env value reaching `ttlMs`) counts as expired instead of never.
  if (!entry || entry.fingerprint !== fingerprint || !(entry.expiresAt > monotonicNow())) return undefined;
  return entry.value as T;
}

async function probeAndStore<T>(
  network: string,
  fingerprint: string,
  probe: () => Promise<T>,
  ttlMs: (value: T) => number,
): Promise<T> {
  const startGeneration = generation;
  const value = await probe();
  if (generation === startGeneration) {
    entries.set(network, { fingerprint, value, expiresAt: monotonicNow() + ttlMs(value) });
  }
  return value;
}

/**
 * Return the cached probe outcome for `network`/`fingerprint`, or run
 * `probe` once for all concurrent callers and cache its result for
 * `ttlMs(result)`. A rejected probe is shared by its concurrent callers but
 * not cached.
 */
export function getCachedNetworkStatusProbe<T>(
  network: string,
  fingerprint: string,
  probe: () => Promise<T>,
  ttlMs: (value: T) => number,
): Promise<T> {
  const cached = cachedValue<T>(network, fingerprint);
  if (cached !== undefined) return Promise.resolve(cached);
  return singleFlight(
    pending as Map<string, Promise<T>>,
    `${network}\u0000${fingerprint}`,
    () => probeAndStore(network, fingerprint, probe, ttlMs),
  );
}

/** Drop cached and in-flight probes for one network, or for all when omitted. */
export function invalidateNetworkStatusCache(network?: string): void {
  generation += 1;
  if (network === undefined) {
    entries.clear();
    pending.clear();
    return;
  }
  entries.delete(network);
  const prefix = `${network}\u0000`;
  for (const key of [...pending.keys()]) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
}
