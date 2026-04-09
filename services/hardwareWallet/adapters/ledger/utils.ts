/**
 * Ledger Utility Functions
 *
 * Pure helper functions for Ledger device identification and derivation path handling.
 */

// Re-export shared path utilities for backward compatibility
export { inferScriptTypeFromPath, extractAccountPath } from '../../pathUtils';

// Ledger USB vendor ID
export const LEDGER_VENDOR_ID = 0x2c97;

// xpub version bytes
export const XPUB_VERSION = 0x0488b21e; // Standard xpub (mainnet)
export const TPUB_VERSION = 0x043587cf; // Standard tpub (testnet)

/**
 * Get model name from Ledger product ID
 */
export const getLedgerModel = (productId: number): string => {
  const models: Record<number, string> = {
    0x0001: 'Ledger Nano S',
    0x0004: 'Ledger Nano X',
    0x0005: 'Ledger Nano S Plus',
    0x0006: 'Ledger Stax',
    0x0007: 'Ledger Flex',
  };
  return models[productId] || 'Ledger Device';
};

/**
 * Get device ID from USB device
 */
export const getDeviceId = (device: USBDevice): string => {
  return `ledger-${device.vendorId}-${device.productId}-${device.serialNumber || 'unknown'}`;
};

/**
 * Get descriptor template for wallet policy based on script type
 */
export const getDescriptorTemplate = (scriptType: string): 'wpkh(@0/**)' | 'sh(wpkh(@0/**))' | 'pkh(@0/**)' | 'tr(@0/**)' => {
  switch (scriptType) {
    case 'p2wpkh':
      return 'wpkh(@0/**)';
    case 'p2sh-p2wpkh':
      return 'sh(wpkh(@0/**))';
    case 'p2pkh':
      return 'pkh(@0/**)';
    case 'p2tr':
      return 'tr(@0/**)';
    default:
      return 'wpkh(@0/**)';
  }
};
