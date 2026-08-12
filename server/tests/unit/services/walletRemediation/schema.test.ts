import { describe, expect, it } from 'vitest';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';
import { buildWalletRemediationDocument } from '../../../../src/services/walletRemediation/proof';
import {
  parseWalletRemediationDocument,
  parseWalletRemediationProposalView,
} from '../../../../src/services/walletRemediation/schema';
import type { WalletRemediationSnapshot } from '../../../../src/services/walletRemediation/types';

describe('wallet remediation runtime schema', () => {
  function eligibleDocument() {
    const fixture = provenAuditSnapshot();
    return buildWalletRemediationDocument({
      wallet: {
        ...fixture.wallets[0],
        descriptorPolicyVersion: null,
        canonicalPolicyId: null,
        canonicalPolicyVersion: null,
      },
      signers: fixture.signers.map((signer) => ({
        ...signer,
        deviceAccountId: null,
        signerIndex: null,
        signerBindingVersion: null,
        signerFingerprint: null,
        signerXpub: null,
        signerDerivationPath: null,
        signerPurpose: null,
        signerScriptType: null,
        accountId: signer.deviceAccountId,
      })),
      addresses: fixture.addresses.map((address) => ({
        ...address,
        branch: null,
        coordinateVersion: null,
        canonicalPolicyId: null,
        canonicalPolicyVersion: null,
        scriptPubKey: null,
      })),
      ownerUserIds: ['owner-1'],
    } as WalletRemediationSnapshot);
  }

  function proposal(overrides: Record<string, unknown> = {}) {
    return {
      ...eligibleDocument(),
      proposalId: `wallet-remediation-v1:${'a'.repeat(64)}`,
      proposalDigest: 'b'.repeat(64),
      createdAt: '2026-08-11T00:00:00.000Z',
      state: 'pending',
      ...overrides,
    };
  }

  it('rejects unknown or funds-controlling patch fields', () => {
    const fixture = provenAuditSnapshot();
    const document = buildWalletRemediationDocument({
      wallet: fixture.wallets[0], signers: [], addresses: fixture.addresses,
      ownerUserIds: ['owner-1'],
    } as WalletRemediationSnapshot);
    const unsafe = {
      ...document,
      changes: [{
        kind: 'wallet_policy', recordId: document.walletId,
        proposed: { descriptor: 'changed' }, evidenceIds: ['unsafe'],
      }],
    };

    expect(() => parseWalletRemediationDocument(unsafe)).toThrow();
  });

  it('rejects eligible evidence unless counts, blockers, and recovery proof agree', () => {
    const document = eligibleDocument();

    expect(() => parseWalletRemediationDocument({
      ...document,
      proof: { ...document.proof, unchangedAddressCount: document.proof.addressCount - 1 },
    })).toThrow('Eligible remediation evidence must be exact and unblocked');
    expect(() => parseWalletRemediationDocument({
      ...document,
      blockers: [{ code: 'unexpected', message: 'Unexpected blocker' }],
    })).toThrow('Eligible remediation evidence must be exact and unblocked');
    expect(() => parseWalletRemediationDocument({
      ...document,
      proof: { ...document.proof, recoveryStatus: 'blocked' },
    })).toThrow('Eligible remediation evidence must be exact and unblocked');
  });

  it('rejects blocked evidence that contains a patch or lacks a blocker', () => {
    const document = eligibleDocument();
    expect(() => parseWalletRemediationDocument({ ...document, eligible: false })).toThrow(
      'Blocked remediation evidence cannot contain a patch',
    );
    expect(() => parseWalletRemediationDocument({
      ...document,
      eligible: false,
      changes: [],
      blockers: [],
      proof: { ...document.proof, recoveryStatus: 'blocked', evidenceIds: [] },
    })).toThrow('Blocked remediation evidence cannot contain a patch');
  });

  it('authenticates the original-state wallet identity and both evidence digests', () => {
    const document = eligibleDocument();
    expect(() => parseWalletRemediationDocument({
      ...document,
      originalState: {
        ...document.originalState,
        wallet: { ...document.originalState.wallet, id: 'another-wallet' },
      },
    })).toThrow('Original remediation state has inconsistent wallet identity');
    expect(() => parseWalletRemediationDocument({
      ...document,
      originalState: {
        ...document.originalState,
        signers: document.originalState.signers.map(signer => ({ ...signer, walletId: 'another-wallet' })),
      },
    })).toThrow('Original remediation state has inconsistent wallet identity');
    expect(() => parseWalletRemediationDocument({
      ...document,
      originalState: {
        ...document.originalState,
        addresses: document.originalState.addresses.map(address => ({ ...address, walletId: 'another-wallet' })),
      },
    })).toThrow('Original remediation state has inconsistent wallet identity');
    expect(() => parseWalletRemediationDocument({
      ...document,
      originalStateDigest: 'f'.repeat(64),
    })).toThrow('Original remediation state digest does not match');
    expect(() => parseWalletRemediationDocument({
      ...document,
      proofDigest: 'f'.repeat(64),
    })).toThrow('Remediation proof digest does not match');
  });

  it('enforces proposal state, applied time, and immutable backout semantics', () => {
    const blockedDocument = {
      ...eligibleDocument(),
      eligible: false,
      changes: [],
      blockers: [{ code: 'blocked', message: 'Blocked' }],
      proof: {
        ...eligibleDocument().proof,
        unchangedAddressCount: 0,
        unchangedScriptPubKeyCount: 0,
        recoveryStatus: 'blocked',
        evidenceIds: [],
      },
    };
    expect(() => parseWalletRemediationProposalView({
      ...proposal(), ...blockedDocument, state: 'pending',
    })).toThrow('Ineligible remediation evidence must remain blocked');
    expect(() => parseWalletRemediationProposalView(proposal({ state: 'blocked' }))).toThrow(
      'Eligible remediation evidence cannot be blocked',
    );
    expect(() => parseWalletRemediationProposalView(proposal({ state: 'applied' }))).toThrow(
      'Applied remediation evidence requires immutable backout state',
    );
    expect(() => parseWalletRemediationProposalView(proposal({
      state: 'applied',
      appliedAt: '2026-08-11T00:01:00.000Z',
    }))).toThrow('Applied remediation evidence requires immutable backout state');
    expect(() => parseWalletRemediationProposalView(proposal({
      appliedAt: '2026-08-11T00:01:00.000Z',
    }))).toThrow('Only applied remediation evidence can have an applied time');

    expect(parseWalletRemediationProposalView(proposal({
      state: 'applied',
      appliedAt: '2026-08-11T00:01:00.000Z',
      backout: { state: 'forward-fix-only', message: 'Use a reviewed forward fix.' },
    })).state).toBe('applied');
  });
});
