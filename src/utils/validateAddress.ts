/**
 * Bitcoin Address Validation Utilities (Frontend)
 *
 * Quick regex-based validation for immediate UI feedback.
 * For full cryptographic validation, use the API.
 *
 * Re-exports shared utilities and adds frontend-specific helpers.
 */

// Import shared utilities
import {
  isValidAddressFormat,
  detectAddressType,
  isMainnetAddress as sharedIsMainnetAddress,
  isTestnetAddress as sharedIsTestnetAddress,
} from '@sanctuary/shared/utils/bitcoin';
import type { AddressType } from '@sanctuary/shared/utils/bitcoin';

// Re-export shared utilities with frontend-compatible names
export { isValidAddressFormat, detectAddressType };
export type { AddressType };

/**
 * Quick format check for Bitcoin address.
 * Returns true if the address appears valid, false if obviously invalid.
 * For definitive validation, use the API.
 */
export const validateAddress = isValidAddressFormat;

/**
 * Detect the type of Bitcoin address
 * Re-export with existing name for backward compatibility
 */
export const getAddressType = detectAddressType;

/**
 * Check if address is a mainnet address
 */
export const isMainnetAddress = sharedIsMainnetAddress;

/**
 * Check if address is a testnet address
 */
export const isTestnetAddress = sharedIsTestnetAddress;

/**
 * Get the network for an address
 */
export function getAddressNetwork(address: string): 'mainnet' | 'testnet' | 'regtest' | null {
  if (!address) return null;

  const trimmed = address.trim();

  if (isMainnetAddress(trimmed)) return 'mainnet';
  if (isTestnetAddress(trimmed)) return 'testnet';
  // Note: regtest addresses look the same as testnet addresses
  // They can only be distinguished by context (i.e., which network the wallet is on)
  return null;
}

/**
 * Check if an address matches a specific network
 */
export function addressMatchesNetwork(
  address: string,
  network: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest' | 'testnet'
): boolean {
  const addressNetwork = getAddressNetwork(address);
  if (!addressNetwork) return false;

  // Testnet3, testnet4, signet, and regtest use the testnet address family.
  if (network !== 'mainnet') {
    return addressNetwork === 'testnet';
  }

  return addressNetwork === network;
}
