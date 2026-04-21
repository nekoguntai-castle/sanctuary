import type { Mock } from 'vitest';

type AdminAgentRouteMocks = {
  userRepository: {
    findById: Mock;
    findAllSummary: Mock;
  };
  walletRepository: {
    findById: Mock;
    findByIdWithSigningDevices: Mock;
    hasAccess: Mock;
    findAllWithSelect: Mock;
  };
};

export const ADMIN_AGENT_TEST_IDS = {
  userId: '11111111-1111-4111-8111-111111111111',
  fundingWalletId: '22222222-2222-4222-8222-222222222222',
  operationalWalletId: '33333333-3333-4333-8333-333333333333',
  signerDeviceId: '44444444-4444-4444-8444-444444444444',
  agentId: '55555555-5555-4555-8555-555555555555',
  keyId: '66666666-6666-4666-8666-666666666666',
} as const;

export const ADMIN_AGENT_TEST_NOW = new Date('2026-04-16T00:00:00.000Z');

export function configureDefaultAdminAgentRouteMocks(mocks: AdminAgentRouteMocks) {
  const {
    userId,
    fundingWalletId,
    operationalWalletId,
    signerDeviceId,
  } = ADMIN_AGENT_TEST_IDS;
  const now = ADMIN_AGENT_TEST_NOW;

  mocks.userRepository.findById.mockResolvedValue({
    id: userId,
    username: 'alice',
    isAdmin: false,
  });
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
    {
      id: userId,
      username: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  mocks.walletRepository.findAllWithSelect.mockResolvedValue([
    {
      id: fundingWalletId,
      name: 'Funding',
      type: 'multi_sig',
      network: 'testnet',
      users: [{ userId, role: 'owner' }],
      group: null,
      devices: [
        {
          deviceId: signerDeviceId,
          device: {
            id: signerDeviceId,
            label: 'Agent signer',
            fingerprint: 'aabbccdd',
            type: 'ledger',
            userId,
          },
        },
      ],
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
}

export function agentFixture(overrides: Record<string, unknown> = {}) {
  const {
    userId,
    fundingWalletId,
    operationalWalletId,
    signerDeviceId,
    agentId,
  } = ADMIN_AGENT_TEST_IDS;
  const now = ADMIN_AGENT_TEST_NOW;

  return {
    id: agentId,
    userId,
    name: 'Treasury Agent',
    status: 'active',
    fundingWalletId,
    operationalWalletId,
    signerDeviceId,
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
    user: { id: userId, username: 'alice', isAdmin: false },
    fundingWallet: { id: fundingWalletId, name: 'Funding', type: 'multi_sig', network: 'testnet' },
    operationalWallet: { id: operationalWalletId, name: 'Operational', type: 'single_sig', network: 'testnet' },
    signerDevice: { id: signerDeviceId, label: 'Agent signer', fingerprint: 'aabbccdd' },
    apiKeys: [],
    ...overrides,
  };
}

export function alertFixture(overrides: Record<string, unknown> = {}) {
  const now = ADMIN_AGENT_TEST_NOW;
  return {
    id: '77777777-7777-4777-8777-777777777777',
    agentId: ADMIN_AGENT_TEST_IDS.agentId,
    walletId: ADMIN_AGENT_TEST_IDS.operationalWalletId,
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

export function draftFixture(overrides: Record<string, unknown> = {}) {
  const now = ADMIN_AGENT_TEST_NOW;
  return {
    id: '88888888-8888-4888-8888-888888888888',
    walletId: ADMIN_AGENT_TEST_IDS.fundingWalletId,
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

export function transactionFixture(overrides: Record<string, unknown> = {}) {
  const now = ADMIN_AGENT_TEST_NOW;
  return {
    id: '99999999-9999-4999-8999-999999999999',
    txid: 'a'.repeat(64),
    walletId: ADMIN_AGENT_TEST_IDS.operationalWalletId,
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

export function overrideFixture(overrides: Record<string, unknown> = {}) {
  const now = ADMIN_AGENT_TEST_NOW;
  return {
    id: '88888888-8888-4888-8888-888888888888',
    agentId: ADMIN_AGENT_TEST_IDS.agentId,
    fundingWalletId: ADMIN_AGENT_TEST_IDS.fundingWalletId,
    operationalWalletId: ADMIN_AGENT_TEST_IDS.operationalWalletId,
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

export function keyFixture(overrides: Record<string, unknown> = {}) {
  const now = ADMIN_AGENT_TEST_NOW;
  return {
    id: ADMIN_AGENT_TEST_IDS.keyId,
    agentId: ADMIN_AGENT_TEST_IDS.agentId,
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
