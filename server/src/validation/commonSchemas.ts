/**
 * Common Validation Schemas
 *
 * Reusable Zod schemas for common data types and patterns.
 */

import { z } from 'zod';

// =============================================================================
// Basic Types
// =============================================================================

/** UUID v4 format */
export const UuidSchema = z.string().uuid();

/** Non-empty string */
export const NonEmptyStringSchema = z.string().min(1);

/** Optional non-empty string (empty string becomes undefined) */
export const OptionalStringSchema = z.string().optional().transform(s => s || undefined);

/** Email address */
export const EmailSchema = z.string().email().toLowerCase();

/** Username (alphanumeric, underscores, 3-50 chars) */
export const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be at most 50 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');

// =============================================================================
// Pagination
// =============================================================================

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// =============================================================================
// Date/Time
// =============================================================================

export const DateStringSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const DateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// =============================================================================
// Bitcoin-specific
// =============================================================================

export const NetworkTypeSchema = z.enum(['mainnet', 'testnet', 'signet', 'regtest']);

export const ScriptTypeSchema = z.enum([
  'p2pkh', // Legacy
  'p2sh-p2wpkh', // Nested SegWit
  'p2wpkh', // Native SegWit
  'p2tr', // Taproot
]);

export const WalletTypeSchema = z.enum(['standard', 'multisig', 'watch-only']);

/** Bitcoin address - basic pattern check */
export const BitcoinAddressSchema = z.string().refine(
  (addr) => {
    // Basic pattern check for various address types
    // Mainnet: 1..., 3..., bc1...
    // Testnet/Signet: m..., n..., 2..., tb1...
    // Regtest: bcrt1...
    return /^(1|3|bc1|m|n|2|tb1|bcrt1)[a-zA-HJ-NP-Z0-9]{25,90}$/.test(addr);
  },
  { message: 'Invalid Bitcoin address format' }
);

/** Transaction ID (64 hex chars) */
export const TxidSchema = z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid transaction ID');

/** Hex string */
export const HexStringSchema = z.string().regex(/^[a-fA-F0-9]*$/, 'Must be a valid hex string');

/** PSBT base64 */
export const PsbtSchema = z.string().min(1, 'PSBT is required');

/** Extended public key (xpub, ypub, zpub, tpub, etc.) */
export const XpubSchema = z.string().regex(
  /^([xyztuvXYZTUV]pub[1-9A-HJ-NP-Za-km-z]{79,108})$/,
  'Invalid extended public key format'
);

/** Derivation path */
export const DerivationPathSchema = z.string().regex(
  /^m(\/\d+'?)*$/,
  'Invalid derivation path format (e.g., m/84\'/0\'/0\')'
);

/** Device fingerprint (8 hex chars) */
export const FingerprintSchema = z.string().regex(/^[a-fA-F0-9]{8}$/, 'Invalid fingerprint format');

/** Satoshi amount (positive integer) */
export const SatoshiAmountSchema = z.coerce.number().int().min(0);

/** Fee rate in sat/vB */
export const FeeRateSchema = z.coerce.number().min(1);

// =============================================================================
// ID Parameters
// =============================================================================

export const IdParamSchema = z.object({
  id: UuidSchema,
});

export const WalletIdParamSchema = z.object({
  walletId: UuidSchema,
});

export const AddressParamSchema = z.object({
  address: BitcoinAddressSchema,
});

export const TxidParamSchema = z.object({
  txid: TxidSchema,
});

// =============================================================================
// Type Exports
// =============================================================================

export type Pagination = z.infer<typeof PaginationSchema>;
export type CursorPagination = z.infer<typeof CursorPaginationSchema>;
export type NetworkType = z.infer<typeof NetworkTypeSchema>;
export type ScriptType = z.infer<typeof ScriptTypeSchema>;
export type WalletType = z.infer<typeof WalletTypeSchema>;
