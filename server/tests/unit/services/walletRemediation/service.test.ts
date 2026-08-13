import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_FIXTURE_XPUB,
  provenAuditSnapshot,
} from '../../../fixtures/walletSafetyAuditFixture';
import type { WalletRemediationSnapshot } from '../../../../src/services/walletRemediation/types';

const repository = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  createProposal: vi.fn(),
  findExactProposal: vi.fn(),
  withSerializableTransaction: vi.fn(),
  lockApprovalGraph: vi.fn(),
  applyChanges: vi.fn(),
  appendEvent: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({ walletRemediationRepository: repository }));

import {
  approveWalletRemediationProposal,
  cancelWalletRemediationProposal,
  createWalletRemediationProposal,
  exportWalletRemediationProposal,
} from '../../../../src/services/walletRemediation';
import {
  remediationDigest,
  remediationProposalId,
} from '../../../../src/utils/walletRemediationCanonicalDocument';
import { buildWalletRemediationDocument } from '../../../../src/services/walletRemediation/proof';

const actor = { userId: 'owner-1', username: 'owner' };

function snapshot(versioned = false): WalletRemediationSnapshot {
  const fixture = provenAuditSnapshot();
  const wallet = fixture.wallets[0];
  return {
    wallet: {
      ...wallet,
      descriptorPolicyVersion: versioned ? 1 : null,
      canonicalPolicyId: versioned ? wallet.canonicalPolicyId : null,
      canonicalPolicyVersion: versioned ? 1 : null,
    },
    signers: [{
      id: 'link-1', walletId: wallet.id, deviceId: 'device-1',
      deviceAccountId: versioned ? 'account-1' : null,
      signerIndex: versioned ? 0 : null,
      signerBindingVersion: versioned ? 1 : null,
      signerFingerprint: versioned ? 'aabbccdd' : null,
      signerXpub: versioned ? AUDIT_FIXTURE_XPUB : null,
      signerDerivationPath: versioned ? "m/84'/1'/0'" : null,
      signerPurpose: versioned ? 'single_sig' : null,
      signerScriptType: versioned ? 'native_segwit' : null,
      deviceFingerprint: 'aabbccdd', accountId: 'account-1',
      accountPurpose: 'single_sig', accountScriptType: 'native_segwit',
      accountDerivationPath: "m/84'/1'/0'", accountXpub: AUDIT_FIXTURE_XPUB,
    }],
    addresses: fixture.addresses.map((address) => ({
      ...address,
      branch: versioned ? address.branch : null,
      coordinateVersion: versioned ? 1 : null,
      canonicalPolicyId: versioned ? address.canonicalPolicyId : null,
      canonicalPolicyVersion: versioned ? 1 : null,
      scriptPubKey: versioned ? address.scriptPubKey : null,
    })),
    ownerUserIds: [actor.userId],
  };
}

describe('wallet remediation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.withSerializableTransaction.mockImplementation((callback) => callback({ tx: true }));
  });

  it('creates an immutable content-addressed proposal and requires current ownership', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const id = remediationProposalId(digest);
    const stored = {
      id, walletId: legacy.wallet.id, proposalDigest: digest, document,
      createdAt: new Date('2026-08-11T00:00:00Z'), events: [],
    };
    repository.loadSnapshot.mockResolvedValue(legacy);
    repository.createProposal.mockResolvedValue(stored);
    repository.findExactProposal.mockResolvedValue(stored);

    await expect(createWalletRemediationProposal(legacy.wallet.id, actor)).resolves.toMatchObject({
      proposalId: id, proposalDigest: digest, state: 'pending', eligible: true,
    });
    expect(repository.createProposal).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      document: expect.objectContaining({ walletId: legacy.wallet.id, eligible: true }),
    }));

    repository.loadSnapshot.mockResolvedValue({ ...legacy, ownerUserIds: [] });
    await expect(createWalletRemediationProposal(legacy.wallet.id, actor)).rejects.toThrow('ownership changed');
  });

  it('re-proves under locks, applies exact changes, and appends the terminal event', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    repository.lockApprovalGraph.mockResolvedValue({
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document, createdAt: new Date('2026-08-11T00:00:00Z'), events: [],
    });
    repository.loadSnapshot.mockResolvedValueOnce(legacy).mockResolvedValueOnce(snapshot(true));
    repository.appendEvent.mockResolvedValue({ createdAt: new Date('2026-08-11T00:01:00Z') });

    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).resolves.toMatchObject({ state: 'applied', backout: { state: 'forward-fix-only' } });
    expect(repository.applyChanges).toHaveBeenCalledWith(
      { tx: true }, legacy.wallet.id, document.changes,
    );
    expect(repository.appendEvent).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      proposalId, proposalDigest: digest, kind: 'approved_applied', actor,
    }));
  });

  it('returns an existing applied event without writing again', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    repository.lockApprovalGraph.mockResolvedValue({
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document, createdAt: new Date('2026-08-11T00:00:00Z'),
      events: [{ kind: 'approved_applied', createdAt: new Date('2026-08-11T00:01:00Z') }],
    });

    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).resolves.toMatchObject({ state: 'applied' });
    expect(repository.loadSnapshot).not.toHaveBeenCalled();
    expect(repository.applyChanges).not.toHaveBeenCalled();
  });

  it('rejects stale metadata, revoked ownership, blocked proposals, and malformed identities', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    repository.lockApprovalGraph.mockResolvedValue({
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document, createdAt: new Date(), events: [],
    });
    const stale = snapshot();
    stale.addresses[0].address = stale.addresses[1].address;
    repository.loadSnapshot.mockResolvedValue(stale);
    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).rejects.toThrow('metadata changed');

    repository.loadSnapshot.mockResolvedValue({ ...legacy, ownerUserIds: [] });
    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).rejects.toThrow('ownership changed');

    repository.lockApprovalGraph.mockResolvedValue({
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document: { ...document, eligible: false }, createdAt: new Date(), events: [],
    });
    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).rejects.toThrow();

    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, 'latest', digest, actor,
    )).rejects.toThrow('Exact remediation proposal ID');
  });

  it('cancels without applying metadata and preserves immutable cancellation evidence', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    const locked = {
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document, createdAt: new Date('2026-08-11T00:00:00Z'), events: [],
    };
    repository.lockApprovalGraph.mockResolvedValue(locked);
    repository.loadSnapshot.mockResolvedValue(legacy);
    repository.appendEvent.mockResolvedValue({
      kind: 'cancelled', createdAt: new Date('2026-08-11T00:01:00Z'),
    });

    await expect(cancelWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).resolves.toMatchObject({ state: 'cancelled', backout: { state: 'not-applied' } });
    expect(repository.applyChanges).not.toHaveBeenCalled();
    expect(repository.appendEvent).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      proposalId, proposalDigest: digest, kind: 'cancelled', actor,
    }));
  });

  it('rolls back a failed approval before appending redacted failure evidence', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    const locked = {
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest,
      document, createdAt: new Date('2026-08-11T00:00:00Z'), events: [],
    };
    repository.lockApprovalGraph.mockResolvedValue(locked);
    repository.loadSnapshot.mockResolvedValue(legacy);
    repository.applyChanges.mockRejectedValueOnce(new Error('simulated atomic write failure'));
    repository.appendEvent.mockResolvedValue({ createdAt: new Date() });

    await expect(approveWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest, actor,
    )).rejects.toThrow('simulated atomic write failure');
    expect(repository.withSerializableTransaction).toHaveBeenCalledTimes(2);
    expect(repository.appendEvent).toHaveBeenCalledWith({ tx: true }, expect.objectContaining({
      kind: 'failed', details: { reasonCode: 'approval_rejected' },
    }));
  });

  it('exports the recoverable original state only with a verified event chain', async () => {
    const legacy = snapshot();
    const document = buildWalletRemediationDocument(legacy);
    const digest = remediationDigest(document);
    const proposalId = remediationProposalId(digest);
    const eventBody = {
      proposalId, proposalDigest: digest, sequence: 1, kind: 'cancelled',
      actorUserId: actor.userId, actorUsername: actor.username,
      details: { reasonCode: 'owner_cancelled' }, previousEventDigest: null,
    } as const;
    const stored = {
      id: proposalId, walletId: legacy.wallet.id, proposalDigest: digest, document,
      createdAt: new Date('2026-08-11T00:00:00Z'),
      events: [{
        id: 'event-1', ...eventBody, eventDigest: remediationDigest(eventBody),
        createdAt: new Date('2026-08-11T00:01:00Z'),
      }],
    };
    repository.findExactProposal.mockResolvedValue(stored);

    await expect(exportWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest,
    )).resolves.toMatchObject({
      proposal: {
        originalState: {
          wallet: legacy.wallet,
          signers: legacy.signers,
          addresses: [...legacy.addresses].sort((a, b) => a.id.localeCompare(b.id)),
          ownerUserIds: legacy.ownerUserIds,
        },
        state: 'cancelled',
      },
      events: [{ id: 'event-1', kind: 'cancelled', previousEventDigest: null }],
    });

    repository.findExactProposal.mockResolvedValue({
      ...stored,
      events: [{ ...stored.events[0], eventDigest: 'f'.repeat(64) }],
    });
    await expect(exportWalletRemediationProposal(
      legacy.wallet.id, proposalId, digest,
    )).rejects.toThrow('event chain is invalid');
  });
});
