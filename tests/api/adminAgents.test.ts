import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import * as adminAgentsApi from '../../src/api/admin/agents';

describe('admin wallet agents API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({});
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
  });

  it('calls wallet agent profile endpoints', async () => {
    await adminAgentsApi.getWalletAgents();
    await adminAgentsApi.getWalletAgents({ walletId: 'wallet-1' });
    await adminAgentsApi.getWalletAgentOptions();
    await adminAgentsApi.getAgentWalletDashboard();
    await adminAgentsApi.createWalletAgent({
      userId: 'user-1',
      name: 'Agent',
      fundingWalletId: 'funding-1',
      operationalWalletId: 'operational-1',
      signerDeviceId: 'device-1',
    });
    await adminAgentsApi.updateWalletAgent('agent-1', { status: 'paused' });
    await adminAgentsApi.revokeWalletAgent('agent-1');
    await adminAgentsApi.getAgentAlerts('agent-1', { status: 'open', type: 'large_operational_spend', limit: 10 });

    expect(mockGet).toHaveBeenCalledWith('/admin/agents');
    expect(mockGet).toHaveBeenCalledWith('/admin/agents', { walletId: 'wallet-1' });
    expect(mockGet).toHaveBeenCalledWith('/admin/agents/options');
    expect(mockGet).toHaveBeenCalledWith('/admin/agents/dashboard');
    expect(mockGet).toHaveBeenCalledWith('/admin/agents/agent-1/alerts', {
      status: 'open',
      type: 'large_operational_spend',
      limit: 10,
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/agents', {
      userId: 'user-1',
      name: 'Agent',
      fundingWalletId: 'funding-1',
      operationalWalletId: 'operational-1',
      signerDeviceId: 'device-1',
    });
    expect(mockPatch).toHaveBeenCalledWith('/admin/agents/agent-1', { status: 'paused' });
    expect(mockDelete).toHaveBeenCalledWith('/admin/agents/agent-1');
  });

  it('calls agent API key endpoints', async () => {
    await adminAgentsApi.getAgentApiKeys('agent-1');
    await adminAgentsApi.createAgentApiKey('agent-1', {
      name: 'Runtime',
      allowedActions: ['create_funding_draft'],
    });
    await adminAgentsApi.revokeAgentApiKey('agent-1', 'key-1');

    expect(mockGet).toHaveBeenCalledWith('/admin/agents/agent-1/keys');
    expect(mockPost).toHaveBeenCalledWith('/admin/agents/agent-1/keys', {
      name: 'Runtime',
      allowedActions: ['create_funding_draft'],
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/agents/agent-1/keys/key-1');
  });
});
