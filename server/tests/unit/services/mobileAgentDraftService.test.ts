import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/errors';

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    findPendingAgentDraftsForUser: vi.fn(),
    findPendingAgentDraftByIdForUser: vi.fn(),
    findAgentDraftByIdForUser: vi.fn(),
    updateApprovalStatus: vi.fn(),
  },
  policyRepository: {
    findPolicyById: vi.fn(),
  },
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: {
    getApprovalsForDraft: vi.fn(),
    castVote: vi.fn(),
    isEligibleSpecificApprover: vi.fn(),
  },
}));

vi.mock('../../../src/services/draftService', () => ({
  draftService: {
    updateDraft: vi.fn(),
  },
}));

vi.mock('../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: {
    getEffectivePermissions: vi.fn(),
  },
}));

import { draftRepository } from '../../../src/repositories';
import { draftService } from '../../../src/services/draftService';
import { mobilePermissionService } from '../../../src/services/mobilePermissions';
import { approvalService } from '../../../src/services/vaultPolicy/approvalService';
import { mobileAgentDraftService } from '../../../src/services/mobileAgentDraftService';

const basePermissions = {
  viewBalance: true,
  viewTransactions: true,
  viewUtxos: true,
  createTransaction: true,
  broadcast: true,
  signPsbt: true,
  generateAddress: true,
  manageLabels: false,
  manageDevices: false,
  shareWallet: false,
  deleteWallet: false,
  approveTransaction: false,
  managePolicies: false,
};

const approverPermissions = { ...basePermissions, approveTransaction: true };

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    draftTransactionId: 'draft-1',
    policyId: 'policy-1',
    status: 'pending',
    quorumType: 'any_n',
    requiredApprovals: 1,
    allowSelfApproval: true,
    expiresAt: null,
    votes: [] as Array<{ userId: string }>,
    ...overrides,
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    walletId: 'wallet-1',
    userId: 'agent-user',
    recipient: 'tb1qagentwallet',
    amount: BigInt('5000000000'),
    feeRate: 3.5,
    selectedUtxoIds: ['txid:0'],
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    outputs: [{ address: 'tb1qagentwallet', amount: 5000000000 }],
    inputs: [{ txid: 'txid', vout: 0 }],
    decoyOutputs: null,
    payjoinUrl: null,
    isRBF: false,
    label: 'Agent funding',
    memo: null,
    psbtBase64: 'unsigned',
    signedPsbtBase64: 'signed-by-agent',
    fee: BigInt(400),
    totalInput: BigInt('5000000400'),
    totalOutput: BigInt('5000000000'),
    changeAmount: BigInt(0),
    changeAddress: null,
    effectiveAmount: BigInt('5000000000'),
    inputPaths: ["m/48'/1'/0'/2'/0/0"],
    status: 'partial',
    signedDeviceIds: ['agent-device'],
    agentId: 'agent-1',
    agentOperationalWalletId: 'operational-wallet-1',
    createdAt: new Date('2026-04-16T10:00:00.000Z'),
    updatedAt: new Date('2026-04-16T10:01:00.000Z'),
    expiresAt: new Date('2026-04-17T10:00:00.000Z'),
    approvalStatus: 'not_required',
    policySnapshot: null,
    approvedAt: null,
    approvedBy: null,
    wallet: {
      id: 'wallet-1',
      name: 'Funding multisig',
      type: 'multi_sig',
      network: 'testnet',
    },
    ...overrides,
  };
}

describe('mobileAgentDraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: basePermissions,
    });
  });

  it('lists pending agent drafts with string satoshi amounts and deep-link payloads', async () => {
    (draftRepository.findPendingAgentDraftsForUser as Mock).mockResolvedValue([makeDraft()]);

    const result = await mobileAgentDraftService.listPendingAgentFundingDrafts('user-1', 25);

    expect(draftRepository.findPendingAgentDraftsForUser).toHaveBeenCalledWith('user-1', 25);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'draft-1',
      amountSats: '5000000000',
      feeSats: '400',
      agentId: 'agent-1',
      agentOperationalWalletId: 'operational-wallet-1',
      signing: {
        canSign: true,
        signedDeviceIds: ['agent-device'],
        signatureEndpoint: '/api/v1/mobile/agent-funding-drafts/draft-1/signature',
      },
      review: {
        canApprove: true,
        canReject: false,
        canComment: true,
      },
      deepLink: {
        scheme: 'sanctuary://agent-funding-drafts/draft-1',
        apiPath: '/api/v1/mobile/agent-funding-drafts/draft-1',
        notificationPayload: {
          type: 'agent_funding_draft',
          walletId: 'wallet-1',
          draftId: 'draft-1',
          agentId: 'agent-1',
        },
      },
    });
  });

  it('filters drafts that mobile permissions cannot view from the list', async () => {
    (draftRepository.findPendingAgentDraftsForUser as Mock).mockResolvedValue([makeDraft()]);
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: {
        ...basePermissions,
        viewTransactions: false,
      },
    });

    await expect(mobileAgentDraftService.listPendingAgentFundingDrafts('user-1', 25))
      .resolves.toEqual([]);
  });

  it('propagates non-permission errors while building list review contexts', async () => {
    (draftRepository.findPendingAgentDraftsForUser as Mock).mockResolvedValue([makeDraft()]);
    (mobilePermissionService.getEffectivePermissions as Mock).mockRejectedValue(new Error('permissions unavailable'));

    await expect(mobileAgentDraftService.listPendingAgentFundingDrafts('user-1', 25))
      .rejects.toThrow('permissions unavailable');
  });

  it('returns a single pending draft review with null-normalized optional JSON fields', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft({
      inputs: null,
      outputs: undefined,
      expiresAt: null,
      memo: 'Review from phone',
    }));

    const result = await mobileAgentDraftService.getAgentFundingDraftForReview('user-1', 'draft-1');

    expect(result).toMatchObject({
      id: 'draft-1',
      expiresAt: null,
      memo: 'Review from phone',
      summary: {
        inputs: null,
        outputs: null,
      },
    });
  });

  it('rejects draft records that are no longer associated with an agent', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft({
      agentId: null,
    }));

    await expect(mobileAgentDraftService.getAgentFundingDraftForReview('user-1', 'draft-1'))
      .rejects.toThrow(NotFoundError);
  });

  it('denies direct draft review when mobile permissions cannot view transactions', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: {
        ...basePermissions,
        viewTransactions: false,
      },
    });

    await expect(mobileAgentDraftService.getAgentFundingDraftForReview('user-1', 'draft-1'))
      .rejects.toThrow(ForbiddenError);
  });

  it('skips list entries denied by mobile permission lookup without failing the whole list', async () => {
    (draftRepository.findPendingAgentDraftsForUser as Mock).mockResolvedValue([
      makeDraft({ id: 'draft-denied', walletId: 'wallet-denied' }),
      makeDraft({ id: 'draft-allowed', walletId: 'wallet-allowed' }),
    ]);
    (mobilePermissionService.getEffectivePermissions as Mock)
      .mockRejectedValueOnce(new ForbiddenError('No mobile access'))
      .mockResolvedValueOnce({ permissions: basePermissions });

    const result = await mobileAgentDraftService.listPendingAgentFundingDrafts('user-1', 25);

    expect(result.map((draft) => draft.id)).toEqual(['draft-allowed']);
  });

  it('reports canReject only for users with the approve capability', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: approverPermissions,
    });

    const result = await mobileAgentDraftService.getAgentFundingDraftForReview('user-1', 'draft-1');

    expect(result.review).toMatchObject({ canApprove: true, canReject: true, canComment: true });
  });

  it('denies reject to a signer without the approve capability and writes nothing', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());

    await expect(mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No'))
      .rejects.toThrow(ForbiddenError);

    expect(draftRepository.updateApprovalStatus).not.toHaveBeenCalled();
    expect(approvalService.castVote).not.toHaveBeenCalled();
  });

  describe('reject through the approval workflow', () => {
    beforeEach(() => {
      (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
        permissions: approverPermissions,
      });
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([]);
      (approvalService.isEligibleSpecificApprover as Mock).mockResolvedValue(true);
      (draftRepository.findAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft({ approvalStatus: 'rejected' }));
    });

    function pendingDraft(overrides: Record<string, unknown> = {}) {
      (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(
        makeDraft({ approvalStatus: 'pending', ...overrides })
      );
    }

    async function expectRejectRefused(errorType: typeof ConflictError | typeof ForbiddenError, message?: string) {
      const attempt = mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No');
      await expect(attempt).rejects.toThrow(errorType);
      if (message) {
        await expect(attempt).rejects.toThrow(message);
      }
      expect(approvalService.castVote).not.toHaveBeenCalled();
      expect(draftRepository.updateApprovalStatus).not.toHaveBeenCalled();
    }

    it('declines an unpolicied draft directly and returns the rejected review payload', async () => {
      (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());

      const result = await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'Not expected');

      expect(draftRepository.updateApprovalStatus).toHaveBeenCalledWith('draft-1', 'rejected');
      expect(approvalService.castVote).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        decision: 'reject',
        comment: 'Not expected',
        nextAction: 'none',
        draft: {
          id: 'draft-1',
          approvalStatus: 'rejected',
        },
      });
    });

    it('casts a reject vote on the pending approval request instead of writing the draft status', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([makeRequest()]);

      const result = await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'Wrong amount');

      expect(approvalService.castVote).toHaveBeenCalledTimes(1);
      expect(approvalService.castVote).toHaveBeenCalledWith('request-1', 'user-1', 'reject', 'Wrong amount');
      expect(draftRepository.updateApprovalStatus).not.toHaveBeenCalled();
      expect(result.draft.approvalStatus).toBe('rejected');
    });

    it('skips a request the caller already voted on', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ votes: [{ userId: 'user-1' }] }),
        makeRequest({ id: 'request-2' }),
      ]);

      await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No');

      expect(approvalService.castVote).toHaveBeenCalledWith('request-2', 'user-1', 'reject', 'No');
    });

    it('skips a specific-quorum request that does not list the caller', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ quorumType: 'specific' }),
        makeRequest({ id: 'request-2', quorumType: 'specific', policyId: 'policy-2' }),
      ]);
      (approvalService.isEligibleSpecificApprover as Mock)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No');

      expect(approvalService.isEligibleSpecificApprover).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-1', quorumType: 'specific' }),
        'user-1'
      );
      expect(approvalService.castVote).toHaveBeenCalledWith('request-2', 'user-1', 'reject', 'No');
    });

    it('refuses when no pending request lists the caller as an eligible approver', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ quorumType: 'specific' }),
        makeRequest({ id: 'request-2', votes: [{ userId: 'user-1' }] }),
      ]);
      (approvalService.isEligibleSpecificApprover as Mock).mockResolvedValue(false);

      await expectRejectRefused(ForbiddenError, 'You are not an eligible approver for this draft');
    });

    it('skips a self-approval-refused request for the draft creator', async () => {
      pendingDraft({ userId: 'user-1' });
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ allowSelfApproval: false }),
        makeRequest({ id: 'request-2', allowSelfApproval: true }),
      ]);

      await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No');

      expect(approvalService.castVote).toHaveBeenCalledWith('request-2', 'user-1', 'reject', 'No');
    });

    it('refuses the draft creator when every pending request disallows self-approval', async () => {
      pendingDraft({ userId: 'user-1' });
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ allowSelfApproval: false }),
        makeRequest({ id: 'request-2', allowSelfApproval: false }),
      ]);

      await expectRejectRefused(ForbiddenError, 'Self-approval is not allowed for this policy');
    });

    it('refuses a pending draft that has no approval request rows', async () => {
      pendingDraft();

      await expectRejectRefused(ConflictError, 'Draft has no approval request to vote on');
    });

    it('refuses when approval requests exist but none is pending', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ status: 'approved' }),
      ]);

      await expectRejectRefused(ConflictError, 'Draft has no pending approval request to vote on');
    });

    it('skips a pending request past its own expiry', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ expiresAt: new Date(Date.now() - 60_000) }),
        makeRequest({ id: 'request-2', expiresAt: new Date(Date.now() + 60_000) }),
      ]);

      await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No');

      expect(approvalService.castVote).toHaveBeenCalledWith('request-2', 'user-1', 'reject', 'No');
    });

    it('refuses when every pending request is past its expiry', async () => {
      pendingDraft();
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([
        makeRequest({ expiresAt: new Date(Date.now() - 60_000) }),
      ]);

      await expectRejectRefused(ConflictError, 'Approval request has expired');
    });

    it('refuses to veto a draft that is already approved', async () => {
      pendingDraft({ approvalStatus: 'approved' });
      (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([makeRequest({ status: 'approved' })]);

      await expectRejectRefused(ConflictError);
    });
  });

  it('records approval and comment decisions without requiring mobile signing permission', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: {
        ...basePermissions,
        signPsbt: false,
        approveTransaction: true,
      },
    });

    const approved = await mobileAgentDraftService.approveAgentFundingDraft('user-1', 'draft-1');
    const commented = await mobileAgentDraftService.commentOnAgentFundingDraft('user-1', 'draft-1', 'Looks right');

    expect(approved).toMatchObject({
      decision: 'approve',
      comment: null,
      nextAction: 'none',
      draft: {
        signing: {
          canSign: false,
          signedPsbtUploadSupported: false,
        },
      },
    });
    expect(commented).toMatchObject({
      decision: 'comment',
      comment: 'Looks right',
      nextAction: 'none',
    });
  });

  it('returns sign as the next action for approval and comment decisions when signing is allowed', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());

    const approved = await mobileAgentDraftService.approveAgentFundingDraft('user-1', 'draft-1', 'Approved');
    const commented = await mobileAgentDraftService.commentOnAgentFundingDraft('user-1', 'draft-1', 'Ready to sign');

    expect(approved).toMatchObject({
      decision: 'approve',
      comment: 'Approved',
      nextAction: 'sign',
    });
    expect(commented).toMatchObject({
      decision: 'comment',
      comment: 'Ready to sign',
      nextAction: 'sign',
    });
  });

  it('denies approval when the mobile user can view but cannot review', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: {
        ...basePermissions,
        signPsbt: false,
        approveTransaction: false,
      },
    });

    await expect(mobileAgentDraftService.approveAgentFundingDraft('user-1', 'draft-1'))
      .rejects.toThrow(ForbiddenError);
  });

  it('submits signatures through the existing draft update path', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (draftRepository.findAgentDraftByIdForUser as Mock).mockResolvedValue(
      makeDraft({ status: 'signed', signedDeviceIds: ['agent-device', 'mobile-device'] })
    );

    const result = await mobileAgentDraftService.submitAgentFundingDraftSignature('user-1', 'draft-1', {
      signedPsbtBase64: 'human-signed',
      signedDeviceId: 'mobile-device',
      status: 'signed',
    });

    expect(draftService.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', {
      signedPsbtBase64: 'human-signed',
      signedDeviceId: 'mobile-device',
      status: 'signed',
    });
    expect(result.status).toBe('signed');
    expect(result.signing.signedDeviceIds).toEqual(['agent-device', 'mobile-device']);
  });

  it('denies mobile signatures when signPsbt is not allowed', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: {
        ...basePermissions,
        signPsbt: false,
        approveTransaction: true,
      },
    });

    await expect(mobileAgentDraftService.submitAgentFundingDraftSignature('user-1', 'draft-1', {
      signedPsbtBase64: 'human-signed',
      signedDeviceId: 'mobile-device',
    })).rejects.toThrow(ForbiddenError);

    expect(draftService.updateDraft).not.toHaveBeenCalled();
  });

  it('returns not found for missing or no-longer-pending drafts', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(null);

    await expect(mobileAgentDraftService.getAgentFundingDraftForReview('user-1', 'missing'))
      .rejects.toThrow(NotFoundError);
  });

  it('returns not found when a rejected draft cannot be loaded after status update', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (draftRepository.findAgentDraftByIdForUser as Mock).mockResolvedValue(null);
    (approvalService.getApprovalsForDraft as Mock).mockResolvedValue([]);
    (mobilePermissionService.getEffectivePermissions as Mock).mockResolvedValue({
      permissions: approverPermissions,
    });

    await expect(mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'No'))
      .rejects.toThrow(NotFoundError);
  });
});
