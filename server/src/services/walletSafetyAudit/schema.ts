import { z } from 'zod';

// V2 adds canonical policy/coordinate/script evidence. Readers must keep V1
// records immutable and treat absent V2 evidence as unproven, never backfilled.
export const WALLET_SAFETY_AUDIT_SCHEMA_VERSION = 'sanctuary.wallet-safety-audit.v2' as const;

export const walletAuditClassificationSchema = z.enum([
  'proven_safe',
  'unsupported_but_recoverable',
  'manual_investigation',
]);

export const walletAuditFindingIdSchema = z.enum([
  'address.path_inconsistent',
  'address.policy_mismatch',
  'address.coordinate_missing',
  'address.script_pubkey_mismatch',
  'address.zero_addresses',
  'descriptor.mixed_change_branches',
  'descriptor.policy_inconsistent',
  'descriptor.provenance_unproven',
  'policy.ordered_multisig_unsupported',
  'policy.legacy_multisig_unsupported',
  'policy.taproot_multisig_unsupported',
  'signer.binding_ambiguous',
  'signer.binding_incomplete',
  'signer.fingerprint_missing',
  'signer.fingerprint_parent_only',
  'signer.snapshot_mismatch',
  'signer.xpub_invalid',
  'signer.xpub_network_mismatch',
  'signer.xpub_version_mismatch',
  'signer.xpub_wrong_depth',
]);

export type WalletAuditClassification = z.infer<typeof walletAuditClassificationSchema>;
export type WalletAuditFindingId = z.infer<typeof walletAuditFindingIdSchema>;

const nullableString = z.string().nullable();

export const rawAuditWalletSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  scriptType: z.string(),
  network: z.string(),
  quorum: z.number().int().nullable(),
  totalSigners: z.number().int().nullable(),
  descriptor: nullableString,
  changeDescriptor: nullableString,
  descriptorPolicyVersion: z.number().int().nullable(),
  descriptorSourceKind: nullableString,
  sourceDescriptor: nullableString,
  sourceChangeDescriptor: nullableString,
  sourceDescriptorChecksum: nullableString,
  sourceChangeDescriptorChecksum: nullableString,
  fingerprint: nullableString,
  canonicalPolicyId: nullableString,
  canonicalPolicyVersion: z.number().int().nullable(),
});

export const rawAuditAddressSchema = z.strictObject({
  id: z.string(),
  walletId: z.string(),
  address: z.string(),
  derivationPath: z.string(),
  index: z.number().int(),
  branch: z.number().int().nullable(),
  coordinateVersion: z.number().int().nullable(),
  canonicalPolicyId: nullableString,
  canonicalPolicyVersion: z.number().int().nullable(),
  scriptPubKey: nullableString,
});

export const rawAuditSignerSchema = z.strictObject({
  id: z.string(),
  walletId: z.string(),
  deviceId: z.string(),
  deviceAccountId: nullableString,
  signerIndex: z.number().int().nullable(),
  signerBindingVersion: z.number().int().nullable(),
  signerFingerprint: nullableString,
  signerXpub: nullableString,
  signerDerivationPath: nullableString,
  signerPurpose: nullableString,
  signerScriptType: nullableString,
  deviceType: z.string(),
  deviceFingerprint: z.string(),
  deviceDerivationPath: nullableString,
  deviceXpub: z.string(),
  accountPurpose: nullableString,
  accountScriptType: nullableString,
  accountDerivationPath: nullableString,
  accountXpub: nullableString,
});

export const walletSafetyRawSnapshotSchema = z.strictObject({
  wallets: z.array(rawAuditWalletSchema),
  addresses: z.array(rawAuditAddressSchema),
  signers: z.array(rawAuditSignerSchema),
});

export type RawAuditWallet = z.infer<typeof rawAuditWalletSchema>;
export type RawAuditAddress = z.infer<typeof rawAuditAddressSchema>;
export type RawAuditSigner = z.infer<typeof rawAuditSignerSchema>;
export type WalletSafetyRawSnapshot = z.infer<typeof walletSafetyRawSnapshotSchema>;

const walletAuditFindingSchema = z.strictObject({
  id: walletAuditFindingIdSchema,
});

const walletAuditEvidenceSchema = z.strictObject({
  wallet: rawAuditWalletSchema,
  addresses: z.array(rawAuditAddressSchema),
  signers: z.array(rawAuditSignerSchema),
});

export const walletSafetyAuditReportSchema = z.strictObject({
  schemaVersion: z.literal(WALLET_SAFETY_AUDIT_SCHEMA_VERSION),
  generatedAt: z.iso.datetime({ offset: true }),
  snapshot: z.strictObject({
    databaseIsolation: z.literal('repeatable_read'),
    databaseAccess: z.literal('read_only'),
    walletCount: z.number().int().nonnegative(),
    addressCount: z.number().int().nonnegative(),
    signerCount: z.number().int().nonnegative(),
  }),
  summary: z.strictObject({
    provenSafe: z.number().int().nonnegative(),
    unsupportedButRecoverable: z.number().int().nonnegative(),
    manualInvestigation: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
  }),
  wallets: z.array(z.strictObject({
    walletId: z.string(),
    classification: walletAuditClassificationSchema,
    findings: z.array(walletAuditFindingSchema),
    evidence: walletAuditEvidenceSchema,
  })),
});

export type WalletSafetyAuditReport = z.infer<typeof walletSafetyAuditReportSchema>;

export const WALLET_SAFETY_AUDIT_EXIT_CODES = Object.freeze({
  clean: 0,
  error: 1,
  findings: 2,
} as const);
