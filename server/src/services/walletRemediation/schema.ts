import { z } from 'zod';
import { WALLET_REMEDIATION_SCHEMA_VERSION } from './types';
import { remediationDigest, remediationProofDigest } from '../../utils/walletRemediationCanonicalDocument';
import type {
  WalletRemediationDocument,
  WalletRemediationProposalView,
} from './types';

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const nonEmptyString = z.string().min(1);
const evidenceIdsSchema = z.array(nonEmptyString).min(1);
const nullableString = nonEmptyString.nullable();

const remediationWalletSchema = z.object({
  id: nonEmptyString, type: nonEmptyString, scriptType: nonEmptyString, network: nonEmptyString,
  quorum: z.number().int().nullable(), totalSigners: z.number().int().nullable(),
  descriptor: nullableString, changeDescriptor: nullableString,
  descriptorPolicyVersion: z.number().int().nullable(), descriptorSourceKind: nullableString,
  sourceDescriptor: nullableString, sourceChangeDescriptor: nullableString,
  sourceDescriptorChecksum: nullableString, sourceChangeDescriptorChecksum: nullableString,
  fingerprint: nullableString, canonicalPolicyId: nullableString,
  canonicalPolicyVersion: z.number().int().nullable(),
}).strict();

const remediationSignerSchema = z.object({
  id: nonEmptyString, walletId: nonEmptyString, deviceId: nonEmptyString,
  deviceAccountId: nullableString, signerIndex: z.number().int().nullable(),
  signerBindingVersion: z.number().int().nullable(), signerFingerprint: nullableString,
  signerXpub: nullableString, signerDerivationPath: nullableString,
  signerPurpose: nullableString, signerScriptType: nullableString,
  deviceFingerprint: nonEmptyString, accountId: nullableString, accountPurpose: nullableString,
  accountScriptType: nullableString, accountDerivationPath: nullableString, accountXpub: nullableString,
}).strict();

const remediationAddressSchema = z.object({
  id: nonEmptyString, walletId: nonEmptyString, address: nonEmptyString,
  derivationPath: nonEmptyString, index: z.number().int().min(0),
  branch: z.number().int().min(0).max(1).nullable(), coordinateVersion: z.number().int().nullable(),
  canonicalPolicyId: nullableString, canonicalPolicyVersion: z.number().int().nullable(),
  scriptPubKey: nullableString,
}).strict();

const remediationSnapshotSchema = z.object({
  wallet: remediationWalletSchema,
  signers: z.array(remediationSignerSchema),
  addresses: z.array(remediationAddressSchema),
  ownerUserIds: z.array(nonEmptyString).min(1),
}).strict();

const walletPolicyPatchSchema = z.object({
  descriptorPolicyVersion: z.number().int().positive().optional(),
  descriptorSourceKind: nonEmptyString.optional(),
  sourceDescriptorChecksum: z.string().regex(/^[023456789acdefghjklmnpqrstuvwxyz]{8}$/).optional(),
  sourceChangeDescriptorChecksum: z.string().regex(/^[023456789acdefghjklmnpqrstuvwxyz]{8}$/).optional(),
  canonicalPolicyId: nonEmptyString.optional(),
  canonicalPolicyVersion: z.number().int().positive().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'An exact wallet policy patch is required');

/**
 * A recovery assigns the descriptor policy a legacy wallet never had, so unlike
 * `walletPolicyPatchSchema` these fields are REQUIRED together rather than independently
 * optional: for a legacy-null row every one of them is always emitted, and a patch missing
 * any of them is malformed by construction. Requiredness is also what makes the
 * repository's compare-and-set on `sourceDescriptor` sound.
 *
 * `descriptor` and `fingerprint` are absent on purpose — they are frozen by
 * protect_wallet_descriptor_policy and must never appear in a patch.
 */
const walletPolicyRecoveryPatchSchema = z.object({
  descriptorPolicyVersion: z.literal(1),
  descriptorSourceKind: z.literal('recovered_legacy'),
  changeDescriptor: nonEmptyString,
  sourceDescriptor: nonEmptyString,
  canonicalPolicyId: nonEmptyString,
  canonicalPolicyVersion: z.number().int().positive(),
}).strict();

const signerBindingPatchSchema = z.object({
  deviceAccountId: nonEmptyString.optional(),
  signerIndex: z.number().int().min(0).optional(),
  signerBindingVersion: z.number().int().positive().optional(),
  signerFingerprint: z.string().regex(/^[0-9a-f]{8}$/).optional(),
  signerXpub: nonEmptyString.optional(),
  signerDerivationPath: z.string().regex(/^m\/.+/).optional(),
  signerPurpose: z.enum(['single_sig', 'multisig']).optional(),
  signerScriptType: nonEmptyString.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'An exact signer binding patch is required');

const addressCoordinatePatchSchema = z.object({
  branch: z.number().int().min(0).max(1).optional(),
  coordinateVersion: z.number().int().positive().optional(),
  canonicalPolicyId: nonEmptyString.optional(),
  canonicalPolicyVersion: z.number().int().positive().optional(),
  scriptPubKey: z.string().regex(/^[0-9a-f]+$/).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'An exact address coordinate patch is required');

const changeBase = {
  recordId: nonEmptyString,
  evidenceIds: evidenceIdsSchema,
} as const;

export const remediationChangeSchema = z.discriminatedUnion('kind', [
  z.object({ ...changeBase, kind: z.literal('wallet_policy'), proposed: walletPolicyPatchSchema }).strict(),
  z.object({ ...changeBase, kind: z.literal('wallet_policy_recovery'), proposed: walletPolicyRecoveryPatchSchema }).strict(),
  z.object({ ...changeBase, kind: z.literal('signer_binding'), proposed: signerBindingPatchSchema }).strict(),
  z.object({ ...changeBase, kind: z.literal('address_coordinate'), proposed: addressCoordinatePatchSchema }).strict(),
]);

const eligibleEvidenceIsExact = (document: WalletRemediationDocument): boolean => {
  const exactCounts = document.proof.addressCount === document.proof.unchangedAddressCount
    && document.proof.scriptPubKeyCount === document.proof.unchangedScriptPubKeyCount;
  return exactCounts && document.blockers.length === 0
    && document.proof.recoveryStatus === 'recovery-proven'
    && Boolean(document.proof.recoveryEvidenceDigest)
    && document.proof.evidenceIds.length > 0;
};

const blockedEvidenceIsSafe = (document: WalletRemediationDocument): boolean => (
  document.changes.length === 0
  && document.blockers.length > 0
  && document.proof.recoveryEvidenceDigest === null
);

const originalStateMatchesWallet = (document: WalletRemediationDocument): boolean => (
  document.walletId === document.originalState.wallet.id
  && document.originalState.signers.every(signer => signer.walletId === document.walletId)
  && document.originalState.addresses.every(address => address.walletId === document.walletId)
);

export const walletRemediationDocumentSchema = z.object({
  schemaVersion: z.literal(WALLET_REMEDIATION_SCHEMA_VERSION),
  attemptId: z.string().uuid(),
  proofDigest: digestSchema,
  walletId: nonEmptyString,
  eligible: z.boolean(),
  originalStateDigest: digestSchema,
  originalState: remediationSnapshotSchema,
  changes: z.array(remediationChangeSchema),
  blockers: z.array(z.object({ code: nonEmptyString, message: nonEmptyString }).strict()),
  proof: z.object({
    preservedPolicyDigest: digestSchema,
    addressCount: z.number().int().min(0),
    unchangedAddressCount: z.number().int().min(0),
    scriptPubKeyCount: z.number().int().min(0),
    unchangedScriptPubKeyCount: z.number().int().min(0),
    recoveryStatus: z.enum(['recovery-proven', 'blocked']),
    signingStatus: z.literal('not-tested'),
    recoveryEvidenceDigest: digestSchema.nullable(),
    evidenceIds: z.array(nonEmptyString),
  }).strict(),
  backout: z.object({
    state: z.enum(['not-applied', 'forward-fix-only']),
    message: nonEmptyString,
  }).strict(),
}).strict().superRefine((document, context) => {
  if (document.eligible && !eligibleEvidenceIsExact(document)) {
    context.addIssue({ code: 'custom', message: 'Eligible remediation evidence must be exact and unblocked' });
  }
  if (!document.eligible && !blockedEvidenceIsSafe(document)) {
    context.addIssue({ code: 'custom', message: 'Blocked remediation evidence cannot contain a patch' });
  }
  if (!originalStateMatchesWallet(document)) {
    context.addIssue({ code: 'custom', message: 'Original remediation state has inconsistent wallet identity' });
  }
  if (remediationDigest(document.originalState) !== document.originalStateDigest) {
    context.addIssue({ code: 'custom', message: 'Original remediation state digest does not match' });
  }
  if (remediationProofDigest(document) !== document.proofDigest) {
    context.addIssue({ code: 'custom', message: 'Remediation proof digest does not match' });
  }
});

export const walletRemediationProposalViewSchema = walletRemediationDocumentSchema.safeExtend({
  proposalId: z.string().regex(/^wallet-remediation-v1:[0-9a-f]{64}$/),
  proposalDigest: digestSchema,
  createdAt: z.string().datetime(),
  state: z.enum(['pending', 'blocked', 'cancelled', 'applied']),
  appliedAt: z.string().datetime().optional(),
}).strict().superRefine((proposal, context) => {
  if (!proposal.eligible && proposal.state !== 'blocked') {
    context.addIssue({ code: 'custom', message: 'Ineligible remediation evidence must remain blocked' });
  }
  if (proposal.eligible && proposal.state === 'blocked') {
    context.addIssue({ code: 'custom', message: 'Eligible remediation evidence cannot be blocked' });
  }
  if (proposal.state === 'applied' && (!proposal.appliedAt || proposal.backout.state !== 'forward-fix-only')) {
    context.addIssue({ code: 'custom', message: 'Applied remediation evidence requires immutable backout state' });
  }
  if (proposal.state !== 'applied' && proposal.appliedAt) {
    context.addIssue({ code: 'custom', message: 'Only applied remediation evidence can have an applied time' });
  }
});

export function parseWalletRemediationDocument(value: unknown): WalletRemediationDocument {
  return walletRemediationDocumentSchema.parse(value) as WalletRemediationDocument;
}

export function parseWalletRemediationProposalView(value: unknown): WalletRemediationProposalView {
  return walletRemediationProposalViewSchema.parse(value) as WalletRemediationProposalView;
}
