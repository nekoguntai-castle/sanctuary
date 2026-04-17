import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findAgents: vi.fn(),
    createAgent: vi.fn(),
    findAgentById: vi.fn(),
    findAgentByIdWithDetails: vi.fn(),
    updateAgent: vi.fn(),
    findDashboardRows: vi.fn(),
    findAlerts: vi.fn(),
    findFundingOverrides: vi.fn(),
    createFundingOverride: vi.fn(),
    findFundingOverrideById: vi.fn(),
    revokeFundingOverride: vi.fn(),
    findApiKeysByAgentId: vi.fn(),
    createApiKey: vi.fn(),
    findApiKeyById: vi.fn(),
    revokeApiKey: vi.fn(),
  },
  userRepository: {
    findById: vi.fn(),
    findAllSummary: vi.fn(),
  },
  walletRepository: {
    findById: vi.fn(),
    findByIdWithSigningDevices: vi.fn(),
    hasAccess: vi.fn(),
    findAllWithSelect: vi.fn(),
  },
  logFromRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  userRepository: mocks.userRepository,
  walletRepository: mocks.walletRepository,
}));

vi.mock('../../../src/services/auditService', () => ({
  AuditAction: {
    AGENT_CREATE: 'wallet.agent_create',
    AGENT_UPDATE: 'wallet.agent_update',
    AGENT_REVOKE: 'wallet.agent_revoke',
    AGENT_KEY_CREATE: 'wallet.agent_key_create',
    AGENT_KEY_REVOKE: 'wallet.agent_key_revoke',
    AGENT_OVERRIDE_CREATE: 'wallet.agent_override_create',
    AGENT_OVERRIDE_REVOKE: 'wallet.agent_override_revoke',
  },
  AuditCategory: {
    WALLET: 'wallet',
  },
  auditService: {
    logFromRequest: mocks.logFromRequest,
  },
}));

import agentsRouter from '../../../src/api/admin/agents';

describe('Admin wallet agent routes', () => {
  let app: Express;
  const userId = '11111111-1111-4111-8111-111111111111';
  const fundingWalletId = '22222222-2222-4222-8222-222222222222';
  const operationalWalletId = '33333333-3333-4333-8333-333333333333';
  const signerDeviceId = '44444444-4444-4444-8444-444444444444';
  const agentId = '55555555-5555-4555-8555-555555555555';
  const keyId = '66666666-6666-4666-8666-666666666666';
  const now = new Date('2026-04-16T00:00:00.000Z');

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/agents', agentsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userRepository.findById.mockResolvedValue({ id: userId, username: 'alice', isAdmin: false });
    mocks.walletRepository.findById.mockImplementation(async (walletId: string) => {
      if (walletId === fundingWalletId) {
        return { id: fundingWalletId, name: 'Funding', type: 'multi_sig', network: 'testnet' };
      }
      if (walletId === operationalWalletId) {
        return { id: operationalWalletId, name: 'Operational', type: 'single_sig', network: 'testnet' };
      }
      return null;
    });
    mocks.walletRepository.findByIdWithSigningDevices.mockResolvedValue({
      id: fundingWalletId,
      devices: [{ deviceId: signerDeviceId }],
    });
    mocks.walletRepository.hasAccess.mockResolvedValue(true);
    mocks.userRepository.findAllSummary.mockResolvedValue([
      { id: userId, username: 'alice', email: 'alice@example.com', emailVerified: true, isAdmin: false, createdAt: now, updatedAt: now },
    ]);
    mocks.walletRepository.findAllWithSelect.mockResolvedValue([
      {
        id: fundingWalletId,
        name: 'Funding',
        type: 'multi_sig',
        network: 'testnet',
        users: [{ userId, role: 'owner' }],
        group: null,
        devices: [{
          deviceId: signerDeviceId,
          device: { id: signerDeviceId, label: 'Agent signer', fingerprint: 'aabbccdd', type: 'ledger', userId },
        }],
      },
      {
        id: operationalWalletId,
        name: 'Operational',
        type: 'single_sig',
        network: 'testnet',
        users: [],
        group: { members: [{ userId }] },
        devices: [],
      },
    ]);
  });

  it('lists admin-visible agent form options', async () => {
    const response = await request(app).get('/api/v1/admin/agents/options').expect(200);

    expect(response.body.users).toEqual([
      expect.objectContaining({ id: userId, username: 'alice' }),
    ]);
    expect(response.body.wallets).toEqual([
      expect.objectContaining({
        id: fundingWalletId,
        accessUserIds: [userId],
        deviceIds: [signerDeviceId],
      }),
      expect.objectContaining({
        id: operationalWalletId,
        accessUserIds: [userId],
        deviceIds: [],
      }),
    ]);
    expect(response.body.devices).toEqual([
      expect.objectContaining({
        id: signerDeviceId,
        label: 'Agent signer',
        walletIds: [fundingWalletId],
      }),
    ]);
  });

  it('lists wallet agents without key secrets', async () => {
    mocks.agentRepository.findAgents.mockResolvedValue([
      agentFixture({
        apiKeys: [keyFixture({ keyHash: 'secret' })],
      }),
    ]);

    const response = await request(app)
      .get(`/api/v1/admin/agents?walletId=${fundingWalletId}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: agentId,
      name: 'Treasury Agent',
      maxFundingAmountSats: '100000',
      apiKeys: [{ id: keyId, keyPrefix: 'agt_prefix' }],
    });
    expect(response.body[0].apiKeys[0].keyHash).toBeUndefined();
    expect(mocks.agentRepository.findAgents).toHaveBeenCalledWith({ walletId: fundingWalletId });
  });

  it('lists agent wallet dashboard rows', async () => {
    mocks.agentRepository.findDashboardRows.mockResolvedValue([
      {
        agent: agentFixture({ apiKeys: [keyFixture({ keyHash: 'secret' })] }),
        operationalBalanceSats: 82000n,
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        lastFundingDraft: draftFixture({ amount: 50000n }),
        lastOperationalSpend: transactionFixture({ amount: 12000n, fee: 350n }),
        recentFundingDrafts: [draftFixture({ amount: 50000n })],
        recentOperationalSpends: [transactionFixture({ amount: 12000n, fee: 350n })],
        recentAlerts: [alertFixture({ type: 'operational_balance_low' })],
      },
    ]);

    const response = await request(app).get('/api/v1/admin/agents/dashboard').expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        operationalBalanceSats: '82000',
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        agent: expect.objectContaining({
          id: agentId,
          apiKeys: [expect.objectContaining({ id: keyId, keyPrefix: 'agt_prefix' })],
        }),
        lastFundingDraft: expect.objectContaining({
          amountSats: '50000',
          feeSats: '250',
        }),
        lastOperationalSpend: expect.objectContaining({
          amountSats: '12000',
          feeSats: '350',
        }),
        recentAlerts: [expect.objectContaining({ type: 'operational_balance_low' })],
      }),
    ]);
    expect(response.body[0].agent.apiKeys[0].keyHash).toBeUndefined();
    expect(mocks.agentRepository.findDashboardRows).toHaveBeenCalledWith();
  });

  it('rejects invalid wallet agent list filters', async () => {
    await request(app).get('/api/v1/admin/agents?walletId=not-a-wallet-id').expect(400);
    expect(mocks.agentRepository.findAgents).not.toHaveBeenCalled();
  });

  it('creates a wallet agent after validating wallet and signer relationships', async () => {
    mocks.agentRepository.createAgent.mockImplementation(async input => agentFixture({
      ...input,
      id: agentId,
      createdAt: now,
      updatedAt: now,
    }));
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(agentFixture());

    const response = await request(app)
      .post('/api/v1/admin/agents')
      .send({
        userId,
        name: '  Treasury Agent  ',
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
        maxFundingAmountSats: '100000',
        minOperationalBalanceSats: '25000',
        largeOperationalSpendSats: '75000',
        largeOperationalFeeSats: '5000',
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
        cooldownMinutes: 10,
      })
      .expect(201);

    expect(response.body.maxFundingAmountSats).toBe('100000');
    expect(response.body.minOperationalBalanceSats).toBeNull();
    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledTimes(2);
    expect(mocks.agentRepository.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      name: 'Treasury Agent',
      fundingWalletId,
      operationalWalletId,
      signerDeviceId,
      maxFundingAmountSats: 100000n,
      minOperationalBalanceSats: 25000n,
      largeOperationalSpendSats: 75000n,
      largeOperationalFeeSats: 5000n,
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 60,
      alertDedupeMinutes: 120,
      cooldownMinutes: 10,
      requireHumanApproval: true,
    }));
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'wallet.agent_create', 'wallet', {
      details: expect.objectContaining({ agentId, fundingWalletId, operationalWalletId }),
    });
  });

  it('rejects invalid wallet-agent links', async () => {
    await request(app)
      .post('/api/v1/admin/agents')
      .send({ userId, name: '', fundingWalletId, operationalWalletId, signerDeviceId })
      .expect(400);

    mocks.walletRepository.findById.mockImplementationOnce(async () => ({ id: fundingWalletId, type: 'single_sig', network: 'testnet' }));
    await request(app)
      .post('/api/v1/admin/agents')
      .send({ userId, name: 'bad funding', fundingWalletId, operationalWalletId, signerDeviceId })
      .expect(400);

    mocks.walletRepository.findByIdWithSigningDevices.mockResolvedValueOnce({ id: fundingWalletId, devices: [] });
    await request(app)
      .post('/api/v1/admin/agents')
      .send({ userId, name: 'bad signer', fundingWalletId, operationalWalletId, signerDeviceId })
      .expect(400);
  });

  it('updates and revokes wallet agents', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValue(agentFixture({
      status: 'paused',
      maxFundingAmountSats: null,
    }));
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(agentFixture({
      status: 'paused',
      maxFundingAmountSats: null,
    }));

    const response = await request(app)
      .patch(`/api/v1/admin/agents/${agentId}`)
      .send({ status: 'paused', maxFundingAmountSats: null, minOperationalBalanceSats: null })
      .expect(200);

    expect(response.body.status).toBe('paused');
    expect(response.body.maxFundingAmountSats).toBeNull();
    expect(mocks.agentRepository.updateAgent).toHaveBeenCalledWith(agentId, expect.objectContaining({
      status: 'paused',
      maxFundingAmountSats: null,
      minOperationalBalanceSats: null,
      revokedAt: null,
    }));

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValueOnce(agentFixture({
      status: 'revoked',
      revokedAt: now,
    }));
    await request(app).delete(`/api/v1/admin/agents/${agentId}`).expect(200);
    expect(mocks.agentRepository.updateAgent).toHaveBeenCalledWith(agentId, expect.objectContaining({
      status: 'revoked',
      revokedAt: expect.any(Date),
    }));
  });

  it('lists persisted wallet agent alerts', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findAlerts.mockResolvedValue([
      alertFixture({
        type: 'large_operational_spend',
        amountSats: 75000n,
        thresholdSats: 50000n,
      }),
    ]);

    const response = await request(app)
      .get(`/api/v1/admin/agents/${agentId}/alerts?status=open&type=large_operational_spend&limit=10`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: '77777777-7777-4777-8777-777777777777',
        agentId,
        type: 'large_operational_spend',
        severity: 'warning',
        status: 'open',
        amountSats: '75000',
        thresholdSats: '50000',
      }),
    ]);
    expect(mocks.agentRepository.findAlerts).toHaveBeenCalledWith({
      agentId,
      status: 'open',
      type: 'large_operational_spend',
      limit: 10,
    });

    await request(app).get(`/api/v1/admin/agents/${agentId}/alerts?limit=0`).expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app).get(`/api/v1/admin/agents/${agentId}/alerts`).expect(404);
  });

  it('creates, lists, and revokes owner funding overrides', async () => {
    const overrideId = '88888888-8888-4888-8888-888888888888';
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findFundingOverrides.mockResolvedValue([overrideFixture({ id: overrideId })]);
    mocks.agentRepository.createFundingOverride.mockImplementation(async input => overrideFixture({
      id: overrideId,
      ...input,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }));

    const list = await request(app)
      .get(`/api/v1/admin/agents/${agentId}/overrides?status=active&limit=10`)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({
        id: overrideId,
        agentId,
        maxAmountSats: '150000',
        status: 'active',
      }),
    ]);
    expect(mocks.agentRepository.findFundingOverrides).toHaveBeenCalledWith({
      agentId,
      status: 'active',
      limit: 10,
    });

    const created = await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: '250000',
        expiresAt,
        reason: '  emergency refill  ',
      })
      .expect(201);

    expect(created.body).toEqual(expect.objectContaining({
      id: overrideId,
      maxAmountSats: '250000',
      reason: 'emergency refill',
      status: 'active',
    }));
    expect(mocks.agentRepository.createFundingOverride).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      fundingWalletId,
      operationalWalletId,
      createdByUserId: 'admin-1',
      maxAmountSats: 250000n,
      reason: 'emergency refill',
      expiresAt: expect.any(Date),
    }));
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'wallet.agent_override_create', 'wallet', expect.objectContaining({
      details: expect.objectContaining({ overrideId }),
    }));

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(overrideFixture({ id: overrideId }));
    mocks.agentRepository.revokeFundingOverride.mockResolvedValueOnce(overrideFixture({
      id: overrideId,
      status: 'revoked',
      revokedAt: now,
    }));

    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(200);

    expect(mocks.agentRepository.revokeFundingOverride).toHaveBeenCalledWith(overrideId);
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'wallet.agent_override_revoke', 'wallet', expect.objectContaining({
      details: expect.objectContaining({ overrideId }),
    }));
  });

  it('rejects invalid owner funding override requests', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());

    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({ maxAmountSats: '0', expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reason: 'zero' })
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({ maxAmountSats: '1000', expiresAt: new Date(Date.now() - 1000).toISOString(), reason: 'expired' })
      .expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .get(`/api/v1/admin/agents/${agentId}/overrides`)
      .expect(404);
  });

  it('rejects owner overrides for revoked agents and protects revoke tenant boundaries', async () => {
    const overrideId = '88888888-8888-4888-8888-888888888888';

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture({
      status: 'revoked',
      revokedAt: now,
    }));
    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: '250000',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'revoked agent',
      })
      .expect(400);
    expect(mocks.agentRepository.createFundingOverride).not.toHaveBeenCalled();

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(null);
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(404);

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(overrideFixture({
      id: overrideId,
      agentId: '99999999-9999-4999-8999-999999999999',
    }));
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(404);
  });

  it('does not revoke an already inactive owner override a second time', async () => {
    const overrideId = '88888888-8888-4888-8888-888888888888';
    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(overrideFixture({
      id: overrideId,
      status: 'used',
      usedAt: now,
      usedDraftId: 'draft-1',
    }));

    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(200);

    expect(mocks.agentRepository.revokeFundingOverride).not.toHaveBeenCalled();
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'wallet.agent_override_revoke', 'wallet', expect.objectContaining({
      details: expect.objectContaining({
        overrideId,
        alreadyInactive: true,
      }),
    }));
  });

  it('creates, lists, and revokes scoped agent API keys', async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findApiKeysByAgentId.mockResolvedValue([keyFixture()]);
    mocks.agentRepository.createApiKey.mockImplementation(async input => keyFixture({
      ...input,
      id: keyId,
      createdAt: now,
    }));

    const list = await request(app).get(`/api/v1/admin/agents/${agentId}/keys`).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: keyId, keyPrefix: 'agt_prefix' })]);

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const create = await request(app)
      .post(`/api/v1/admin/agents/${agentId}/keys`)
      .send({ name: ' Runtime ', expiresAt })
      .expect(201);

    expect(create.body.apiKey).toMatch(/^agt_[a-f0-9]{64}$/);
    expect(create.body.keyPrefix).toBe(create.body.apiKey.slice(0, 16));
    expect(mocks.agentRepository.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      createdByUserId: 'admin-1',
      name: 'Runtime',
      keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      keyPrefix: create.body.apiKey.slice(0, 16),
      scope: { allowedActions: ['create_funding_draft'] },
      expiresAt: expect.any(Date),
    }));

    mocks.agentRepository.findApiKeyById.mockResolvedValueOnce(keyFixture());
    mocks.agentRepository.revokeApiKey.mockResolvedValueOnce(keyFixture({ revokedAt: now }));
    await request(app).delete(`/api/v1/admin/agents/${agentId}/keys/${keyId}`).expect(200);
    expect(mocks.agentRepository.revokeApiKey).toHaveBeenCalledWith(keyId);
  });
});

function agentFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '55555555-5555-4555-8555-555555555555',
    userId: '11111111-1111-4111-8111-111111111111',
    name: 'Treasury Agent',
    status: 'active',
    fundingWalletId: '22222222-2222-4222-8222-222222222222',
    operationalWalletId: '33333333-3333-4333-8333-333333333333',
    signerDeviceId: '44444444-4444-4444-8444-444444444444',
    maxFundingAmountSats: 100000n,
    maxOperationalBalanceSats: null,
    dailyFundingLimitSats: null,
    weeklyFundingLimitSats: null,
    cooldownMinutes: null,
    minOperationalBalanceSats: null,
    largeOperationalSpendSats: null,
    largeOperationalFeeSats: null,
    repeatedFailureThreshold: null,
    repeatedFailureLookbackMinutes: null,
    alertDedupeMinutes: null,
    requireHumanApproval: true,
    notifyOnOperationalSpend: true,
    pauseOnUnexpectedSpend: false,
    lastFundingDraftAt: null,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    user: { id: '11111111-1111-4111-8111-111111111111', username: 'alice', isAdmin: false },
    fundingWallet: { id: '22222222-2222-4222-8222-222222222222', name: 'Funding', type: 'multi_sig', network: 'testnet' },
    operationalWallet: { id: '33333333-3333-4333-8333-333333333333', name: 'Operational', type: 'single_sig', network: 'testnet' },
    signerDevice: { id: '44444444-4444-4444-8444-444444444444', label: 'Agent signer', fingerprint: 'aabbccdd' },
    apiKeys: [],
    ...overrides,
  };
}

function alertFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '77777777-7777-4777-8777-777777777777',
    agentId: '55555555-5555-4555-8555-555555555555',
    walletId: '33333333-3333-4333-8333-333333333333',
    type: 'operational_balance_low',
    severity: 'warning',
    status: 'open',
    txid: null,
    amountSats: 20000n,
    feeSats: null,
    thresholdSats: 25000n,
    observedCount: null,
    reasonCode: null,
    message: 'Agent operational wallet balance is below threshold',
    dedupeKey: 'agent:agent-1:balance_low:wallet',
    metadata: { thresholdSats: '25000' },
    createdAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function draftFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '88888888-8888-4888-8888-888888888888',
    walletId: '22222222-2222-4222-8222-222222222222',
    recipient: 'tb1qoperational',
    amount: 100000n,
    fee: 250n,
    feeRate: 2.5,
    status: 'partial',
    approvalStatus: 'not_required',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function transactionFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '99999999-9999-4999-8999-999999999999',
    txid: 'a'.repeat(64),
    walletId: '33333333-3333-4333-8333-333333333333',
    type: 'sent',
    amount: 10000n,
    fee: 300n,
    confirmations: 0,
    blockTime: null,
    counterpartyAddress: 'tb1qrecipient',
    createdAt: now,
    ...overrides,
  };
}

function overrideFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '88888888-8888-4888-8888-888888888888',
    agentId: '55555555-5555-4555-8555-555555555555',
    fundingWalletId: '22222222-2222-4222-8222-222222222222',
    operationalWalletId: '33333333-3333-4333-8333-333333333333',
    createdByUserId: 'admin-1',
    reason: 'emergency refill',
    maxAmountSats: 150000n,
    expiresAt: new Date('2026-04-17T00:00:00.000Z'),
    status: 'active',
    usedAt: null,
    usedDraftId: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function keyFixture(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-16T00:00:00.000Z');
  return {
    id: '66666666-6666-4666-8666-666666666666',
    agentId: '55555555-5555-4555-8555-555555555555',
    createdByUserId: 'admin-1',
    name: 'Runtime',
    keyHash: 'secret',
    keyPrefix: 'agt_prefix',
    scope: { allowedActions: ['create_funding_draft'] },
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedAgent: null,
    expiresAt: null,
    createdAt: now,
    revokedAt: null,
    ...overrides,
  };
}
