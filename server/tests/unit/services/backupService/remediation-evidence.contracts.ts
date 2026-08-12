import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { BackupService, type SanctuaryBackup } from '../../../../src/services/backupService';
import { migrationService } from '../../../../src/services/migrationService';
import {
  COMPLETE_TABLE_POLICY_HASH,
  COMPLETE_TABLE_POLICY_VERSION,
  PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH,
  TABLE_ORDER,
  getRestoreTables,
} from '../../../../src/services/backupService/constants';
import {
  allBackupDatabaseTables,
  mockAllBackupTablesExist,
} from './backupServiceTestHarness';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';
import { buildWalletRemediationDocument } from '../../../../src/services/walletRemediation/proof';
import {
  remediationDigest,
  remediationProposalId,
} from '../../../../src/services/walletRemediation/canonicalDocument';

const auditFixture = provenAuditSnapshot();
const document = buildWalletRemediationDocument({
  wallet: {
    ...auditFixture.wallets[0],
    descriptorPolicyVersion: null,
    canonicalPolicyId: null,
    canonicalPolicyVersion: null,
  },
  signers: auditFixture.signers.map(signer => ({
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
  addresses: auditFixture.addresses.map(address => ({
    ...address,
    branch: null,
    coordinateVersion: null,
    canonicalPolicyId: null,
    canonicalPolicyVersion: null,
    scriptPubKey: null,
  })),
  ownerUserIds: ['user-1'],
}, '11111111-1111-4111-8111-111111111111');
const proposalDigest = remediationDigest(document);
const proposal = {
  id: remediationProposalId(proposalDigest),
  walletId: document.walletId,
  schemaVersion: 'sanctuary.wallet-remediation.v1',
  proposalDigest,
  document,
  createdByUserId: 'user-1',
  createdByUsername: 'owner',
  createdAt: '2026-08-11T12:00:00.000Z',
};

const eventBody = {
  proposalId: proposal.id,
  proposalDigest: proposal.proposalDigest,
  sequence: 1,
  kind: 'approved_applied',
  actorUserId: 'user-1',
  actorUsername: 'owner',
  details: { addressCount: 2 },
  previousEventDigest: null,
} as const;
const event = {
  id: 'event-1',
  ...eventBody,
  eventDigest: remediationDigest(eventBody),
  createdAt: '2026-08-11T12:01:00.000Z',
};

const completeBackup = (): SanctuaryBackup => {
  const data: SanctuaryBackup['data'] = Object.fromEntries(
    TABLE_ORDER.map(table => [table, []]),
  );
  data.user = [{
    id: 'user-1',
    username: 'owner',
    password: 'password-hash',
    isAdmin: true,
    createdAt: '2026-08-11T11:00:00.000Z',
    updatedAt: '2026-08-11T11:00:00.000Z',
  }];
  data.walletRemediationProposal = [{ ...proposal }];
  data.walletRemediationEvent = [{ ...event }];
  return {
    meta: {
      version: '1.1.0',
      appVersion: '0.9.0',
      schemaVersion: 1,
      createdAt: '2026-08-11T13:00:00.000Z',
      createdBy: 'admin',
      includesCache: false,
      recordCounts: Object.fromEntries(
        Object.entries(data).map(([table, records]) => [table, records.length]),
      ),
      tablePolicy: {
        version: COMPLETE_TABLE_POLICY_VERSION,
        hash: COMPLETE_TABLE_POLICY_HASH,
      },
    },
    data,
  };
};

export function registerBackupRemediationEvidenceTests(): void {
describe('immutable wallet remediation backup evidence', () => {
  let backupService: BackupService;

  beforeEach(() => {
    backupService = new BackupService();
    resetPrismaMocks();
    vi.clearAllMocks();
    vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(1);
    mockAllBackupTablesExist();
    mockPrismaClient.$transaction.mockImplementation(async (fn: any) => fn(mockPrismaClient));
  });

  it('exports proposals before their events in complete backups', async () => {
    const client = mockPrismaClient as any;
    client.walletRemediationProposal.findMany.mockResolvedValueOnce([{
      ...proposal,
      createdAt: new Date(proposal.createdAt),
    }]);
    client.walletRemediationEvent.findMany.mockResolvedValueOnce([{
      ...event,
      createdAt: new Date(event.createdAt),
    }]);

    const backup = await backupService.createBackup('admin');

    expect(backup.data.walletRemediationProposal).toEqual([{ ...proposal }]);
    expect(backup.data.walletRemediationEvent).toEqual([{ ...event }]);
    expect(Object.keys(backup.data).indexOf('walletRemediationProposal')).toBeLessThan(
      Object.keys(backup.data).indexOf('walletRemediationEvent'),
    );
  });

  it('preserves byte-equivalent live evidence without deleting or reinserting it', async () => {
    const backup = completeBackup();
    const client = mockPrismaClient as any;
    client.walletRemediationProposal.findUnique.mockResolvedValueOnce({
      ...proposal,
      createdAt: new Date(proposal.createdAt),
    });
    client.walletRemediationEvent.findUnique.mockResolvedValueOnce({
      ...event,
      createdAt: new Date(event.createdAt),
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success, result.error).toBe(true);
    expect(client.walletRemediationProposal.deleteMany).not.toHaveBeenCalled();
    expect(client.walletRemediationEvent.deleteMany).not.toHaveBeenCalled();
    expect(client.walletRemediationProposal.create).not.toHaveBeenCalled();
    expect(client.walletRemediationEvent.create).not.toHaveBeenCalled();
  });

  it('fails the serializable restore when a live evidence ID has different bytes', async () => {
    const backup = completeBackup();
    const client = mockPrismaClient as any;
    client.walletRemediationProposal.findUnique.mockResolvedValueOnce({
      ...proposal,
      document: { proof: { unchanged: false }, changes: [] },
      createdAt: new Date(proposal.createdAt),
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.error).toContain(
      `Immutable evidence mismatch in walletRemediationProposal for ID ${proposal.id}`,
    );
    expect(client.walletRemediationProposal.create).not.toHaveBeenCalled();
    expect(client.walletRemediationEvent.create).not.toHaveBeenCalled();
  });

  it('inserts missing proposal evidence before dependent events', async () => {
    const backup = completeBackup();
    const client = mockPrismaClient as any;
    const order: string[] = [];
    client.walletRemediationProposal.findUnique.mockResolvedValueOnce(null);
    client.walletRemediationEvent.findUnique.mockResolvedValueOnce(null);
    client.walletRemediationProposal.create.mockImplementationOnce(async ({ data }: any) => {
      order.push('proposal');
      return data;
    });
    client.walletRemediationEvent.create.mockImplementationOnce(async ({ data }: any) => {
      order.push('event');
      return data;
    });

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success, result.error).toBe(true);
    expect(order).toEqual(['proposal', 'event']);
  });

  it('rejects immutable evidence without an exact non-empty ID', async () => {
    const backup = completeBackup();
    backup.data.walletRemediationProposal = [{ ...proposal, id: '' }];
    const client = mockPrismaClient as any;

    const result = await backupService.restoreFromBackup(backup);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.error).toContain('content-addressed ID does not match its document');
    expect(client.walletRemediationProposal.findUnique).not.toHaveBeenCalled();
    expect(client.walletRemediationProposal.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('accepts the immediately prior policy without requiring evidence tables', async () => {
    const backup = completeBackup();
    backup.meta.tablePolicy!.hash = PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH;
    delete backup.data.walletRemediationProposal;
    delete backup.data.walletRemediationEvent;
    delete backup.meta.recordCounts.walletRemediationProposal;
    delete backup.meta.recordCounts.walletRemediationEvent;

    const validation = await backupService.validateBackupForRestore(backup);

    expect(validation.valid, validation.issues.join('; ')).toBe(true);
    expect(getRestoreTables(backup.meta)).not.toContain('walletRemediationProposal');
    expect(getRestoreTables(backup.meta)).not.toContain('walletRemediationEvent');

    mockPrismaClient.$queryRaw.mockResolvedValue(allBackupDatabaseTables.filter(
      ({ tablename }) => !tablename.startsWith('wallet_remediation_'),
    ));
    const restored = await backupService.restoreFromBackup(backup);
    expect(restored.success, restored.error).toBe(true);
  });
});
}
