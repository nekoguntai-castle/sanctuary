import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  agentRepository: {
    findAgentById: vi.fn(),
    createFundingOverride: vi.fn(),
    createApiKey: vi.fn(),
  },
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: mocks.agentRepository,
  userRepository: {},
  walletRepository: {},
}));

import {
  createAgentApiKey,
  createAgentFundingOverride,
} from '../../../src/services/adminAgentService';

const activeAgent = {
  id: 'agent-1',
  fundingWalletId: 'funding-wallet',
  operationalWalletId: 'operational-wallet',
  status: 'active',
  revokedAt: null,
};

describe('adminAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentRepository.findAgentById.mockResolvedValue(activeAgent);
    mocks.agentRepository.createFundingOverride.mockResolvedValue({ id: 'override-1' });
    mocks.agentRepository.createApiKey.mockImplementation(async (input) => ({
      id: 'key-1',
      ...input,
    }));
  });

  it('defaults funding override creator to null when no user id is provided', async () => {
    await createAgentFundingOverride('agent-1', {
      maxAmountSats: 25_000n,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      reason: '  temporary refill  ',
    });

    expect(mocks.agentRepository.createFundingOverride).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      createdByUserId: null,
      reason: 'temporary refill',
      maxAmountSats: 25_000n,
    }));
  });

  it('defaults API key creator to null when no user id is provided', async () => {
    const result = await createAgentApiKey('agent-1', {
      name: '  Runtime  ',
      allowedActions: ['create_funding_draft'],
    });

    expect(result.apiKey).toMatch(/^agt_/);
    expect(mocks.agentRepository.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      createdByUserId: null,
      name: 'Runtime',
      keyPrefix: expect.stringMatching(/^agt_/),
      keyHash: expect.any(String),
      scope: { allowedActions: ['create_funding_draft'] },
      expiresAt: null,
    }));
  });
});
