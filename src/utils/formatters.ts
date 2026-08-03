/**
 * Formatting Utilities
 *
 * Common formatting functions for displaying data in the UI
 */

/**
 * Truncate a Bitcoin address for display
 * Shows the first and last characters with ellipsis in the middle
 *
 * @param address - The full address to truncate
 * @param prefixLength - Number of characters to show at the start (default: 10)
 * @param suffixLength - Number of characters to show at the end (default: 8)
 * @returns Truncated address string
 *
 * @example
 * truncateAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
 * // Returns: 'bc1qxy2kgd...jkfjhx0wlh'
 */
export function truncateAddress(
  address: string,
  prefixLength: number = 10,
  suffixLength: number = 8
): string {
  if (!address || address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}
