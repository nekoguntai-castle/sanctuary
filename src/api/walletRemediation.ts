import { z } from 'zod';
import apiClient from './client';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const proposalIdSchema = z.string().regex(/^wallet-remediation-v1:[a-f0-9]{64}$/);
const nullableString = z.string().min(1).nullable();
const changeBase = {
  recordId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
} as const;
const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()
  .refine(value => Object.keys(value).length > 0, 'An exact metadata patch is required');
const remediationChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    ...changeBase,
    kind: z.literal('wallet_policy'),
    proposed: nonEmptyPatch({
      descriptorPolicyVersion: z.number().int().positive().optional(),
      descriptorSourceKind: z.string().min(1).optional(),
      sourceDescriptorChecksum: z.string().min(1).optional(),
      sourceChangeDescriptorChecksum: z.string().min(1).optional(),
      canonicalPolicyId: z.string().min(1).optional(),
      canonicalPolicyVersion: z.number().int().positive().optional(),
    }),
  }).strict(),
  z.object({
    ...changeBase,
    kind: z.literal('signer_binding'),
    proposed: nonEmptyPatch({
      deviceAccountId: z.string().min(1).optional(), signerIndex: z.number().int().nonnegative().optional(),
      signerBindingVersion: z.number().int().positive().optional(),
      signerFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
      signerXpub: z.string().min(1).optional(), signerDerivationPath: z.string().min(1).optional(),
      signerPurpose: z.enum(['single_sig', 'multisig']).optional(), signerScriptType: z.string().min(1).optional(),
    }),
  }).strict(),
  z.object({
    ...changeBase,
    kind: z.literal('address_coordinate'),
    proposed: nonEmptyPatch({
      branch: z.number().int().min(0).max(1).optional(), coordinateVersion: z.number().int().positive().optional(),
      canonicalPolicyId: z.string().min(1).optional(), canonicalPolicyVersion: z.number().int().positive().optional(),
      scriptPubKey: z.string().regex(/^[a-f0-9]+$/).optional(),
    }),
  }).strict(),
]);

const remediationWalletSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  scriptType: z.string().min(1),
  network: z.string().min(1),
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
}).strict();

const remediationSignerSchema = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceAccountId: nullableString,
  signerIndex: z.number().int().nullable(),
  signerBindingVersion: z.number().int().nullable(),
  signerFingerprint: nullableString,
  signerXpub: nullableString,
  signerDerivationPath: nullableString,
  signerPurpose: nullableString,
  signerScriptType: nullableString,
  deviceFingerprint: z.string().min(1),
  accountId: nullableString,
  accountPurpose: nullableString,
  accountScriptType: nullableString,
  accountDerivationPath: nullableString,
  accountXpub: nullableString,
}).strict();

const remediationAddressSchema = z.object({
  id: z.string().min(1),
  walletId: z.string().min(1),
  address: z.string().min(1),
  derivationPath: z.string().min(1),
  index: z.number().int().nonnegative(),
  branch: z.number().int().min(0).max(1).nullable(),
  coordinateVersion: z.number().int().nullable(),
  canonicalPolicyId: nullableString,
  canonicalPolicyVersion: z.number().int().nullable(),
  scriptPubKey: nullableString,
}).strict();

const remediationSnapshotSchema = z.object({
  wallet: remediationWalletSchema,
  signers: z.array(remediationSignerSchema),
  addresses: z.array(remediationAddressSchema),
  ownerUserIds: z.array(z.string().min(1)).min(1),
}).strict();

const walletRemediationProposalBaseSchema = z.object({
  proposalId: proposalIdSchema,
  attemptId: z.string().uuid(),
  proofDigest: digestSchema,
  walletId: z.string().min(1),
  schemaVersion: z.literal('sanctuary.wallet-remediation.v1'),
  proposalDigest: digestSchema,
  originalStateDigest: digestSchema,
  originalState: remediationSnapshotSchema,
  createdAt: z.string().datetime(),
  state: z.enum(['pending', 'blocked', 'cancelled', 'applied']),
  eligible: z.boolean(),
  changes: z.array(remediationChangeSchema),
  proof: z.object({
    preservedPolicyDigest: digestSchema,
    addressCount: z.number().int().nonnegative(),
    unchangedAddressCount: z.number().int().nonnegative(),
    scriptPubKeyCount: z.number().int().nonnegative(),
    unchangedScriptPubKeyCount: z.number().int().nonnegative(),
    recoveryStatus: z.enum(['recovery-proven', 'blocked']),
    signingStatus: z.literal('not-tested'),
    recoveryEvidenceDigest: digestSchema.nullable(),
    evidenceIds: z.array(z.string().min(1)),
  }).strict(),
  blockers: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).strict()),
  backout: z.object({
    state: z.enum(['not-applied', 'forward-fix-only']),
    message: z.string().min(1),
  }).strict(),
  appliedAt: z.string().datetime().optional(),
}).strict();

type ProposalCandidate = z.infer<typeof walletRemediationProposalBaseSchema>;
type RefinementContext = z.RefinementCtx;

const addProposalIssue = (context: RefinementContext, message: string): void => {
  context.addIssue({ code: 'custom', message });
};

const validateProposalIdentity = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (proposal.proposalId !== `wallet-remediation-v1:${proposal.proposalDigest}`) {
    addProposalIssue(context, 'Proposal ID does not match its immutable digest');
  }
};

const validateEligibilityState = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (proposal.eligible && !['pending', 'cancelled', 'applied'].includes(proposal.state)) {
    addProposalIssue(context, 'Eligible remediation proposal has an invalid state');
  }
  if (!proposal.eligible && proposal.state !== 'blocked') {
    addProposalIssue(context, 'Ineligible remediation proposal must be blocked');
  }
};

const validateAppliedState = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (proposal.state === 'applied' && (!proposal.appliedAt || proposal.backout.state !== 'forward-fix-only')) {
    addProposalIssue(context, 'Applied remediation evidence has an invalid backout state');
  }
  if (proposal.state !== 'applied' && proposal.appliedAt) {
    addProposalIssue(context, 'Only applied remediation evidence can include appliedAt');
  }
};

const validatePreservationProof = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (proposal.eligible && proposal.proof.unchangedAddressCount !== proposal.proof.addressCount) {
    addProposalIssue(context, 'Address proof is incomplete');
  }
  if (proposal.eligible && proposal.proof.unchangedScriptPubKeyCount !== proposal.proof.scriptPubKeyCount) {
    addProposalIssue(context, 'Script proof is incomplete');
  }
};

const validateRecoveryProof = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (proposal.eligible && (proposal.blockers.length > 0
    || proposal.proof.recoveryStatus !== 'recovery-proven'
    || !proposal.proof.recoveryEvidenceDigest
    || proposal.proof.evidenceIds.length === 0)) {
    addProposalIssue(context, 'Eligible remediation proof is not recovery-proven and unblocked');
  }
};

const validateBlockedProposal = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (!proposal.eligible && (proposal.changes.length > 0 || proposal.blockers.length === 0)) {
    addProposalIssue(context, 'Blocked remediation evidence cannot contain a patch');
  }
  if (!proposal.eligible && proposal.proof.recoveryEvidenceDigest !== null) {
    addProposalIssue(context, 'Blocked remediation evidence cannot claim recovery proof');
  }
};

const hasInconsistentWalletIdentity = (proposal: ProposalCandidate): boolean => {
  return proposal.walletId !== proposal.originalState.wallet.id
    || proposal.originalState.signers.some(signer => signer.walletId !== proposal.walletId)
    || proposal.originalState.addresses.some(address => address.walletId !== proposal.walletId);
};

const validateOriginalStateIdentity = (proposal: ProposalCandidate, context: RefinementContext): void => {
  if (hasInconsistentWalletIdentity(proposal)) {
    addProposalIssue(context, 'Original remediation state has inconsistent wallet identity');
  }
};

const validateWalletRemediationProposal = (proposal: ProposalCandidate, context: RefinementContext): void => {
  validateProposalIdentity(proposal, context);
  validateEligibilityState(proposal, context);
  validateAppliedState(proposal, context);
  validatePreservationProof(proposal, context);
  validateRecoveryProof(proposal, context);
  validateBlockedProposal(proposal, context);
  validateOriginalStateIdentity(proposal, context);
};

export const WalletRemediationProposalSchema = walletRemediationProposalBaseSchema
  .superRefine(validateWalletRemediationProposal);

export type WalletRemediationProposal = z.infer<typeof WalletRemediationProposalSchema>;

function requireRequestedWallet(
  requestedWalletId: string,
  proposal: WalletRemediationProposal,
): WalletRemediationProposal {
  if (proposal.walletId !== requestedWalletId) {
    throw new Error('Remediation response does not belong to the requested wallet');
  }
  return proposal;
}

export async function createWalletRemediationProposal(
  walletId: string,
  signal?: AbortSignal,
): Promise<WalletRemediationProposal> {
  const proposal = await apiClient.post<WalletRemediationProposal>(
    `/wallets/${walletId}/remediation/proposals`,
    {},
    { signal, schema: WalletRemediationProposalSchema },
  );
  return requireRequestedWallet(walletId, proposal);
}

export async function approveWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  signal?: AbortSignal,
): Promise<WalletRemediationProposal> {
  const proposal = await apiClient.post<WalletRemediationProposal>(
    `/wallets/${walletId}/remediation/proposals/${proposalId}/approve`,
    { proposalDigest },
    { signal, schema: WalletRemediationProposalSchema },
  );
  return requireRequestedWallet(walletId, proposal);
}

export async function cancelWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  signal?: AbortSignal,
): Promise<WalletRemediationProposal> {
  const proposal = await apiClient.post<WalletRemediationProposal>(
    `/wallets/${walletId}/remediation/proposals/${proposalId}/cancel`,
    { proposalDigest },
    { signal, schema: WalletRemediationProposalSchema },
  );
  return requireRequestedWallet(walletId, proposal);
}

export function exportWalletRemediationProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
  walletName: string,
): Promise<void> {
  const safeName = walletName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeProposalId = proposalId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return apiClient.download(
    `/wallets/${walletId}/remediation/proposals/${proposalId}/export`,
    `${safeName}_remediation_${safeProposalId}.json`,
    { params: { digest: proposalDigest } },
  );
}
