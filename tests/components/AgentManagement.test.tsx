import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentManagement } from '../../components/AgentManagement';
import * as adminApi from '../../src/api/admin';

vi.mock('../../src/api/admin', () => ({
  getWalletAgents: vi.fn(),
  getWalletAgentOptions: vi.fn(),
  createWalletAgent: vi.fn(),
  updateWalletAgent: vi.fn(),
  revokeWalletAgent: vi.fn(),
  createAgentApiKey: vi.fn(),
  revokeAgentApiKey: vi.fn(),
}));

const writeTextMock = vi.fn();

const agent = {
  id: 'agent-1',
  userId: 'user-1',
  name: 'Treasury Agent',
  status: 'active',
  fundingWalletId: 'funding-1',
  operationalWalletId: 'operational-1',
  signerDeviceId: 'device-1',
  maxFundingAmountSats: '100000',
  maxOperationalBalanceSats: null,
  dailyFundingLimitSats: null,
  weeklyFundingLimitSats: null,
  cooldownMinutes: 10,
  requireHumanApproval: true,
  notifyOnOperationalSpend: true,
  pauseOnUnexpectedSpend: false,
  lastFundingDraftAt: null,
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
  revokedAt: null,
  user: { id: 'user-1', username: 'alice', isAdmin: false },
  fundingWallet: { id: 'funding-1', name: 'Funding', type: 'multi_sig', network: 'testnet' },
  operationalWallet: { id: 'operational-1', name: 'Operational', type: 'single_sig', network: 'testnet' },
  signerDevice: { id: 'device-1', label: 'Agent Signer', fingerprint: 'aabbccdd' },
  apiKeys: [{
    id: 'key-1',
    agentId: 'agent-1',
    createdByUserId: 'admin-1',
    name: 'Runtime',
    keyPrefix: 'agt_prefix',
    scope: { allowedActions: ['create_funding_draft'] },
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedAgent: null,
    expiresAt: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    revokedAt: null,
  }],
} as any;

const options = {
  users: [
    { id: 'user-1', username: 'alice', email: 'alice@example.com', emailVerified: true, isAdmin: false, createdAt: '2026-04-16T00:00:00.000Z', updatedAt: '2026-04-16T00:00:00.000Z' },
  ],
  wallets: [
    { id: 'funding-1', name: 'Funding', type: 'multi_sig', network: 'testnet', accessUserIds: ['user-1'], deviceIds: ['device-1'] },
    { id: 'operational-1', name: 'Operational', type: 'single_sig', network: 'testnet', accessUserIds: ['user-1'], deviceIds: [] },
  ],
  devices: [
    { id: 'device-1', label: 'Agent Signer', fingerprint: 'aabbccdd', type: 'ledger', userId: 'user-1', walletIds: ['funding-1'] },
  ],
};

describe('AgentManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getWalletAgents).mockResolvedValue([agent]);
    vi.mocked(adminApi.getWalletAgentOptions).mockResolvedValue(options);
    vi.mocked(adminApi.createWalletAgent).mockResolvedValue(agent);
    vi.mocked(adminApi.updateWalletAgent).mockResolvedValue({ ...agent, status: 'paused' });
    vi.mocked(adminApi.revokeWalletAgent).mockResolvedValue({ ...agent, status: 'revoked', revokedAt: '2026-04-16T01:00:00.000Z' });
    vi.mocked(adminApi.createAgentApiKey).mockResolvedValue({
      ...agent.apiKeys[0],
      id: 'key-2',
      name: 'New Runtime',
      apiKey: 'agt_'.padEnd(68, 'a'),
    });
    vi.mocked(adminApi.revokeAgentApiKey).mockResolvedValue({ ...agent.apiKeys[0], revokedAt: '2026-04-16T01:00:00.000Z' });
    vi.stubGlobal('confirm', vi.fn(() => true));
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it('loads and renders wallet agent summary, policy, and key metadata', async () => {
    render(<AgentManagement />);

    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(screen.getByText('Active agents')).toBeInTheDocument();
    expect(screen.getByText('Funding')).toBeInTheDocument();
    expect(screen.getByText('Operational')).toBeInTheDocument();
    expect(screen.getByText(/Request cap: 100,000 sats/)).toBeInTheDocument();
    expect(screen.getByText(/Runtime/)).toBeInTheDocument();
  });

  it('renders empty and recoverable load-error states', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getWalletAgents).mockRejectedValueOnce(new Error('network down'));

    const { unmount } = render(<AgentManagement />);

    expect(await screen.findByText('network down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(adminApi.getWalletAgents).toHaveBeenCalledTimes(2);
    unmount();

    vi.mocked(adminApi.getWalletAgents).mockResolvedValueOnce([]);
    render(<AgentManagement />);

    expect(await screen.findByText('No wallet agents registered.')).toBeInTheDocument();
  });

  it('creates an agent using filtered wallet and signer options', async () => {
    const user = userEvent.setup();
    render(<AgentManagement />);

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Create Agent/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.selectOptions(selects[2], 'funding-1');
    await user.selectOptions(selects[3], 'operational-1');
    await user.selectOptions(selects[4], 'device-1');
    await user.type(screen.getByPlaceholderText('0'), '15');

    await user.click(screen.getAllByRole('button', { name: 'Create Agent' }).at(-1)!);

    await waitFor(() => expect(adminApi.createWalletAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ops Agent',
      userId: 'user-1',
      fundingWalletId: 'funding-1',
      operationalWalletId: 'operational-1',
      signerDeviceId: 'device-1',
      cooldownMinutes: 15,
      requireHumanApproval: true,
    })));
  });

  it('updates agent policy and issues a one-time key', async () => {
    const user = userEvent.setup();
    render(<AgentManagement />);

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], 'paused');
    const capInput = screen.getByDisplayValue('100000');
    await user.clear(capInput);
    await user.type(capInput, '250000');
    await user.click(screen.getByRole('button', { name: 'Save Agent' }));

    await waitFor(() => expect(adminApi.updateWalletAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      status: 'paused',
      maxFundingAmountSats: '250000',
    })));

    await user.click(screen.getByRole('button', { name: 'Issue Key' }));
    await user.type(screen.getByPlaceholderText('Agent runtime key'), 'New Runtime');
    await user.click(screen.getByRole('button', { name: 'Create Key' }));

    await waitFor(() => expect(adminApi.createAgentApiKey).toHaveBeenCalledWith('agent-1', {
      name: 'New Runtime',
      allowedActions: ['create_funding_draft'],
    }));
    expect(await screen.findByDisplayValue(/^agt_/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('reports when a one-time key cannot be copied', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    render(<AgentManagement />);

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Issue Key' }));
    await user.type(screen.getByPlaceholderText('Agent runtime key'), 'New Runtime');
    await user.click(screen.getByRole('button', { name: 'Create Key' }));
    expect(await screen.findByDisplayValue(/^agt_/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Clipboard is not available in this browser')).toBeInTheDocument();
  });

  it('revokes keys and agents after confirmation', async () => {
    const user = userEvent.setup();
    render(<AgentManagement />);

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByText('Revoke', { selector: 'button.text-rose-500' }));
    await waitFor(() => expect(adminApi.revokeAgentApiKey).toHaveBeenCalledWith('agent-1', 'key-1'));

    await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);
    await waitFor(() => expect(adminApi.revokeWalletAgent).toHaveBeenCalledWith('agent-1'));
  });
});
