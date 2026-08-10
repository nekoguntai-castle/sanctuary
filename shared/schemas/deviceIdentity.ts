import { z } from 'zod';

export const MASTER_FINGERPRINT_PATTERN = /^[a-fA-F0-9]{8}$/;

/**
 * Canonical BIP32 master-key fingerprint used in BIP174 key origins. The all-zero
 * value is rejected because it is a sentinel formerly produced by unverified
 * device flows, not proof of a signer identity.
 */
export const MasterFingerprintSchema = z
  .string()
  .regex(MASTER_FINGERPRINT_PATTERN, 'Master fingerprint must be exactly 8 hexadecimal characters')
  .refine(value => value.toLowerCase() !== '00000000', 'Master fingerprint cannot be 00000000')
  .transform(value => value.toLowerCase());

export const ExactDeviceEvidenceStringSchema = z
  .string()
  .min(1)
  .refine(value => value === value.trim(), 'Device identity evidence must not contain surrounding whitespace');

export const DeviceIdentityEvidenceSchema = z.object({
  masterFingerprint: MasterFingerprintSchema,
  derivationPath: ExactDeviceEvidenceStringSchema,
  xpub: ExactDeviceEvidenceStringSchema,
});

export type DeviceIdentityEvidence = z.infer<typeof DeviceIdentityEvidenceSchema>;
