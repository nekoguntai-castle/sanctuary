import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    createAgent: vi.fn(),
    findAgentById: vi.fn(),
    findAgentByIdWithDetails: vi.fn(),
    createFundingOverride: vi.fn(),
    createApiKey: vi.fn(),
  },
  userRepository: {
    findById: vi.fn(),
  },
  walletRepository: {
    findById: vi.fn(),
    findByIdWithSigningDevices: vi.fn(),
    hasAccess: vi.fn(),
    findGroupRoleByMembership: vi.fn(),
  },
  walletSharingRepository: {
    findWalletUser: vi.fn(),
  },
}));

// The real agentWalletAccess (through accessControl) resolves the linked user's roles from these repositories.
vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  userRepository: mocks.userRepository,
  walletRepository: mocks.walletRepository,
  walletSharingRepository: mocks.walletSharingRepository,
}));

/** Direct wallet roles of user-1; `null` means no access to that wallet. */
function grantRoles(funding: string | null, operational: string | null) {
  const roleOf = (id: string) => (id === 'funding-wallet' ? funding : operational);
  mocks.walletSharingRepository.findWalletUser.mockImplementation(async (id: string) => {
    const role = roleOf(id);
    return role === null ? null : { walletId: id, userId: 'user-1', role };
  });
  mocks.walletRepository.findGroupRoleByMembership.mockResolvedValue(null);
  mocks.walletRepository.hasAccess.mockImplementation(async (id: string) => roleOf(id) !== null);
}

import {
  createAgentApiKey,
  createAgentFundingOverride,
  createWalletAgent,
} from '../../../src/services/adminAgentService';

const activeAgent = {
  id: 'agent-1',
  fundingWalletId: 'funding-wallet',
  operationalWalletId: 'operational-wallet',
  status: 'active',
  revokedAt: null,
};

const fundingWallet = {
  id: 'funding-wallet',
  type: 'multi_sig',
  network: 'testnet',
};

const operationalWallet = {
  id: 'operational-wallet',
  type: 'single_sig',
  network: 'testnet',
};

describe('adminAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentRepository.createAgent.mockResolvedValue({
      id: 'agent-1',
      status: 'active',
    });
    mocks.agentRepository.findAgentById.mockResolvedValue(activeAgent);
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue({
      id: 'agent-1',
      hydrated: true,
    });
    mocks.agentRepository.createFundingOverride.mockResolvedValue({
      id: 'override-1',
    });
    mocks.agentRepository.createApiKey.mockImplementation(async input => ({
      id: 'key-1',
      ...input,
    }));
    mocks.userRepository.findById.mockResolvedValue({ id: 'user-1' });
    mocks.walletRepository.findById.mockResolvedValueOnce(fundingWallet).mockResolvedValueOnce(operationalWallet);
    mocks.walletRepository.findByIdWithSigningDevices.mockResolvedValue({
      id: 'funding-wallet',
      devices: [{ deviceId: 'device-1' }],
    });
    grantRoles('signer', 'signer');
  });

  it('creates a wallet agent with trimmed input and returns detailed metadata when available', async () => {
    const result = await createWalletAgent({
      userId: 'user-1',
      name: '  Treasury Agent  ',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'device-1',
      maxFundingAmountSats: 100000n,
      maxOperationalBalanceSats: 200000n,
      dailyFundingLimitSats: 300000n,
      weeklyFundingLimitSats: 900000n,
      cooldownMinutes: 15,
      minOperationalBalanceSats: 25000n,
      largeOperationalSpendSats: 75000n,
      largeOperationalFeeSats: 5000n,
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 60,
      alertDedupeMinutes: 120,
      requireHumanApproval: false,
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: true,
    });

    expect(mocks.agentRepository.createAgent).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Treasury Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      signerDeviceId: 'device-1',
      status: undefined,
      maxFundingAmountSats: 100000n,
      maxOperationalBalanceSats: 200000n,
      dailyFundingLimitSats: 300000n,
      weeklyFundingLimitSats: 900000n,
      cooldownMinutes: 15,
      minOperationalBalanceSats: 25000n,
      largeOperationalSpendSats: 75000n,
      largeOperationalFeeSats: 5000n,
      repeatedFailureThreshold: 3,
      repeatedFailureLookbackMinutes: 60,
      alertDedupeMinutes: 120,
      requireHumanApproval: false,
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: true,
    });
    expect(result).toEqual({ id: 'agent-1', hydrated: true });
  });

  it('falls back to the created agent when detailed metadata is not found', async () => {
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValueOnce(null);

    await expect(
      createWalletAgent({
        userId: 'user-1',
        name: 'Ops Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: 'device-1',
      })
    ).resolves.toEqual({ id: 'agent-1', status: 'active' });
  });

  it('creates requester-only links from single-sig funding wallets without a signer device', async () => {
    mocks.walletRepository.findById
      .mockReset()
      .mockResolvedValueOnce({ ...fundingWallet, type: 'single_sig' })
      .mockResolvedValueOnce(operationalWallet);

    await createWalletAgent({
      userId: 'user-1',
      name: 'Requester Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
    });

    expect(mocks.agentRepository.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Requester Agent',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        signerDeviceId: null,
      })
    );
  });

  it('defaults funding override creator to null when no user id is provided', async () => {
    await createAgentFundingOverride('agent-1', {
      maxAmountSats: 25_000n,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      reason: '  temporary refill  ',
    });

    expect(mocks.agentRepository.createFundingOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'operational-wallet',
        createdByUserId: null,
        reason: 'temporary refill',
        maxAmountSats: 25_000n,
      })
    );
  });

  it('defaults API key creator to null when no user id is provided', async () => {
    const result = await createAgentApiKey('agent-1', {
      name: '  Runtime  ',
      allowedActions: ['create_funding_draft'],
    });

    expect(result.apiKey).toMatch(/^agt_/);
    expect(mocks.agentRepository.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        createdByUserId: null,
        name: 'Runtime',
        keyPrefix: expect.stringMatching(/^agt_/),
        keyHash: expect.any(String),
        scope: { allowedActions: ['create_funding_draft'] },
        expiresAt: null,
      })
    );
  });
  describe('linked user wallet roles (same rule as the agent key at runtime)', () => {
    const linkInput = {
      userId: 'user-1',
      name: 'Role Agent',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
    };
    it.each(['viewer', 'approver'])('refuses to link a user who is only %s on the funding wallet', async role => {
      grantRoles(role, 'owner');

      await expect(createWalletAgent(linkInput)).rejects.toThrow('User must be an owner or signer of the funding wallet');
      expect(mocks.agentRepository.createAgent).not.toHaveBeenCalled();
    });

    it('links a funding-wallet signer who only views the operational wallet', async () => {
      grantRoles('signer', 'viewer');

      await createWalletAgent(linkInput);

      expect(mocks.agentRepository.createAgent).toHaveBeenCalledOnce();
      expect(mocks.walletSharingRepository.findWalletUser).toHaveBeenCalledWith('funding-wallet', 'user-1');
      expect(mocks.walletRepository.hasAccess).toHaveBeenCalledWith('operational-wallet', 'user-1');
    });

    it.each([
      ['funding', null, 'owner'],
      ['operational', 'owner', null],
    ] as const)('refuses a user with no access to the %s wallet', async (wallet, funding, operational) => {
      grantRoles(funding, operational);

      await expect(createWalletAgent(linkInput)).rejects.toThrow(`User does not have access to the ${wallet} wallet`);
      expect(mocks.agentRepository.createAgent).not.toHaveBeenCalled();
    });
  });
});
