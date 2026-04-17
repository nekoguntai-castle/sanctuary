import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const smoke = vi.hoisted(() => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const fundingWalletId = '22222222-2222-4222-8222-222222222222';
  const operationalWalletId = '33333333-3333-4333-8333-333333333333';
  const signerDeviceId = '44444444-4444-4444-8444-444444444444';
  const agentId = '55555555-5555-4555-8555-555555555555';
  const keyId = '66666666-6666-4666-8666-666666666666';
  const draftId = '77777777-7777-4777-8777-777777777777';
  const now = new Date('2026-04-16T10:00:00.000Z');

  return {
    ids: {
      userId,
      fundingWalletId,
      operationalWalletId,
      signerDeviceId,
      agentId,
      keyId,
      draftId,
    },
    now,
    agentContext: {
      keyId,
      keyPrefix: 'agt_smoke',
      userId,
      username: 'operator',
      agentId,
      agentName: 'Smoke Agent',
      agentStatus: 'active',
      fundingWalletId,
      operationalWalletId,
      signerDeviceId,
      scope: { allowedActions: ['create_funding_draft'] },
    },
    agentRepository: {
      createAgent: vi.fn(),
      findAgentById: vi.fn(),
      findAgentByIdWithDetails: vi.fn(),
      createApiKey: vi.fn(),
      withAgentFundingLock: vi.fn(),
      markAgentFundingDraftCreated: vi.fn(),
      markFundingOverrideUsed: vi.fn(),
      createFundingAttempt: vi.fn(),
    },
    userRepository: {
      findById: vi.fn(),
    },
    walletRepository: {
      findById: vi.fn(),
      findByIdWithSigningDevices: vi.fn(),
      hasAccess: vi.fn(),
    },
    utxoRepository: {
      getUnspentBalance: vi.fn(),
    },
    draftRepository: {
      findPendingAgentDraftsForUser: vi.fn(),
      findPendingAgentDraftByIdForUser: vi.fn(),
      findAgentDraftByIdForUser: vi.fn(),
      updateApprovalStatus: vi.fn(),
    },
    validateAgentFundingDraftSubmission: vi.fn(),
    enforceAgentFundingPolicy: vi.fn(),
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    updateDraft: vi.fn(),
    auditLog: vi.fn(),
    auditLogFromRequest: vi.fn(),
    getClientInfo: vi.fn(),
    serializeDraftTransaction: vi.fn(),
    requireAgentFundingDraftAccess: vi.fn(),
    evaluateRejectedFundingAttemptAlert: vi.fn(),
    getEffectivePermissions: vi.fn(),
  };
});

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: smoke.ids.userId, username: 'operator', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: smoke.ids.userId, username: 'operator', isAdmin: true },
}));

vi.mock('../../../src/agent/auth', () => ({
  requireAgentFundingDraftAccess: smoke.requireAgentFundingDraftAccess,
  buildAgentKeyScope: ({ allowedActions }: { allowedActions?: string[] }) => ({
    allowedActions: allowedActions ?? ['create_funding_draft'],
  }),
  generateAgentApiKey: () => 'agt_smoke_secret_token',
  getAgentApiKeyPrefix: () => 'agt_smoke',
  hashAgentApiKey: () => 'hashed-agent-key',
  parseAgentKeyScope: (scope: unknown) => scope ?? { allowedActions: [] },
}));

vi.mock('../../../src/middleware/agentAuth', () => ({
  authenticateAgent: (req: any, _res: any, next: () => void) => {
    req.agentContext = smoke.agentContext;
    next();
  },
  requireAgentContext: (req: any) => req.agentContext,
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: smoke.agentRepository,
  userRepository: smoke.userRepository,
  walletRepository: smoke.walletRepository,
  utxoRepository: smoke.utxoRepository,
  draftRepository: smoke.draftRepository,
}));

vi.mock('../../../src/services/agentFundingDraftValidation', () => ({
  validateAgentFundingDraftSubmission: smoke.validateAgentFundingDraftSubmission,
}));

vi.mock('../../../src/services/agentFundingPolicy', () => ({
  enforceAgentFundingPolicy: smoke.enforceAgentFundingPolicy,
}));

vi.mock('../../../src/services/agentMonitoringService', () => ({
  evaluateRejectedFundingAttemptAlert: smoke.evaluateRejectedFundingAttemptAlert,
}));

vi.mock('../../../src/services/draftService', () => ({
  draftService: {
    createDraft: smoke.createDraft,
    getDraft: smoke.getDraft,
    updateDraft: smoke.updateDraft,
  },
}));

vi.mock('../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: {
    getEffectivePermissions: smoke.getEffectivePermissions,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  AuditAction: {
    AGENT_CREATE: 'wallet.agent_create',
    AGENT_KEY_CREATE: 'wallet.agent_key_create',
    AGENT_FUNDING_DRAFT_SUBMIT: 'wallet.agent_funding_draft_submit',
    AGENT_OVERRIDE_USE: 'wallet.agent_override_use',
    MOBILE_AGENT_DRAFT_APPROVE: 'wallet.mobile_agent_draft_approve',
    MOBILE_AGENT_DRAFT_COMMENT: 'wallet.mobile_agent_draft_comment',
    MOBILE_AGENT_DRAFT_REJECT: 'wallet.mobile_agent_draft_reject',
    MOBILE_AGENT_DRAFT_SIGN: 'wallet.mobile_agent_draft_sign',
  },
  AuditCategory: {
    WALLET: 'wallet',
  },
  auditService: {
    log: smoke.auditLog,
    logFromRequest: smoke.auditLogFromRequest,
  },
  getClientInfo: smoke.getClientInfo,
}));

vi.mock('../../../src/utils/serialization', () => ({
  serializeDraftTransaction: smoke.serializeDraftTransaction,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import adminAgentsRouter from '../../../src/api/admin/agents';
import agentRouter from '../../../src/api/agent';
import mobileAgentDraftsRouter from '../../../src/api/mobileAgentDrafts';
import { errorHandler } from '../../../src/errors/errorHandler';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: smoke.ids.agentId,
    userId: smoke.ids.userId,
    name: 'Smoke Agent',
    status: 'active',
    fundingWalletId: smoke.ids.fundingWalletId,
    operationalWalletId: smoke.ids.operationalWalletId,
    signerDeviceId: smoke.ids.signerDeviceId,
    maxFundingAmountSats: BigInt(100000),
    maxOperationalBalanceSats: null,
    dailyFundingLimitSats: null,
    weeklyFundingLimitSats: null,
    cooldownMinutes: null,
    minOperationalBalanceSats: BigInt(25000),
    largeOperationalSpendSats: BigInt(75000),
    largeOperationalFeeSats: BigInt(5000),
    repeatedFailureThreshold: 3,
    repeatedFailureLookbackMinutes: 60,
    alertDedupeMinutes: 120,
    requireHumanApproval: true,
    notifyOnOperationalSpend: true,
    pauseOnUnexpectedSpend: false,
    lastFundingDraftAt: null,
    createdAt: smoke.now,
    updatedAt: smoke.now,
    revokedAt: null,
    ...overrides,
  };
}

function makeAgentDraftRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: smoke.ids.draftId,
    walletId: smoke.ids.fundingWalletId,
    userId: smoke.ids.userId,
    recipient: 'tb1qoperational',
    amount: BigInt(50000),
    feeRate: 5,
    selectedUtxoIds: ['decoded-txid:0'],
    enableRBF: false,
    subtractFees: false,
    sendMax: false,
    outputs: [{ address: 'tb1qoperational', amount: 50000 }],
    inputs: [{ txid: 'decoded-txid', vout: 0, amount: 50500 }],
    decoyOutputs: null,
    payjoinUrl: null,
    isRBF: false,
    label: 'Agent funding request: Smoke Agent',
    memo: null,
    psbtBase64: 'unsigned-psbt',
    signedPsbtBase64: 'agent-signed-psbt',
    fee: BigInt(500),
    totalInput: BigInt(50500),
    totalOutput: BigInt(50000),
    changeAmount: BigInt(0),
    changeAddress: null,
    effectiveAmount: BigInt(50000),
    inputPaths: ["m/48'/1'/0'/2'/0/0"],
    status: 'partial',
    signedDeviceIds: [smoke.ids.signerDeviceId],
    agentId: smoke.ids.agentId,
    agentOperationalWalletId: smoke.ids.operationalWalletId,
    createdAt: smoke.now,
    updatedAt: smoke.now,
    expiresAt: new Date('2026-04-17T10:00:00.000Z'),
    approvalStatus: 'not_required',
    policySnapshot: null,
    approvedAt: null,
    approvedBy: null,
    wallet: {
      id: smoke.ids.fundingWalletId,
      name: 'Funding Multisig',
      type: 'multi_sig',
      network: 'testnet',
    },
    ...overrides,
  };
}

describe('agent wallet funding route smoke', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/agents', adminAgentsRouter);
    app.use('/api/v1/agent', agentRouter);
    app.use('/api/v1/mobile', mobileAgentDraftsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    smoke.userRepository.findById.mockResolvedValue({
      id: smoke.ids.userId,
      username: 'operator',
      isAdmin: true,
    });
    smoke.walletRepository.findById.mockImplementation(async (walletId: string) => {
      if (walletId === smoke.ids.fundingWalletId) {
        return { id: walletId, name: 'Funding Multisig', type: 'multi_sig', network: 'testnet' };
      }
      if (walletId === smoke.ids.operationalWalletId) {
        return { id: walletId, name: 'Operational Wallet', type: 'single_sig', network: 'testnet' };
      }
      return null;
    });
    smoke.walletRepository.findByIdWithSigningDevices.mockResolvedValue({
      id: smoke.ids.fundingWalletId,
      devices: [{ deviceId: smoke.ids.signerDeviceId }],
    });
    smoke.walletRepository.hasAccess.mockResolvedValue(true);

    smoke.agentRepository.createAgent.mockResolvedValue(makeAgent());
    smoke.agentRepository.findAgentById.mockResolvedValue(makeAgent());
    smoke.agentRepository.findAgentByIdWithDetails.mockResolvedValue(makeAgent({
      user: { id: smoke.ids.userId, username: 'operator' },
      fundingWallet: { id: smoke.ids.fundingWalletId, name: 'Funding Multisig' },
      operationalWallet: { id: smoke.ids.operationalWalletId, name: 'Operational Wallet' },
      signerDevice: { id: smoke.ids.signerDeviceId, label: 'Agent signer' },
      apiKeys: [],
    }));
    smoke.agentRepository.createApiKey.mockResolvedValue({
      id: smoke.ids.keyId,
      agentId: smoke.ids.agentId,
      createdByUserId: smoke.ids.userId,
      name: 'Agent runtime',
      keyHash: 'hashed-agent-key',
      keyPrefix: 'agt_smoke',
      scope: { allowedActions: ['create_funding_draft'] },
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedAgent: null,
      expiresAt: null,
      createdAt: smoke.now,
      revokedAt: null,
    });
    smoke.agentRepository.withAgentFundingLock.mockImplementation(async (_agentId: string, fn: () => Promise<unknown>) => fn());
    smoke.agentRepository.markAgentFundingDraftCreated.mockResolvedValue(undefined);
    smoke.agentRepository.markFundingOverrideUsed.mockResolvedValue(undefined);
    smoke.agentRepository.createFundingAttempt.mockResolvedValue({ id: 'attempt-1' });

    smoke.validateAgentFundingDraftSubmission.mockResolvedValue({
      recipient: 'tb1qoperational',
      amount: '50000',
      selectedUtxoIds: ['decoded-txid:0'],
      fee: '500',
      totalInput: '50500',
      totalOutput: '50000',
      changeAmount: '0',
      changeAddress: null,
      effectiveAmount: '50000',
      enableRBF: false,
      inputs: [{ txid: 'decoded-txid', vout: 0, amount: 50500 }],
      outputs: [{ address: 'tb1qoperational', amount: 50000 }],
      inputPaths: ["m/48'/1'/0'/2'/0/0"],
    });
    smoke.enforceAgentFundingPolicy.mockResolvedValue({ overrideId: null });
    smoke.createDraft.mockResolvedValue(makeAgentDraftRecord());
    smoke.serializeDraftTransaction.mockReturnValue({
      id: smoke.ids.draftId,
      status: 'partial',
      agentId: smoke.ids.agentId,
      agentOperationalWalletId: smoke.ids.operationalWalletId,
    });
    smoke.getClientInfo.mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'agent-runtime' });

    smoke.draftRepository.findPendingAgentDraftsForUser.mockResolvedValue([makeAgentDraftRecord()]);
    smoke.getEffectivePermissions.mockResolvedValue({
      permissions: {
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
      },
    });
  });

  it('covers admin registration, key issue, agent draft submission, and human mobile review metadata', async () => {
    const createdAgent = await request(app)
      .post('/api/v1/admin/agents')
      .send({
        userId: smoke.ids.userId,
        name: 'Smoke Agent',
        fundingWalletId: smoke.ids.fundingWalletId,
        operationalWalletId: smoke.ids.operationalWalletId,
        signerDeviceId: smoke.ids.signerDeviceId,
        maxFundingAmountSats: '100000',
        minOperationalBalanceSats: '25000',
        largeOperationalSpendSats: '75000',
        largeOperationalFeeSats: '5000',
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
      })
      .expect(201);

    expect(createdAgent.body).toMatchObject({
      id: smoke.ids.agentId,
      fundingWalletId: smoke.ids.fundingWalletId,
      operationalWalletId: smoke.ids.operationalWalletId,
      signerDeviceId: smoke.ids.signerDeviceId,
      maxFundingAmountSats: '100000',
    });

    const createdKey = await request(app)
      .post(`/api/v1/admin/agents/${smoke.ids.agentId}/keys`)
      .send({
        name: 'Agent runtime',
        allowedActions: ['create_funding_draft'],
      })
      .expect(201);

    expect(createdKey.body).toMatchObject({
      id: smoke.ids.keyId,
      keyPrefix: 'agt_smoke',
      apiKey: 'agt_smoke_secret_token',
    });
    expect(createdKey.body.keyHash).toBeUndefined();

    const agentDraft = await request(app)
      .post(`/api/v1/agent/wallets/${smoke.ids.fundingWalletId}/funding-drafts`)
      .set('Authorization', `Bearer ${createdKey.body.apiKey}`)
      .send({
        operationalWalletId: smoke.ids.operationalWalletId,
        recipient: 'tb1qoperational',
        amount: '50000',
        feeRate: '5',
        psbtBase64: 'unsigned-psbt',
        signedPsbtBase64: 'agent-signed-psbt',
      })
      .expect(201);

    expect(agentDraft.body).toMatchObject({
      id: smoke.ids.draftId,
      status: 'partial',
      agentId: smoke.ids.agentId,
      agentOperationalWalletId: smoke.ids.operationalWalletId,
    });
    expect(smoke.createDraft).toHaveBeenCalledWith(
      smoke.ids.fundingWalletId,
      smoke.ids.userId,
      expect.objectContaining({
        agentId: smoke.ids.agentId,
        agentOperationalWalletId: smoke.ids.operationalWalletId,
        signedDeviceId: smoke.ids.signerDeviceId,
      })
    );

    const mobileReview = await request(app)
      .get('/api/v1/mobile/agent-funding-drafts')
      .expect(200);

    expect(mobileReview.body.drafts).toHaveLength(1);
    expect(mobileReview.body.drafts[0]).toMatchObject({
      id: smoke.ids.draftId,
      walletId: smoke.ids.fundingWalletId,
      agentId: smoke.ids.agentId,
      agentOperationalWalletId: smoke.ids.operationalWalletId,
      amountSats: '50000',
      feeSats: '500',
      status: 'partial',
      signing: {
        canSign: true,
        signedDeviceIds: [smoke.ids.signerDeviceId],
      },
      deepLink: {
        scheme: `sanctuary://agent-funding-drafts/${smoke.ids.draftId}`,
        notificationPayload: {
          type: 'agent_funding_draft',
          walletId: smoke.ids.fundingWalletId,
          draftId: smoke.ids.draftId,
          agentId: smoke.ids.agentId,
        },
      },
    });

    expect(smoke.auditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet.agent_key_create',
      'wallet',
      expect.any(Object)
    );
    expect(smoke.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wallet.agent_funding_draft_submit',
      details: expect.objectContaining({
        draftId: smoke.ids.draftId,
        agentId: smoke.ids.agentId,
      }),
    }));
  });
});
