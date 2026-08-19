export const WALLET_REMEDIATION_SCHEMA_VERSION = 'sanctuary.wallet-remediation.v1' as const;

export type RemediationState = 'pending' | 'blocked' | 'cancelled' | 'applied';

export interface RemediationBlocker {
  code: string;
  message: string;
}

/**
 * `wallet_policy` backfills canonical policy identity onto a wallet that already has a
 * descriptor policy. `wallet_policy_recovery` additionally assigns the descriptor policy
 * itself, for a wallet that predates policies and has none — a strictly larger write, kept
 * a separate kind so the repository allowlist and the review UI can treat it as such.
 */
export interface RemediationChange {
  kind: 'wallet_policy' | 'wallet_policy_recovery' | 'signer_binding' | 'address_coordinate';
  recordId: string;
  proposed: Record<string, string | number>;
  evidenceIds: string[];
}

export interface WalletRemediationDocument {
  schemaVersion: typeof WALLET_REMEDIATION_SCHEMA_VERSION;
  attemptId: string;
  proofDigest: string;
  walletId: string;
  eligible: boolean;
  originalStateDigest: string;
  originalState: WalletRemediationSnapshot;
  changes: RemediationChange[];
  blockers: RemediationBlocker[];
  proof: {
    preservedPolicyDigest: string;
    addressCount: number;
    unchangedAddressCount: number;
    scriptPubKeyCount: number;
    unchangedScriptPubKeyCount: number;
    recoveryStatus: 'recovery-proven' | 'blocked';
    signingStatus: 'not-tested';
    recoveryEvidenceDigest: string | null;
    evidenceIds: string[];
  };
  backout: {
    state: 'not-applied' | 'forward-fix-only';
    message: string;
  };
}

export interface WalletRemediationProposalView extends WalletRemediationDocument {
  proposalId: string;
  proposalDigest: string;
  createdAt: string;
  state: RemediationState;
  appliedAt?: string;
}

export interface WalletRemediationEventView {
  id: string;
  proposalId: string;
  sequence: number;
  proposalDigest: string;
  kind: 'approved_applied' | 'cancelled' | 'failed';
  actorUserId: string;
  actorUsername: string;
  details: Record<string, string | number>;
  previousEventDigest: string | null;
  eventDigest: string;
  createdAt: string;
}

export interface WalletRemediationExport {
  proposal: WalletRemediationProposalView;
  events: WalletRemediationEventView[];
}

export interface WalletRemediationActor {
  userId: string;
  username: string;
}

export interface RemediationWalletRow {
  id: string;
  type: string;
  scriptType: string;
  network: string;
  quorum: number | null;
  totalSigners: number | null;
  descriptor: string | null;
  changeDescriptor: string | null;
  descriptorPolicyVersion: number | null;
  descriptorSourceKind: string | null;
  sourceDescriptor: string | null;
  sourceChangeDescriptor: string | null;
  sourceDescriptorChecksum: string | null;
  sourceChangeDescriptorChecksum: string | null;
  fingerprint: string | null;
  canonicalPolicyId: string | null;
  canonicalPolicyVersion: number | null;
}

export interface RemediationSignerRow {
  id: string;
  walletId: string;
  deviceId: string;
  deviceAccountId: string | null;
  signerIndex: number | null;
  signerBindingVersion: number | null;
  signerFingerprint: string | null;
  signerXpub: string | null;
  signerDerivationPath: string | null;
  signerPurpose: string | null;
  signerScriptType: string | null;
  deviceFingerprint: string;
  accountId: string | null;
  accountPurpose: string | null;
  accountScriptType: string | null;
  accountDerivationPath: string | null;
  accountXpub: string | null;
}

export interface RemediationAddressRow {
  id: string;
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  branch: number | null;
  coordinateVersion: number | null;
  canonicalPolicyId: string | null;
  canonicalPolicyVersion: number | null;
  scriptPubKey: string | null;
}

export interface WalletRemediationSnapshot {
  wallet: RemediationWalletRow;
  signers: RemediationSignerRow[];
  addresses: RemediationAddressRow[];
  ownerUserIds: string[];
}
