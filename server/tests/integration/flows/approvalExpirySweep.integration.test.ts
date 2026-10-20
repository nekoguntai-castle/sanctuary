/**
 * The approval expiry sweep against real PostgreSQL
 * (approval-expiry--draft-stuck-pending-forever): exercises the overdue
 * pending-request query and the relation-filter + distinct repair query.
 */
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { approvalService } from '../../../src/services/vaultPolicy/approvalService';
import { createTestUser } from '../setup/helpers';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;
const HOUR_MS = 60 * 60 * 1000;

describeWithDb('Approval expiry sweep integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  const seed = async () => {
    const user = await createTestUser(prisma, { username: 'expiry-sweep-user', password: 'Password123!' });
    const wallet = await prisma.wallet.create({
      data: { name: 'Expiry Sweep', type: 'single_sig', scriptType: 'native_segwit' },
    });
    const policy = await prisma.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Approval policy',
        type: 'approval_required',
        config: { requiredApprovals: 1, quorumType: 'any_n' },
        createdBy: user.id,
      },
    });
    const draft = (approvalStatus: string) => prisma.draftTransaction.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
        recipient: 'tb1qexampleexampleexampleexampleexample',
        amount: 1000n,
        feeRate: 1,
        selectedUtxoIds: [],
        psbtBase64: 'cHNidP8=',
        fee: 100n,
        totalInput: 1100n,
        totalOutput: 1000n,
        changeAmount: 0n,
        effectiveAmount: 1000n,
        inputPaths: [],
        approvalStatus,
      },
    });
    const request = (draftTransactionId: string, status: string, expiresAt: Date | null) =>
      prisma.approvalRequest.create({
        data: { draftTransactionId, policyId: policy.id, status, requiredApprovals: 1, quorumType: 'any_n', expiresAt },
      });
    return { draft, request };
  };

  it('expires overdue requests, repairs stuck drafts and leaves live and settled ones alone', async () => {
    const { draft, request } = await seed();
    const now = new Date();
    const past = new Date(now.getTime() - HOUR_MS);
    const future = new Date(now.getTime() + HOUR_MS);

    const overdueDraft = await draft('pending');
    const overdueRequests = await Promise.all([
      request(overdueDraft.id, 'pending', past),
      request(overdueDraft.id, 'pending', new Date(now.getTime() - 2 * HOUR_MS)),
    ]);
    const stuckDraft = await draft('pending');
    const stuckRequest = await request(stuckDraft.id, 'expired', past);
    const liveDraft = await draft('pending');
    const liveRequest = await request(liveDraft.id, 'pending', future);
    const noExpiryDraft = await draft('pending');
    const noExpiryRequest = await request(noExpiryDraft.id, 'pending', null);
    const rejectedDraft = await draft('rejected');
    await request(rejectedDraft.id, 'expired', past);

    await expect(approvalService.expireOverdueApprovals(now))
      .resolves.toEqual({ expiredRequests: 2, updatedDrafts: 2 });

    const statusOf = async (id: string) =>
      (await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status;
    const draftStatus = async (id: string) =>
      (await prisma.draftTransaction.findUniqueOrThrow({ where: { id } })).approvalStatus;

    for (const overdue of overdueRequests) {
      expect(await statusOf(overdue.id)).toBe('expired');
    }
    expect(await draftStatus(overdueDraft.id)).toBe('expired');
    expect(await statusOf(stuckRequest.id)).toBe('expired');
    expect(await draftStatus(stuckDraft.id)).toBe('expired');
    expect(await statusOf(liveRequest.id)).toBe('pending');
    expect(await draftStatus(liveDraft.id)).toBe('pending');
    expect(await statusOf(noExpiryRequest.id)).toBe('pending');
    expect(await draftStatus(noExpiryDraft.id)).toBe('pending');
    expect(await draftStatus(rejectedDraft.id)).toBe('rejected');

    // A second pass finds nothing left to do.
    await expect(approvalService.expireOverdueApprovals(now))
      .resolves.toEqual({ expiredRequests: 0, updatedDrafts: 0 });
  });
});
