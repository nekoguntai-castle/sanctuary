/**
 * any_n approval quorum against real PostgreSQL
 * (approval-any-n--stale-votes-count-after-access-loss): an approve vote counts
 * only while its voter is still an effective approver, using the real
 * findEffectiveApproverIds query (direct grant overrides group membership).
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

type Membership = 'direct' | 'group';

describeWithDb('any_n approval eligibility integration', () => {
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
   * Seeds an owner, approvers A and B, and a pending any_n 2-of-N request.
   * 'direct': A and B hold direct approver grants. 'group': A is an approver
   * only through the wallet's group; B keeps a direct grant.
   */
  const seed = async (membership: Membership) => {
    const owner = await createTestUser(prisma, { username: `anyn-owner-${membership}`, password: PASSWORD });
    const approverA = await createTestUser(prisma, { username: `anyn-a-${membership}`, password: PASSWORD });
    const approverB = await createTestUser(prisma, { username: `anyn-b-${membership}`, password: PASSWORD });

    const directUsers = [
      { userId: owner.id, role: 'owner' },
      ...(membership === 'direct' ? [{ userId: approverA.id, role: 'approver' }] : []),
      { userId: approverB.id, role: 'approver' },
    ];
    const group = membership === 'group'
      ? await prisma.group.create({
        data: { name: 'any_n approvers', members: { create: [{ userId: approverA.id }] } },
      })
      : null;

    const wallet = await prisma.wallet.create({
      data: {
        name: `Any N ${membership}`,
        type: 'single_sig',
        scriptType: 'native_segwit',
        ...(group ? { groupId: group.id, groupRole: 'approver' } : {}),
        users: { create: directUsers },
      },
    });
    const policy = await prisma.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Two approvers',
        type: 'approval_required',
        config: { requiredApprovals: 2, quorumType: 'any_n', allowSelfApproval: false },
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
        quorumType: 'any_n',
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

  it('removing an approver after they approved keeps an any_n request pending', async () => {
    const { wallet, draft, request, approverA, approverB } = await seed('direct');

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await prisma.walletUser.deleteMany({ where: { walletId: wallet.id, userId: approverA.id } });
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'pending', draft: 'pending' });
  });

  it('downgrading an approver to viewer after they approved keeps an any_n request pending', async () => {
    const { wallet, draft, request, approverA, approverB } = await seed('direct');

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await prisma.walletUser.updateMany({
      where: { walletId: wallet.id, userId: approverA.id },
      data: { role: 'viewer' },
    });
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'pending', draft: 'pending' });
  });

  it('an any_n request resolves when both voters still hold approver access', async () => {
    const { draft, request, approverA, approverB } = await seed('direct');

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'approved', draft: 'approved' });
  });

  it("a group-only approver's earlier vote still counts", async () => {
    const { draft, request, approverA, approverB } = await seed('group');

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'approved', draft: 'approved' });
  });

  it('a direct viewer grant overrides a group approver role', async () => {
    const { wallet, draft, request, approverA, approverB } = await seed('group');

    await approvalService.castVote(request.id, approverA.id, 'approve');
    await prisma.walletUser.create({ data: { walletId: wallet.id, userId: approverA.id, role: 'viewer' } });
    await approvalService.castVote(request.id, approverB.id, 'approve');

    expect(await statuses(request.id, draft.id)).toEqual({ request: 'pending', draft: 'pending' });
  });
});
