import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWalletDashboard } from '../../components/AgentWalletDashboard';
import * as adminApi from '../../src/api/admin';

vi.mock('../../src/api/admin', () => ({
  getAgentWalletDashboard: vi.fn(),
  updateWalletAgent: vi.fn(),
  revokeAgentApiKey: vi.fn(),
}));

const agent = {
  id: 'agent-1',
  userId: 'user-1',
  name: 'Treasury Agent',
  status: 'active',
  fundingWalletId: 'funding-1',
  operationalWalletId: 'operational-1',
  signerDeviceId: 'device-1',
  maxFundingAmountSats: '100000',
  maxOperationalBalanceSats: '250000',
  dailyFundingLimitSats: null,
  weeklyFundingLimitSats: null,
  cooldownMinutes: 10,
  minOperationalBalanceSats: '25000',
  largeOperationalSpendSats: '75000',
  largeOperationalFeeSats: '5000',
  repeatedFailureThreshold: 3,
  repeatedFailureLookbackMinutes: 60,
  alertDedupeMinutes: 120,
  requireHumanApproval: true,
  notifyOnOperationalSpend: true,
  pauseOnUnexpectedSpend: false,
  lastFundingDraftAt: '2026-04-16T00:00:00.000Z',
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

const dashboardRow = {
  agent,
  operationalBalanceSats: '82000',
  pendingFundingDraftCount: 1,
  openAlertCount: 1,
  activeKeyCount: 1,
  lastFundingDraft: {
    id: 'draft-1',
    walletId: 'funding-1',
    recipient: 'tb1qops',
    amountSats: '50000',
    feeSats: '250',
    feeRate: 2.5,
    status: 'partial',
    approvalStatus: 'not_required',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  },
  lastOperationalSpend: {
    id: 'tx-1',
    txid: 'a'.repeat(64),
    walletId: 'operational-1',
    type: 'sent',
    amountSats: '12000',
    feeSats: '350',
    confirmations: 0,
    blockTime: null,
    counterpartyAddress: 'tb1qrecipient',
    createdAt: '2026-04-16T00:10:00.000Z',
  },
  recentFundingDrafts: [{
    id: 'draft-1',
    walletId: 'funding-1',
    recipient: 'tb1qops',
    amountSats: '50000',
    feeSats: '250',
    feeRate: 2.5,
    status: 'partial',
    approvalStatus: 'not_required',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }],
  recentOperationalSpends: [{
    id: 'tx-1',
    txid: 'a'.repeat(64),
    walletId: 'operational-1',
    type: 'sent',
    amountSats: '12000',
    feeSats: '350',
    confirmations: 0,
    blockTime: null,
    counterpartyAddress: 'tb1qrecipient',
    createdAt: '2026-04-16T00:10:00.000Z',
  }],
  recentAlerts: [{
    id: 'alert-1',
    agentId: 'agent-1',
    walletId: 'operational-1',
    type: 'operational_balance_low',
    severity: 'warning',
    status: 'open',
    txid: null,
    amountSats: '82000',
    feeSats: null,
    thresholdSats: '100000',
    observedCount: null,
    reasonCode: null,
    message: 'Operational balance is below threshold',
    dedupeKey: 'agent:agent-1:balance_low:operational-1',
    metadata: {},
    createdAt: '2026-04-16T00:20:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
  }],
} as any;

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AgentWalletDashboard />
    </MemoryRouter>
  );
}

describe('AgentWalletDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(adminApi.getAgentWalletDashboard).mockResolvedValue([dashboardRow]);
    vi.mocked(adminApi.updateWalletAgent).mockResolvedValue({ ...agent, status: 'paused' });
    vi.mocked(adminApi.revokeAgentApiKey).mockResolvedValue({ ...agent.apiKeys[0], revokedAt: '2026-04-16T01:00:00.000Z' });
  });

  it('renders operational balances, pending drafts, alerts, wallet links, and details', async () => {
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(screen.getByText('Spend-ready agents')).toBeInTheDocument();
    expect(screen.getAllByText('82,000 sats')).not.toHaveLength(0);
    expect(screen.getAllByText('Pending drafts')).not.toHaveLength(0);
    expect(screen.getByText('Last request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review Drafts' })).toHaveAttribute('href', '/wallets/funding-1');
    expect(screen.getByRole('link', { name: 'Funding' })).toHaveAttribute('href', '/wallets/funding-1');
    expect(screen.getByRole('link', { name: 'Operational' })).toHaveAttribute('href', '/wallets/operational-1');

    await user.click(screen.getByText('Review details'));

    expect(screen.getByText('Policy')).toBeInTheDocument();
    expect(screen.getByText('Funding Requests')).toBeInTheDocument();
    expect(screen.getByText('Operational Spends')).toBeInTheDocument();
    expect(screen.getByText('Alerts And Keys')).toBeInTheDocument();
    expect(screen.getByText('Operational balance is below threshold')).toBeInTheDocument();
    expect(screen.getByText(/Runtime/)).toBeInTheDocument();
  });

  it('renders destination classification metadata in spend details and alert history', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getAgentWalletDashboard).mockResolvedValueOnce([
      {
        ...dashboardRow,
        openAlertCount: 2,
        recentAlerts: [
          ...dashboardRow.recentAlerts,
          {
            ...dashboardRow.recentAlerts[0],
            id: 'alert-unknown-destination',
            type: 'operational_destination_unknown',
            txid: 'a'.repeat(64),
            message: 'Destination could not be classified',
            metadata: {
              destinationClassification: 'unknown_destination',
              unknownDestinationHandlingMode: 'notify_and_pause',
            },
          },
        ],
      },
    ]);

    renderDashboard();
    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();

    await user.click(screen.getByText('Review details'));

    expect(screen.getAllByText('Destination: Unknown destination')).toHaveLength(2);
    expect(screen.getByText('Handling: Notify and pause')).toBeInTheDocument();
    expect(screen.getByText('Destination could not be classified')).toBeInTheDocument();
  });

  it('pauses agents and revokes keys from the dashboard', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(adminApi.updateWalletAgent).toHaveBeenCalledWith('agent-1', { status: 'paused' }));
    expect(adminApi.getAgentWalletDashboard).toHaveBeenCalledTimes(2);

    await user.click(screen.getByText('Review details'));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(adminApi.revokeAgentApiKey).toHaveBeenCalledWith('agent-1', 'key-1'));
  });

  it('unpauses paused agents and handles empty/error states', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getAgentWalletDashboard).mockResolvedValueOnce([
      { ...dashboardRow, agent: { ...agent, status: 'paused' } },
    ]);

    const { unmount } = renderDashboard();
    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unpause' }));
    await waitFor(() => expect(adminApi.updateWalletAgent).toHaveBeenCalledWith('agent-1', { status: 'active' }));
    unmount();

    vi.mocked(adminApi.getAgentWalletDashboard).mockRejectedValueOnce(new Error('dashboard down'));
    renderDashboard();
    expect(await screen.findByText('dashboard down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    unmount();

    vi.mocked(adminApi.getAgentWalletDashboard).mockResolvedValueOnce([]);
    renderDashboard();
    expect(await screen.findByText('No agent wallets registered.')).toBeInTheDocument();
  });

  it('filters expired keys and disables pause actions for revoked agents', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getAgentWalletDashboard).mockResolvedValueOnce([
      {
        ...dashboardRow,
        activeKeyCount: 0,
        agent: {
          ...agent,
          status: 'revoked',
          revokedAt: '2026-04-16T02:00:00.000Z',
          apiKeys: [{
            ...agent.apiKeys[0],
            expiresAt: '2026-04-15T00:00:00.000Z',
          }],
        },
      },
    ]);

    renderDashboard();

    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();

    await user.click(screen.getByText('Review details'));

    expect(screen.getByText('No active keys.')).toBeInTheDocument();
  });
});
