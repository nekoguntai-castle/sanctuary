import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { ForbiddenError, InvalidInputError } from '../../../src/errors/ApiError';

const {
  mockRequireAgentFundingDraftAccess,
  mockValidateAgentFundingDraftSubmission,
  mockEnforceAgentFundingPolicy,
  mockMarkAgentFundingDraftCreated,
  mockMarkFundingOverrideUsed,
  mockWithAgentFundingLock,
  mockCreateFundingAttempt,
  mockEvaluateRejectedFundingAttemptAlert,
  mockCreateDraft,
  mockGetDraft,
  mockUpdateDraft,
  mockGetOrCreateOperationalReceiveAddress,
  mockVerifyOperationalReceiveAddress,
  mockAuditLog,
  mockGetClientInfo,
  mockSerializeDraftTransaction,
  agentContext,
} = vi.hoisted(() => ({
  mockRequireAgentFundingDraftAccess: vi.fn(),
  mockValidateAgentFundingDraftSubmission: vi.fn(),
  mockEnforceAgentFundingPolicy: vi.fn(),
  mockMarkAgentFundingDraftCreated: vi.fn(),
  mockMarkFundingOverrideUsed: vi.fn(),
  mockWithAgentFundingLock: vi.fn(),
  mockCreateFundingAttempt: vi.fn(),
  mockEvaluateRejectedFundingAttemptAlert: vi.fn(),
  mockCreateDraft: vi.fn(),
  mockGetDraft: vi.fn(),
  mockUpdateDraft: vi.fn(),
  mockGetOrCreateOperationalReceiveAddress: vi.fn(),
  mockVerifyOperationalReceiveAddress: vi.fn(),
  mockAuditLog: vi.fn(),
  mockGetClientInfo: vi.fn(),
  mockSerializeDraftTransaction: vi.fn(),
  agentContext: {
    keyId: 'key-1',
    keyPrefix: 'agt_prefix',
    userId: 'user-1',
    username: 'alice',
    agentId: 'agent-1',
    agentName: 'Treasury Agent',
    agentStatus: 'active',
    fundingWalletId: 'funding-wallet',
    operationalWalletId: 'operational-wallet',
    signerDeviceId: 'agent-device',
    scope: { allowedActions: ['create_funding_draft'] },
  },
}));

vi.mock('../../../src/agent/auth', () => ({
  requireAgentFundingDraftAccess: mockRequireAgentFundingDraftAccess,
}));

vi.mock('../../../src/middleware/agentAuth', () => ({
  authenticateAgent: (req: any, _res: any, next: () => void) => {
    req.agentContext = agentContext;
    next();
  },
  requireAgentContext: (req: any) => req.agentContext,
}));

vi.mock('../../../src/services/agentFundingDraftValidation', () => ({
  validateAgentFundingDraftSubmission: mockValidateAgentFundingDraftSubmission,
}));

vi.mock('../../../src/services/agentFundingPolicy', () => ({
  enforceAgentFundingPolicy: mockEnforceAgentFundingPolicy,
}));

vi.mock('../../../src/services/agentOperationalAddressService', () => ({
  getOrCreateOperationalReceiveAddress: mockGetOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress: mockVerifyOperationalReceiveAddress,
}));

vi.mock('../../../src/services/agentMonitoringService', () => ({
  evaluateRejectedFundingAttemptAlert: mockEvaluateRejectedFundingAttemptAlert,
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: {
    markAgentFundingDraftCreated: mockMarkAgentFundingDraftCreated,
    markFundingOverrideUsed: mockMarkFundingOverrideUsed,
    withAgentFundingLock: mockWithAgentFundingLock,
    createFundingAttempt: mockCreateFundingAttempt,
  },
  utxoRepository: {
    getUnspentBalance: vi.fn(),
  },
  walletRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../../../src/services/draftService', () => ({
  draftService: {
    createDraft: mockCreateDraft,
    getDraft: mockGetDraft,
    updateDraft: mockUpdateDraft,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  AuditAction: {
    AGENT_FUNDING_DRAFT_SUBMIT: 'wallet.agent_funding_draft_submit',
    AGENT_OVERRIDE_USE: 'wallet.agent_override_use',
  },
  AuditCategory: {
    WALLET: 'wallet',
  },
  auditService: {
    log: mockAuditLog,
  },
  getClientInfo: mockGetClientInfo,
}));

vi.mock('../../../src/utils/serialization', () => ({
  serializeDraftTransaction: mockSerializeDraftTransaction,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
  },
}));

import agentRouter from '../../../src/api/agent';
import { ErrorCodes, errorHandler } from '../../../src/errors';
import { utxoRepository, walletRepository } from '../../../src/repositories';

describe('Agent Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/agent', agentRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDraft.mockResolvedValue({
      id: 'draft-agent',
      amount: BigInt(10000),
      feeRate: 5,
    });
    mockGetDraft.mockResolvedValue({
      id: 'draft-agent',
      agentId: 'agent-1',
      agentOperationalWalletId: 'operational-wallet',
      recipient: 'tb1qrecipient',
      amount: BigInt(10000),
      psbtBase64: 'cHNi',
    });
    mockUpdateDraft.mockResolvedValue({
      id: 'draft-agent',
      amount: BigInt(10000),
      feeRate: 5,
      signedPsbtBase64: 'cHNidP8agentSigned',
    });
    mockEnforceAgentFundingPolicy.mockResolvedValue({ overrideId: null });
    mockMarkAgentFundingDraftCreated.mockResolvedValue(undefined);
    mockWithAgentFundingLock.mockImplementation(async (_agentId, fn) => fn());
    mockCreateFundingAttempt.mockResolvedValue({ id: 'attempt-1' });
    mockAuditLog.mockResolvedValue(undefined);
    mockGetClientInfo.mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'agent-runtime' });
    mockSerializeDraftTransaction.mockReturnValue({ id: 'draft-agent', serialized: true });
    (walletRepository.findById as any).mockImplementation(async (walletId: string) => {
      if (walletId === 'funding-wallet') {
        return { id: 'funding-wallet', name: 'Funding', type: 'multi_sig', network: 'testnet' };
      }
      if (walletId === 'operational-wallet') {
        return { id: 'operational-wallet', name: 'Operational', type: 'single_sig', network: 'testnet' };
      }
      return null;
    });
    (utxoRepository.getUnspentBalance as any)
      .mockResolvedValueOnce(20000n)
      .mockResolvedValueOnce(5000n);
    mockGetOrCreateOperationalReceiveAddress.mockResolvedValue({
      walletId: 'operational-wallet',
      address: 'tb1qoperational',
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
      generated: false,
    });
    mockVerifyOperationalReceiveAddress.mockResolvedValue({
      walletId: 'operational-wallet',
      address: 'tb1qoperational',
      verified: true,
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
    });
    mockValidateAgentFundingDraftSubmission.mockResolvedValue({
      recipient: 'tb1qrecipient',
      amount: '10000',
      selectedUtxoIds: ['decoded-txid:0'],
      fee: '500',
      totalInput: '10500',
      totalOutput: '10000',
      changeAmount: '0',
      effectiveAmount: '10000',
      enableRBF: false,
      inputs: [{ txid: 'decoded-txid', vout: 0, address: 'tb1qfunding', amount: 10500 }],
      outputs: [{ address: 'tb1qrecipient', amount: 10000 }],
      inputPaths: ["m/48'/1'/0'/2'/0/0"],
    });
  });

  it('returns linked wallet summary for the scoped agent', async () => {
    const response = await request(app)
      .get('/api/v1/agent/wallets/funding-wallet/summary')
      .set('Authorization', 'Bearer agt_test');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      agent: { id: 'agent-1', name: 'Treasury Agent' },
      fundingWallet: { id: 'funding-wallet', balance: '20000' },
      operationalWallet: { id: 'operational-wallet', balance: '5000' },
      allowedActions: ['create_funding_draft'],
    });
  });

  it('returns the next known operational receive address', async () => {
    const response = await request(app)
      .get('/api/v1/agent/wallets/funding-wallet/operational-address')
      .set('Authorization', 'Bearer agt_test');

    expect(response.status).toBe(200);
    expect(mockGetOrCreateOperationalReceiveAddress).toHaveBeenCalledWith({
      agentId: 'agent-1',
      operationalWalletId: 'operational-wallet',
    });
    expect(response.body).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qoperational',
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
      generated: false,
    });
  });

  it('returns a generated operational receive address when the service derives one', async () => {
    mockGetOrCreateOperationalReceiveAddress.mockResolvedValueOnce({
      walletId: 'operational-wallet',
      address: 'tb1qgenerated',
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });

    const response = await request(app)
      .get('/api/v1/agent/wallets/funding-wallet/operational-address')
      .set('Authorization', 'Bearer agt_test');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qgenerated',
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });
  });

  it('verifies agent-provided operational receive addresses', async () => {
    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/operational-address/verify')
      .set('Authorization', 'Bearer agt_test')
      .send({ address: 'tb1qoperational' });

    expect(response.status).toBe(200);
    expect(mockVerifyOperationalReceiveAddress).toHaveBeenCalledWith({
      operationalWalletId: 'operational-wallet',
      address: 'tb1qoperational',
    });
    expect(response.body).toEqual({
      walletId: 'operational-wallet',
      address: 'tb1qoperational',
      verified: true,
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
    });
  });

  it('rejects empty operational address verification payloads', async () => {
    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/operational-address/verify')
      .set('Authorization', 'Bearer agt_test')
      .send({ address: '' });

    expect(response.status).toBe(400);
    expect(mockVerifyOperationalReceiveAddress).not.toHaveBeenCalled();
  });

  it('lets an agent update its own funding draft signature', async () => {
    const response = await request(app)
      .patch('/api/v1/agent/wallets/funding-wallet/funding-drafts/draft-agent/signature')
      .set('Authorization', 'Bearer agt_test')
      .send({ signedPsbtBase64: 'cHNidP8agentSigned' });

    expect(response.status).toBe(200);
    expect(mockGetDraft).toHaveBeenCalledWith('funding-wallet', 'draft-agent');
    expect(mockValidateAgentFundingDraftSubmission).toHaveBeenCalledWith(expect.objectContaining({
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      recipient: 'tb1qrecipient',
      amount: '10000',
      psbtBase64: 'cHNi',
      signedPsbtBase64: 'cHNidP8agentSigned',
      allowedDraftLockId: 'draft-agent',
    }));
    expect(mockUpdateDraft).toHaveBeenCalledWith('funding-wallet', 'draft-agent', {
      signedPsbtBase64: 'cHNidP8agentSigned',
      signedDeviceId: 'agent-device',
      status: 'partial',
    });
  });

  it('creates an agent funding draft with signer and notification metadata from the credential context', async () => {
    const payload = {
      operationalWalletId: 'operational-wallet',
      recipient: 'tb1qrecipient',
      amount: 10000,
      feeRate: 5,
      psbtBase64: 'cHNi',
      signedPsbtBase64: 'cHNidP8agentSigned',
      selectedUtxoIds: ['utxo-1'],
      fee: 999,
      label: 'Agent refill',
    };

    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/funding-drafts')
      .set('Authorization', 'Bearer agt_test')
      .send(payload);

    expect(response.status).toBe(201);
    expect(mockRequireAgentFundingDraftAccess).toHaveBeenCalledWith(
      agentContext,
      'funding-wallet',
      'operational-wallet'
    );
    expect(mockValidateAgentFundingDraftSubmission).toHaveBeenCalledWith({
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'agent-device',
      recipient: 'tb1qrecipient',
      amount: 10000,
      psbtBase64: 'cHNi',
      signedPsbtBase64: 'cHNidP8agentSigned',
    });
    expect(mockEnforceAgentFundingPolicy).toHaveBeenCalledWith('agent-1', 'operational-wallet', BigInt(10000));
    expect(mockWithAgentFundingLock).toHaveBeenCalledWith('agent-1', expect.any(Function));
    expect(mockCreateDraft).toHaveBeenCalledWith(
      'funding-wallet',
      'user-1',
      expect.objectContaining({
        recipient: 'tb1qrecipient',
        amount: '10000',
        feeRate: 5,
        selectedUtxoIds: ['decoded-txid:0'],
        psbtBase64: 'cHNi',
        signedPsbtBase64: 'cHNidP8agentSigned',
        signedDeviceId: 'agent-device',
        fee: '500',
        totalInput: '10500',
        totalOutput: '10000',
        isRBF: false,
        agentId: 'agent-1',
        agentOperationalWalletId: 'operational-wallet',
        notificationCreatedByUserId: null,
        notificationCreatedByLabel: 'Treasury Agent',
      })
    );
    expect(mockMarkAgentFundingDraftCreated).toHaveBeenCalledWith('agent-1');
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      draftId: 'draft-agent',
      status: 'accepted',
      amount: 10000n,
      feeRate: 5,
      recipient: 'tb1qrecipient',
    }));
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      username: 'agent:Treasury Agent',
      action: 'wallet.agent_funding_draft_submit',
      category: 'wallet',
      details: expect.objectContaining({
        agentId: 'agent-1',
        draftId: 'draft-agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
      }),
    }));
    expect(response.body).toEqual({ id: 'draft-agent', serialized: true });
  });

  it('marks owner overrides as used when policy enforcement returns an override', async () => {
    const events: string[] = [];
    mockEnforceAgentFundingPolicy.mockResolvedValueOnce({ overrideId: 'override-1' });
    mockWithAgentFundingLock.mockImplementationOnce(async (_agentId, fn) => {
      events.push('lock-start');
      const result = await fn();
      events.push('lock-end');
      return result;
    });
    mockMarkFundingOverrideUsed.mockImplementationOnce(async () => {
      events.push('mark-used');
    });

    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/funding-drafts')
      .set('Authorization', 'Bearer agt_test')
      .send({
        operationalWalletId: 'operational-wallet',
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 5,
        psbtBase64: 'cHNi',
        signedPsbtBase64: 'cHNidP8agentSigned',
      });

    expect(response.status).toBe(201);
    expect(mockCreateDraft).toHaveBeenCalledWith('funding-wallet', 'user-1', expect.objectContaining({
      label: 'Agent funding request: Treasury Agent (owner override)',
    }));
    expect(mockMarkFundingOverrideUsed).toHaveBeenCalledWith('override-1', 'draft-agent');
    expect(events).toEqual(['lock-start', 'mark-used', 'lock-end']);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wallet.agent_override_use',
      details: expect.objectContaining({
        agentId: 'agent-1',
        overrideId: 'override-1',
        draftId: 'draft-agent',
      }),
    }));
  });

  it('rejects invalid funding draft payloads before calling the service', async () => {
    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/funding-drafts')
      .send({ operationalWalletId: 'operational-wallet', recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });

  it('records rejected funding attempts with reason metadata', async () => {
    mockEnforceAgentFundingPolicy.mockRejectedValueOnce(new InvalidInputError('Agent daily funding limit would be exceeded'));

    const response = await request(app)
      .post('/api/v1/agent/wallets/funding-wallet/funding-drafts')
      .set('Authorization', 'Bearer agt_test')
      .send({
        operationalWalletId: 'operational-wallet',
        recipient: 'tb1qrecipient',
        amount: '10000',
        feeRate: 5,
        psbtBase64: 'cHNi',
        signedPsbtBase64: 'cHNidP8agentSigned',
      });

    expect(response.status).toBe(400);
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockCreateFundingAttempt).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      status: 'rejected',
      reasonCode: 'policy_daily_limit',
      reasonMessage: 'Agent daily funding limit would be exceeded',
      amount: 10000n,
      feeRate: 5,
      recipient: 'tb1qrecipient',
    }));
    expect(mockEvaluateRejectedFundingAttemptAlert).toHaveBeenCalledWith('agent-1', 'policy_daily_limit');
  });

  it('returns forbidden when the agent credential is not scoped to the wallet pair', async () => {
    mockRequireAgentFundingDraftAccess.mockImplementationOnce(() => {
      throw new ForbiddenError('Agent API key is not scoped for this funding wallet');
    });

    const response = await request(app)
      .post('/api/v1/agent/wallets/other-wallet/funding-drafts')
      .send({
        operationalWalletId: 'operational-wallet',
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 5,
        psbtBase64: 'cHNi',
        signedPsbtBase64: 'cHNidP8agentSigned',
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Agent API key is not scoped for this funding wallet');
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });
});
