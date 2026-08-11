import { z } from 'zod';
import { BITCOIN_NETWORKS } from '../constants/bitcoin';
import {
  WALLET_SCRIPT_TYPE_VALUES,
  WALLET_TYPE_VALUES,
} from '../constants/walletIdentity';
import { MasterFingerprintSchema } from './deviceIdentity';

const exactString = z.string().min(1).refine(
  value => value === value.trim(),
  'Signing evidence must not contain surrounding whitespace',
);
const lowercaseHex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const digestHex = z.string().regex(/^[0-9a-f]{64}$/);
const decimalSatoshis = z.string().regex(/^(?:0|[1-9]\d*)$/);

export const PsbtSignerOriginSchema = z.strictObject({
  masterFingerprint: MasterFingerprintSchema,
  path: exactString,
  pubkey: lowercaseHex,
});

export const PsbtWalletSignerSchema = z.strictObject({
  signerIndex: z.number().int().nonnegative(),
  deviceId: exactString,
  deviceAccountId: exactString,
  masterFingerprint: MasterFingerprintSchema,
  accountPath: exactString,
  accountXpub: exactString,
});

export const PsbtInputBindingSchema = z.strictObject({
  inputIndex: z.number().int().nonnegative(),
  txid: digestHex,
  vout: z.number().int().nonnegative(),
  amountSats: decimalSatoshis,
  scriptPubKey: lowercaseHex,
  addressPath: exactString,
  signerOrigins: z.array(PsbtSignerOriginSchema).min(1),
});

export const PsbtChangeBindingSchema = z.strictObject({
  outputIndex: z.number().int().nonnegative(),
  amountSats: decimalSatoshis,
  scriptPubKey: lowercaseHex,
  addressPath: exactString,
  signerOrigins: z.array(PsbtSignerOriginSchema).min(1),
});

/**
 * Immutable, server-issued evidence consumed before a browser hardware adapter
 * may sign. Every value is compared back to the PSBT; it is never a fallback
 * source for repairing missing or inconsistent PSBT metadata.
 */
export const PsbtSigningContextSchema = z.strictObject({
  version: z.literal(1),
  walletId: exactString,
  network: z.enum(BITCOIN_NETWORKS),
  walletType: z.enum(WALLET_TYPE_VALUES),
  scriptType: z.enum(WALLET_SCRIPT_TYPE_VALUES),
  canonicalPolicyId: exactString,
  canonicalPolicyVersion: z.number().int().positive(),
  descriptorDigest: digestHex,
  unsignedTransactionDigest: digestHex,
  signers: z.array(PsbtWalletSignerSchema).min(1),
  inputs: z.array(PsbtInputBindingSchema).min(1),
  changeOutputs: z.array(PsbtChangeBindingSchema),
});

export type PsbtSignerOrigin = z.infer<typeof PsbtSignerOriginSchema>;
export type PsbtWalletSigner = z.infer<typeof PsbtWalletSignerSchema>;
export type PsbtInputBinding = z.infer<typeof PsbtInputBindingSchema>;
export type PsbtChangeBinding = z.infer<typeof PsbtChangeBindingSchema>;
export type PsbtSigningContext = z.infer<typeof PsbtSigningContextSchema>;
