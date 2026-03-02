/**
 * BitBox02 Adapter Module
 *
 * Barrel file re-exporting the BitBox02 adapter and related utilities.
 */

export { BitBoxAdapter } from './bitboxAdapter';
export type { BitBoxConnection } from './types';
export { BITBOX_VENDOR_ID, BITBOX_PRODUCT_ID } from './types';

// @internal - testing utilities
export { getSimpleType, getXpubType, getCoin, getOutputType, extractAccountPath } from './pathUtils';
export { signPsbtWithBitBox } from './signPsbt';
