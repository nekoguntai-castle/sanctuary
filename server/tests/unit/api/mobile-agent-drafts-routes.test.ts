import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../../src/errors/errorHandler';

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'user-1', username: 'alice', isAdmin: false },
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
    next();
  },
}));

vi.mock('../../../src/services/mobileAgentDraftService', () => ({
  mobileAgentDraftService: {
    listPendingAgentFundingDrafts: vi.fn(),
    getAgentFundingDraftForReview: vi.fn(),
    approveAgentFundingDraft: vi.fn(),
    commentOnAgentFundingDraft: vi.fn(),
    rejectAgentFundingDraft: vi.fn(),
    submitAgentFundingDraftSignature: vi.fn(),
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: vi.fn(),
  },
  AuditAction: {
    MOBILE_AGENT_DRAFT_APPROVE: 'wallet.mobile_agent_draft_approve',
    MOBILE_AGENT_DRAFT_COMMENT: 'wallet.mobile_agent_draft_comment',
    MOBILE_AGENT_DRAFT_REJECT: 'wallet.mobile_agent_draft_reject',
    MOBILE_AGENT_DRAFT_SIGN: 'wallet.mobile_agent_draft_sign',
  },
  AuditCategory: {
    WALLET: 'wallet',
  },
}));

import { mobileAgentDraftService } from '../../../src/services/mobileAgentDraftService';
import { auditService } from '../../../src/services/auditService';

async function createApp() {
  const app = express();
  app.use(express.json());
  const module = await import('../../../src/api/mobileAgentDrafts');
  app.use('/api/v1/mobile', module.default);
  app.use(errorHandler);
  return app;
}

const reviewDraft = {
  id: 'draft-1',
  walletId: 'wallet-1',
  wallet: {
    id: 'wallet-1',
    name: 'Funding multisig',
    type: 'multi_sig',
    network: 'testnet',
  },
  agentId: 'agent-1',
  agentOperationalWalletId: 'operational-wallet-1',
  recipient: 'tb1qagentwallet',
  amountSats: '1000',
  feeSats: '120',
  feeRate: 2,
  status: 'partial',
  approvalStatus: 'not_required',
  label: 'Agent funding',
  memo: null,
  createdAt: '2026-04-16T10:00:00.000Z',
  updatedAt: '2026-04-16T10:01:00.000Z',
  expiresAt: null,
  summary: {
    inputs: [],
    outputs: [],
    selectedUtxoIds: ['txid:0'],
    totalInputSats: '1120',
    totalOutputSats: '1000',
    changeAmountSats: '0',
    changeAddress: null,
    effectiveAmountSats: '1000',
    inputPaths: [],
  },
  signing: {
    canSign: true,
    signedDeviceIds: ['agent-device'],
    signatureEndpoint: '/api/v1/mobile/agent-funding-drafts/draft-1/signature',
    signedPsbtUploadSupported: true,
    supportedSignerRequired: true,
  },
  review: {
    canApprove: true,
    canReject: true,
    canComment: true,
    approveEndpoint: '/api/v1/mobile/agent-funding-drafts/draft-1/approve',
    rejectEndpoint: '/api/v1/mobile/agent-funding-drafts/draft-1/reject',
    commentEndpoint: '/api/v1/mobile/agent-funding-drafts/draft-1/comment',
  },
  deepLink: {
    scheme: 'sanctuary://agent-funding-drafts/draft-1',
    webPath: '/wallets/wallet-1/drafts/draft-1?source=agent-funding',
    apiPath: '/api/v1/mobile/agent-funding-drafts/draft-1',
    notificationPayload: {
      type: 'agent_funding_draft',
      walletId: 'wallet-1',
      draftId: 'draft-1',
      agentId: 'agent-1',
    },
  },
};

describe('mobile agent draft routes', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createApp();
  });

  it('lists pending agent funding drafts with a bounded limit', async () => {
    vi.mocked(mobileAgentDraftService.listPendingAgentFundingDrafts).mockResolvedValue([reviewDraft]);

    const response = await request(app)
      .get('/api/v1/mobile/agent-funding-drafts?limit=10')
      .expect(200);

    expect(mobileAgentDraftService.listPendingAgentFundingDrafts).toHaveBeenCalledWith('user-1', 10);
    expect(response.body).toEqual({ drafts: [reviewDraft] });
  });

  it('rejects invalid list limits before hitting the service', async () => {
    await request(app)
      .get('/api/v1/mobile/agent-funding-drafts?limit=0')
      .expect(400);

    expect(mobileAgentDraftService.listPendingAgentFundingDrafts).not.toHaveBeenCalled();
  });

  it('returns one agent funding draft review payload', async () => {
    vi.mocked(mobileAgentDraftService.getAgentFundingDraftForReview).mockResolvedValue(reviewDraft);

    const response = await request(app)
      .get('/api/v1/mobile/agent-funding-drafts/draft-1')
      .expect(200);

    expect(mobileAgentDraftService.getAgentFundingDraftForReview).toHaveBeenCalledWith('user-1', 'draft-1');
    expect(response.body).toEqual({ draft: reviewDraft });
  });

  it('audits approve decisions without marking the draft signed', async () => {
    vi.mocked(mobileAgentDraftService.approveAgentFundingDraft).mockResolvedValue({
      draft: reviewDraft,
      decision: 'approve',
      comment: 'Looks right',
      nextAction: 'sign',
    });

    const response = await request(app)
      .post('/api/v1/mobile/agent-funding-drafts/draft-1/approve')
      .send({ comment: 'Looks right' })
      .expect(200);

    expect(mobileAgentDraftService.approveAgentFundingDraft)
      .toHaveBeenCalledWith('user-1', 'draft-1', 'Looks right');
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet.mobile_agent_draft_approve',
      'wallet',
      expect.objectContaining({
        details: expect.objectContaining({
          draftId: 'draft-1',
          walletId: 'wallet-1',
          agentId: 'agent-1',
          comment: 'Looks right',
          nextAction: 'sign',
        }),
      })
    );
    expect(response.body.nextAction).toBe('sign');
  });

  it('audits comments and rejects empty comments', async () => {
    vi.mocked(mobileAgentDraftService.commentOnAgentFundingDraft).mockResolvedValue({
      draft: reviewDraft,
      decision: 'comment',
      comment: 'Need invoice',
      nextAction: 'sign',
    });

    await request(app)
      .post('/api/v1/mobile/agent-funding-drafts/draft-1/comment')
      .send({ comment: '' })
      .expect(400);

    const response = await request(app)
      .post('/api/v1/mobile/agent-funding-drafts/draft-1/comment')
      .send({ comment: 'Need invoice' })
      .expect(200);

    expect(mobileAgentDraftService.commentOnAgentFundingDraft)
      .toHaveBeenCalledWith('user-1', 'draft-1', 'Need invoice');
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet.mobile_agent_draft_comment',
      'wallet',
      expect.objectContaining({
        details: expect.objectContaining({
          comment: 'Need invoice',
        }),
      })
    );
    expect(response.body.decision).toBe('comment');
  });

  it('audits rejections', async () => {
    vi.mocked(mobileAgentDraftService.rejectAgentFundingDraft).mockResolvedValue({
      draft: { ...reviewDraft, approvalStatus: 'rejected' },
      decision: 'reject',
      comment: 'Wrong destination',
      nextAction: 'none',
    });

    const response = await request(app)
      .post('/api/v1/mobile/agent-funding-drafts/draft-1/reject')
      .send({ reason: 'Wrong destination' })
      .expect(200);

    expect(mobileAgentDraftService.rejectAgentFundingDraft)
      .toHaveBeenCalledWith('user-1', 'draft-1', 'Wrong destination');
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet.mobile_agent_draft_reject',
      'wallet',
      expect.objectContaining({
        details: expect.objectContaining({
          reason: 'Wrong destination',
        }),
      })
    );
    expect(response.body.draft.approvalStatus).toBe('rejected');
  });

  it('submits signed PSBTs through the service and audits device id only', async () => {
    vi.mocked(mobileAgentDraftService.submitAgentFundingDraftSignature).mockResolvedValue({
      ...reviewDraft,
      status: 'signed',
      signing: {
        ...reviewDraft.signing,
        signedDeviceIds: ['agent-device', 'mobile-device'],
      },
    });

    const response = await request(app)
      .post('/api/v1/mobile/agent-funding-drafts/draft-1/signature')
      .send({
        signedPsbtBase64: 'human-signed-psbt',
        signedDeviceId: 'mobile-device',
        status: 'signed',
      })
      .expect(200);

    expect(mobileAgentDraftService.submitAgentFundingDraftSignature).toHaveBeenCalledWith('user-1', 'draft-1', {
      signedPsbtBase64: 'human-signed-psbt',
      signedDeviceId: 'mobile-device',
      status: 'signed',
    });
    expect(auditService.logFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet.mobile_agent_draft_sign',
      'wallet',
      expect.objectContaining({
        details: expect.objectContaining({
          draftId: 'draft-1',
          signedDeviceId: 'mobile-device',
          status: 'signed',
        }),
      })
    );
    const auditOptions = vi.mocked(auditService.logFromRequest).mock.calls.at(-1)?.[3];
    expect(JSON.stringify(auditOptions)).not.toContain('human-signed-psbt');
    expect(response.body.draft.status).toBe('signed');
  });
});
