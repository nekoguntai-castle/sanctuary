/**
 * BitBox02 Types
 *
 * Shared type definitions and constants for the BitBox02 adapter.
 */

// BitBox02 USB identifiers
export const BITBOX_VENDOR_ID = 0x03eb;
export const BITBOX_PRODUCT_ID = 0x2403;

/**
 * Connection state for an active BitBox02 session
 */
export interface BitBoxConnection {
  api: any;
  devicePath: string;
  product: number; // constants.Product.BitBox02Multi or BitBox02BTCOnly
}
