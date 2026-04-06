/**
 * Block Height Utilities
 *
 * Handles block height caching and fetching for fast confirmation calculations.
 */

import { getNodeClient } from '../nodeClient';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

const log = createLogger('BITCOIN:SVC_BLOCK_HEIGHT');

export type Network = 'mainnet' | 'testnet' | 'signet' | 'regtest';

// Per-network cached block heights for accurate confirmation calculations
// Each network has its own block height (e.g., mainnet ~880k, testnet ~2.9M)
const cachedBlockHeights = new Map<Network, { height: number; time: number }>();

/**
 * Get the cached block height for a specific network
 * Returns 0 if not yet cached for this network
 *
 * @param network - Bitcoin network (defaults to mainnet for backwards compatibility)
 */
export function getCachedBlockHeight(network: Network = 'mainnet'): number {
  return cachedBlockHeights.get(network)?.height ?? 0;
}

/**
 * Set the cached block height for a specific network
 * Called from sync service when block headers are received
 *
 * @param height - Current block height
 * @param network - Bitcoin network (defaults to mainnet for backwards compatibility)
 */
export function setCachedBlockHeight(height: number, network: Network = 'mainnet'): void {
  const current = cachedBlockHeights.get(network);
  if (!current || height > current.height) {
    cachedBlockHeights.set(network, { height, time: Date.now() });
    log.debug(`Cached block height for ${network} updated to ${height}`);
  }
}

/**
 * Get current block height from node
 * Updates the per-network cache on success
 */
export async function getBlockHeight(network: Network = 'mainnet'): Promise<number> {
  try {
    const client = await getNodeClient(network);
    const height = await client.getBlockHeight();
    setCachedBlockHeight(height, network);
    return height;
  } catch (error) {
    log.error('Failed to get block height', { error: getErrorMessage(error), network });
    // Return cached height if available, otherwise throw
    const cached = getCachedBlockHeight(network);
    if (cached > 0) {
      return cached;
    }
    throw error;
  }
}

/**
 * Simple LRU cache using Map's insertion order
 * When max size reached, evicts oldest entries
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Cache for block timestamps to avoid repeated lookups (max 1000 blocks)
const blockTimestampCache = new LRUCache<number, Date>(1000);

/**
 * Get block timestamp from block height
 * Block header is 80 bytes hex; timestamp is at bytes 68-72 (little-endian uint32)
 */
export async function getBlockTimestamp(height: number, network: 'mainnet' | 'testnet' | 'signet' | 'regtest' = 'mainnet'): Promise<Date | null> {
  if (height <= 0) return null;

  // Check cache first
  const cached = blockTimestampCache.get(height);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const client = await getNodeClient(network);
    const headerHex = await client.getBlockHeader(height);

    // Block header structure (80 bytes):
    // - version: 4 bytes (0-3)
    // - prev_block_hash: 32 bytes (4-35)
    // - merkle_root: 32 bytes (36-67)
    // - timestamp: 4 bytes (68-71) - little-endian uint32
    // - bits: 4 bytes (72-75)
    // - nonce: 4 bytes (76-79)

    // Extract timestamp bytes (68-71, each byte is 2 hex chars)
    const timestampHex = headerHex.slice(136, 144); // bytes 68-71 = chars 136-143

    // Convert from little-endian hex to number
    const timestampBuffer = Buffer.from(timestampHex, 'hex');
    const timestamp = timestampBuffer.readUInt32LE(0);

    const date = new Date(timestamp * 1000);

    // Cache the result
    blockTimestampCache.set(height, date);

    return date;
  } catch (error) {
    log.warn(`Failed to get block timestamp for height ${height}`, { error: getErrorMessage(error) });
    return null;
  }
}
