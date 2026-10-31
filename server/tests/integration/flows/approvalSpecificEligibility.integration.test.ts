/**
 * specific approval quorum against real PostgreSQL
 * (approval-specific--stale-votes-count-after-access-loss): an approve vote
 * from a listed approver counts only while that voter is still an effective
 * approver, using the real findEffectiveApproverIds query. Losing access does
 * not edit specificApprovers, so the threshold stays min(requiredApprovals,
 * specificApprovers.length) and the request stays pending.
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
const PASSWORD = 'Password123!';

describeWithDb('specific approval eligibility integration', () => {
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

  /**
   * Seeds an owner, approvers A and B with direct approver grants, and a
   * pending specific 2-of-2 request whose live policy lists A and B.
   */
  const seed = async () => {
    const owner = await createTestUser(prisma, { username: 'specific-owner', password: PASSWORD });
    const approverA = await createTestUser(prisma, { username: 'specific-a', password: PASSWORD });
    const approverB = await createTestUser(prisma, { username: 'specific-b', password: PASSWORD });

    const wallet = await prisma.wallet.create({
      data: {
        name: 'Specific approvers',
        type: 'single_sig',
        scriptType: 'native_segwit',
        users: {
          create: [
            { userId: owner.id, role: 'owner' },
            { userId: approverA.id, role: 'approver' },
            { userId: approverB.id, role: 'approver' },
          ],
        },
      },
    });
    const policy = await prisma.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Two named approvers',
        type: 'approval_required',
        config: {
          requiredApprovals: 2,
          quorumType: 'specific',
          specificApprovers: [approverA.id, approverB.id],
          allowSelfApproval: false,
        },
        createdBy: owner.id,
      },
    });
    const draft = await prisma.draftTransaction.create({
      data: {
        walletId: wallet.id,
        userId: owner.id,
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
        approvalStatus: 'pending',
      },
    });
    const request = await prisma.approvalRequest.create({
      data: {
        draftTransactionId: draft.id,
        policyId: policy.id,
        status: 'pending',
        requiredApprovals: 2,
        quorumType: 'specific',
        allowSelfApproval: false,
        expiresAt: null,
      },
    });

    return { wallet, draft, request, approverA, approverB };
  };

  const statuses = async (requestId: string, draftId: string) => ({
    request: (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
    draft: (await prisma.draftTransaction.findUniqueOrThrow({ where: { id: draftId } })).approvalStatus,
  });

  it('removing a listed approver after they approved keeps a specific request pending', async () => {
    const { wallet, draft, request, approverA, approverB } = await seed();

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await prisma.walletUser.deleteMany({ where: { walletId: wallet.id, userId: approverA.id } });
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'pending', draft: 'pending' });
  });

  it('downgrading a listed approver to viewer after they approved keeps a specific request pending', async () => {
    const { wallet, draft, request, approverA, approverB } = await seed();

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await prisma.walletUser.updateMany({
      where: { walletId: wallet.id, userId: approverA.id },
      data: { role: 'viewer' },
    });
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'pending', draft: 'pending' });
  });

  it('a specific request resolves when the listed voters still hold approver access', async () => {
    const { draft, request, approverA, approverB } = await seed();

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'approved', draft: 'approved' });
  });
});
