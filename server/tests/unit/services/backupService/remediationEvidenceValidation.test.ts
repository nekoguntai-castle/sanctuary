import { describe, expect, it } from 'vitest';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';
import { buildWalletRemediationDocument } from '../../../../src/services/walletRemediation/proof';
import {
  remediationDigest,
  remediationProposalId,
} from '../../../../src/services/walletRemediation/canonicalDocument';
import { validateRemediationEvidenceForRestore } from '../../../../src/services/backupService/remediationEvidenceValidation';
import type { BackupRecord } from '../../../../src/services/backupService';

const createProposal = (): BackupRecord => {
  const fixture = provenAuditSnapshot();
  const document = buildWalletRemediationDocument({
    wallet: {
      ...fixture.wallets[0],
      descriptorPolicyVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    },
    signers: fixture.signers.map(signer => ({
      id: signer.id,
      walletId: signer.walletId,
      deviceId: signer.deviceId,
      deviceAccountId: null,
      signerIndex: null,
      signerBindingVersion: null,
      signerFingerprint: null,
      signerXpub: null,
      signerDerivationPath: null,
      signerPurpose: null,
      signerScriptType: null,
      deviceFingerprint: signer.deviceFingerprint,
      accountId: signer.deviceAccountId,
      accountPurpose: signer.accountPurpose,
      accountScriptType: signer.accountScriptType,
      accountDerivationPath: signer.accountDerivationPath,
      accountXpub: signer.accountXpub,
    })),
    addresses: fixture.addresses.map(address => ({
      ...address,
      branch: null,
      coordinateVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
      scriptPubKey: null,
    })),
    ownerUserIds: ['owner-1'],
  }, '22222222-2222-4222-8222-222222222222');
  const proposalDigest = remediationDigest(document);
  return {
    id: remediationProposalId(proposalDigest),
    walletId: document.walletId,
    schemaVersion: document.schemaVersion,
    proposalDigest,
    document,
    createdByUserId: 'owner-1',
    createdByUsername: 'owner',
    createdAt: '2026-08-11T12:00:00.000Z',
  };
};

const createEvent = (
  proposal: BackupRecord,
  sequence: number,
  kind: 'approved_applied' | 'cancelled' | 'failed',
  previousEventDigest: string | null,
): BackupRecord => {
  const body = {
    proposalId: proposal.id as string,
    proposalDigest: proposal.proposalDigest as string,
    sequence,
    kind,
    actorUserId: 'owner-1',
    actorUsername: 'owner',
    details: kind === 'failed' ? { reasonCode: 'approval_rejected' } : {},
    previousEventDigest,
  };
  return {
    id: `event-${sequence}`,
    ...body,
    eventDigest: remediationDigest(body),
    createdAt: `2026-08-11T12:0${sequence}:00.000Z`,
  };
};

const validate = (proposal: BackupRecord, events: BackupRecord[] = []): string[] =>
  validateRemediationEvidenceForRestore({
    walletRemediationProposal: [proposal],
    walletRemediationEvent: events,
  });

describe('remediation evidence restore validation', () => {
  it('accepts a content-addressed proposal and a failed-event prefix followed by one terminal event', () => {
    const proposal = createProposal();
    const failed = createEvent(proposal, 1, 'failed', null);
    const terminal = createEvent(proposal, 2, 'approved_applied', failed.eventDigest as string);

    expect(validate(proposal, [terminal, failed])).toEqual([]);
  });

  it.each([
    ['document', (proposal: BackupRecord) => { proposal.document = { unsafe: true }; }],
    ['digest', (proposal: BackupRecord) => { proposal.proposalDigest = 'f'.repeat(64); }],
    ['content-addressed ID', (proposal: BackupRecord) => { proposal.id = `wallet-remediation-v1:${'f'.repeat(64)}`; }],
    ['wallet ID', (proposal: BackupRecord) => { proposal.walletId = 'other-wallet'; }],
    ['schema version', (proposal: BackupRecord) => { proposal.schemaVersion = 'future'; }],
  ])('rejects a proposal with a mismatched %s', (_label, mutate) => {
    const proposal = createProposal();
    mutate(proposal);
    expect(validate(proposal).join('; ')).toContain('Invalid immutable remediation proposal');
  });

  it('rejects duplicate proposal IDs and duplicate event IDs', () => {
    const proposal = createProposal();
    const event = createEvent(proposal, 1, 'failed', null);
    const data = {
      walletRemediationProposal: [proposal, { ...proposal }],
      walletRemediationEvent: [event, { ...event }],
    };

    const issues = validateRemediationEvidenceForRestore(data).join('; ');
    expect(issues).toContain('duplicate proposal ID');
    expect(issues).toContain('duplicate event ID');
  });

  it.each([
    ['proposal identity', (proposal: BackupRecord, events: BackupRecord[]) => {
      events[0].proposalDigest = 'f'.repeat(64);
    }],
    ['contiguous sequence', (_proposal: BackupRecord, events: BackupRecord[]) => {
      events[0].sequence = 2;
    }],
    ['previous digest', (_proposal: BackupRecord, events: BackupRecord[]) => {
      events[0].previousEventDigest = 'f'.repeat(64);
    }],
    ['event digest', (_proposal: BackupRecord, events: BackupRecord[]) => {
      events[0].eventDigest = 'f'.repeat(64);
    }],
  ])('rejects an event that breaks its %s', (_label, mutate) => {
    const proposal = createProposal();
    const events = [createEvent(proposal, 1, 'failed', null)];
    mutate(proposal, events);
    expect(validate(proposal, events).join('; ')).toContain('Invalid immutable remediation events');
  });

  it('rejects orphan events and malformed event records', () => {
    const proposal = createProposal();
    const orphan = createEvent(proposal, 1, 'failed', null);
    orphan.proposalId = 'wallet-remediation-v1:orphan';
    const malformed = { ...createEvent(proposal, 1, 'failed', null), details: { invalid: true } };

    const issues = validateRemediationEvidenceForRestore({
      walletRemediationProposal: [proposal],
      walletRemediationEvent: [orphan, malformed],
    }).join('; ');
    expect(issues).toContain('is missing');
    expect(issues).toContain('invalid immutable event shape');
  });

  it('rejects every event after a terminal event', () => {
    const proposal = createProposal();
    const terminal = createEvent(proposal, 1, 'cancelled', null);
    const afterTerminal = createEvent(proposal, 2, 'failed', terminal.eventDigest as string);

    expect(validate(proposal, [terminal, afterTerminal]).join('; ')).toContain(
      'appears after a terminal event',
    );
  });

  it('requires proposal and event tables to be present together', () => {
    expect(validateRemediationEvidenceForRestore({
      walletRemediationProposal: [],
    })).toEqual(['Immutable remediation proposal and event tables must both be arrays']);
    expect(validateRemediationEvidenceForRestore({})).toEqual([]);
  });
});
