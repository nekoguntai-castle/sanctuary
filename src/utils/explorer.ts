/**
 * Explorer URL Utilities
 *
 * Utilities for generating network-aware block explorer URLs
 */

/**
 * Convert a base explorer URL to be network-aware
 * @param baseUrl - The base explorer URL (e.g., "https://mempool.space/tx/...")
 * @param network - The Bitcoin network (mainnet, testnet3, testnet4, signet, regtest)
 * @returns Network-aware explorer URL
 */
/** Path segment each network uses on the public explorers. */
const NETWORK_PATH_SEGMENT: Record<string, string> = {
  testnet: 'testnet',
  testnet3: 'testnet',
  testnet4: 'testnet4',
  signet: 'signet',
};

/**
 * Which networks each known explorer host actually serves under a path prefix.
 * Anything else — a self-hosted or otherwise custom explorer — is returned
 * untouched, because we cannot know its URL scheme.
 */
const HOST_SUPPORTED_SEGMENTS: Record<string, readonly string[]> = {
  'mempool.space': ['testnet', 'testnet4', 'signet'],
  'blockstream.info': ['testnet'],
};

export function getExplorerUrl(baseUrl: string, network: string): string {
  // Mainnet doesn't need modification
  if (!network || network === 'mainnet') {
    return baseUrl;
  }

  // regtest and unknown networks have no public explorer path
  const segment = NETWORK_PATH_SEGMENT[network];
  if (!segment) {
    return baseUrl;
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  const host = url.hostname.replace(/^www\./, '');
  if (!HOST_SUPPORTED_SEGMENTS[host]?.includes(segment)) {
    return baseUrl;
  }

  const segments = url.pathname.split('/').filter(Boolean);

  // Idempotent: the server's per-network explorer settings are *already*
  // prefixed (e.g. https://mempool.space/testnet4), so prefixing again
  // produced /testnet4/testnet4/. Adding the segment only when it is absent
  // lets callers pass either a bare host or a configured per-network base.
  if (segments[0] === segment) {
    return baseUrl;
  }

  // Preserve a trailing slash: callers pass both bare bases ("https://host/")
  // and full resource paths, and the slash is part of the caller's string.
  const trailingSlash = url.pathname.endsWith('/') ? '/' : '';
  url.pathname = `/${[segment, ...segments].join('/')}${trailingSlash}`;
  return url.toString();
}

/**
 * Get a transaction explorer URL for a specific network
 * @param txid - Transaction ID
 * @param network - Bitcoin network
 * @param explorerBase - Base explorer URL (defaults to mempool.space)
 * @returns Full explorer URL for the transaction
 */
export function getTxExplorerUrl(
  txid: string,
  network: string = 'mainnet',
  explorerBase: string = 'https://mempool.space'
): string {
  const baseUrl = `${explorerBase}/tx/${txid}`;
  return getExplorerUrl(baseUrl, network);
}

/**
 * Get an address explorer URL for a specific network
 * @param address - Bitcoin address
 * @param network - Bitcoin network
 * @param explorerBase - Base explorer URL (defaults to mempool.space)
 * @returns Full explorer URL for the address
 */
export function getAddressExplorerUrl(
  address: string,
  network: string = 'mainnet',
  explorerBase: string = 'https://mempool.space'
): string {
  const baseUrl = `${explorerBase}/address/${address}`;
  return getExplorerUrl(baseUrl, network);
}

/**
 * Get a block explorer URL for a specific network
 * @param blockHash - Block hash
 * @param network - Bitcoin network
 * @param explorerBase - Base explorer URL (defaults to mempool.space)
 * @returns Full explorer URL for the block
 */
export function getBlockExplorerUrl(
  blockHash: string,
  network: string = 'mainnet',
  explorerBase: string = 'https://mempool.space'
): string {
  const baseUrl = `${explorerBase}/block/${blockHash}`;
  return getExplorerUrl(baseUrl, network);
}
