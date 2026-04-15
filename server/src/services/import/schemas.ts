/**
 * Import Format Zod Schemas
 *
 * Zod schemas for validating import formats, replacing hand-rolled type guards.
 * Reuses shared server validation schemas where possible.
 */

import { z } from 'zod';
import { FingerprintSchema, DerivationPathSchema } from '../../validation/commonSchemas';

// =============================================================================
// JSON Import Config Schema
// =============================================================================

/**
 * Wallet type enum used in JSON import configs
 * Note: these use underscored format (single_sig, multi_sig) unlike the API schemas
 */
const ImportWalletTypeSchema = z.enum(['single_sig', 'multi_sig']);

const ImportScriptTypeSchema = z.enum(['native_segwit', 'nested_segwit', 'taproot', 'legacy']);

const ImportNetworkSchema = z.enum(['mainnet', 'testnet', 'regtest']);

/**
 * Extended public key for imports — more lenient than the API XpubSchema.
 * Imports may come from various tools with different xpub encoding conventions.
 */
const ImportXpubSchema = z.string().min(1, 'xpub is required');

/** Single device within a JSON import config */
export const JsonImportDeviceSchema = z.object({
  type: z.string().optional(),
  label: z.string().optional(),
  fingerprint: FingerprintSchema,
  derivationPath: DerivationPathSchema,
  xpub: ImportXpubSchema,
});

/** Full JSON import config (our custom format with devices array) */
export const JsonImportConfigSchema = z
  .object({
    type: ImportWalletTypeSchema,
    scriptType: ImportScriptTypeSchema,
    quorum: z.number().int().positive().optional(),
    network: ImportNetworkSchema.optional(),
    devices: z.array(JsonImportDeviceSchema).min(1, 'devices must be a non-empty array'),
    name: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'multi_sig') {
      if (data.quorum === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multi-sig requires a valid quorum (positive integer)',
          path: ['quorum'],
        });
      } else if (data.quorum > data.devices.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Quorum cannot exceed total number of devices',
          path: ['quorum'],
        });
      }
    }
    if (data.type === 'single_sig' && data.devices.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Single-sig requires exactly one device',
        path: ['devices'],
      });
    }
  });

// =============================================================================
// Coldcard Export Schema
// =============================================================================

/** Nested BIP path object (e.g., bip84, bip49) */
const ColdcardBipPathSchema = z.object({
  xpub: z.string(),
  deriv: z.string(),
  name: z.string().optional(),
  first: z.string().optional(),
  _pub: z.string().optional(),
});

/**
 * Coldcard JSON export — supports both nested format (bip44/49/84/48)
 * and flat format (p2sh/p2sh_p2wsh/p2wsh)
 */
export const ColdcardExportSchema = z
  .object({
    chain: z.string().optional(),
    xfp: FingerprintSchema,
    xpub: z.string().optional(),
    account: z.union([z.number(), z.string()]).optional(),
    // Nested format
    bip44: ColdcardBipPathSchema.optional(),
    bip49: ColdcardBipPathSchema.optional(),
    bip84: ColdcardBipPathSchema.optional(),
    bip48_1: ColdcardBipPathSchema.optional(),
    bip48_2: ColdcardBipPathSchema.optional(),
    // Flat format
    p2sh: z.string().optional(),
    p2sh_deriv: z.string().optional(),
    p2sh_p2wsh: z.string().optional(),
    p2sh_p2wsh_deriv: z.string().optional(),
    p2wsh: z.string().optional(),
    p2wsh_deriv: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasNestedFormat =
        data.bip44 !== undefined ||
        data.bip49 !== undefined ||
        data.bip84 !== undefined ||
        data.bip48_1 !== undefined ||
        data.bip48_2 !== undefined;
      const hasFlatFormat =
        data.p2sh !== undefined ||
        data.p2sh_p2wsh !== undefined ||
        data.p2wsh !== undefined;
      return hasNestedFormat || hasFlatFormat;
    },
    { message: 'Coldcard export must contain at least one BIP path (nested or flat format)' }
  );

// =============================================================================
// Wallet Export Format Schema (Sparrow, Specter, etc.)
// =============================================================================

export const WalletExportFormatSchema = z.object({
  descriptor: z.string().min(1),
  label: z.string().optional(),
  name: z.string().optional(),
  blockheight: z.number().int().optional(),
});

// =============================================================================
// Detection-only schemas (looser, for canHandle format detection)
// =============================================================================

/** Loose check: has devices array and type/scriptType — enough to detect format */
export const JsonConfigDetectionSchema = z.object({
  devices: z.array(z.unknown()).min(1),
  type: z.string().optional(),
  scriptType: z.string().optional(),
}).refine(
  (data) => data.type !== undefined || data.scriptType !== undefined,
  { message: 'Must have type or scriptType' }
);

/** Loose check: has descriptor string */
export const WalletExportDetectionSchema = z.object({
  descriptor: z.string(),
});

/** Loose check: has xfp (8 hex chars) + at least one BIP path */
export const ColdcardDetectionSchema = z
  .object({
    xfp: FingerprintSchema,
    bip44: z.unknown().optional(),
    bip49: z.unknown().optional(),
    bip84: z.unknown().optional(),
    bip48_1: z.unknown().optional(),
    bip48_2: z.unknown().optional(),
    p2sh: z.unknown().optional(),
    p2sh_p2wsh: z.unknown().optional(),
    p2wsh: z.unknown().optional(),
  })
  .refine(
    (data) => {
      return (
        data.bip44 !== undefined ||
        data.bip49 !== undefined ||
        data.bip84 !== undefined ||
        data.bip48_1 !== undefined ||
        data.bip48_2 !== undefined ||
        data.p2sh !== undefined ||
        data.p2sh_p2wsh !== undefined ||
        data.p2wsh !== undefined
      );
    },
    { message: 'Must have at least one BIP path' }
  );

// =============================================================================
// Type exports inferred from schemas
// =============================================================================

export type JsonImportDeviceInput = z.infer<typeof JsonImportDeviceSchema>;
export type JsonImportConfigInput = z.infer<typeof JsonImportConfigSchema>;
export type ColdcardExportInput = z.infer<typeof ColdcardExportSchema>;
export type WalletExportFormatInput = z.infer<typeof WalletExportFormatSchema>;
