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
export function getExplorerUrl(baseUrl: string, network: string): string {
  // Mainnet doesn't need modification
  if (!network || network === 'mainnet') {
    return baseUrl;
  }

  // For non-mainnet public networks, insert the network prefix into the URL
  // mempool.space -> mempool.space/testnet or mempool.space/testnet4
  // blockstream.info -> blockstream.info/testnet
  if (network === 'testnet' || network === 'testnet3') {
    return baseUrl
      .replace('mempool.space/', 'mempool.space/testnet/')
      .replace('mempool.space/tx/', 'mempool.space/testnet/tx/')
      .replace('mempool.space/address/', 'mempool.space/testnet/address/')
      .replace('blockstream.info/', 'blockstream.info/testnet/')
      .replace('blockstream.info/tx/', 'blockstream.info/testnet/tx/')
      .replace('blockstream.info/address/', 'blockstream.info/testnet/address/');
  }

  if (network === 'testnet4') {
    return baseUrl
      .replace('mempool.space/', 'mempool.space/testnet4/')
      .replace('mempool.space/tx/', 'mempool.space/testnet4/tx/')
      .replace('mempool.space/address/', 'mempool.space/testnet4/address/');
  }

  if (network === 'signet') {
    return baseUrl
      .replace('mempool.space/', 'mempool.space/signet/')
      .replace('mempool.space/tx/', 'mempool.space/signet/tx/')
      .replace('mempool.space/address/', 'mempool.space/signet/address/');
  }

  // For regtest or unknown networks, return base URL as-is
  return baseUrl;
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
