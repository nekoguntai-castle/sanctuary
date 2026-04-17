import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../src/errors';

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    findPendingAgentDraftsForUser: vi.fn(),
    findPendingAgentDraftByIdForUser: vi.fn(),
    findAgentDraftByIdForUser: vi.fn(),
    updateApprovalStatus: vi.fn(),
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
        canReject: true,
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

  it('rejects a pending draft and returns the rejected review payload', async () => {
    (draftRepository.findPendingAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft());
    (draftRepository.findAgentDraftByIdForUser as Mock).mockResolvedValue(makeDraft({ approvalStatus: 'rejected' }));

    const result = await mobileAgentDraftService.rejectAgentFundingDraft('user-1', 'draft-1', 'Not expected');

    expect(draftRepository.updateApprovalStatus).toHaveBeenCalledWith('draft-1', 'rejected');
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
});
