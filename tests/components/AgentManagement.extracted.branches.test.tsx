import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActiveKeyList } from '../../components/AgentManagement/AgentManagement/ActiveKeyList';
import { AgentFormModal } from '../../components/AgentManagement/AgentManagement/AgentFormModal';
import { AgentHeader } from '../../components/AgentManagement/AgentManagement/AgentHeader';
import {
  canSubmitAgentForm,
  getFundingWallets,
  getOperationalWallets,
  getSelectedFundingWallet,
  getSignerDevices,
  reconcileAgentFormSelections,
  setAgentFormFundingWallet,
  setAgentFormUser,
  toDeviceOptions,
  toUserOptions,
  toWalletOptions,
} from '../../components/AgentManagement/AgentManagement/formOptions';
import {
  createInitialAgentForm,
  DEFAULT_AGENT_FORM,
  type AgentFormState,
} from '../../components/AgentManagement/AgentManagement/formState';
import {
  getActiveAgentKeys,
  getAgentInfoBlocks,
  getMonitoringSummary,
  getPolicySummary,
  getTimelineSummary,
  isAgentRevoked,
} from '../../components/AgentManagement/AgentManagement/agentRowModel';
import type {
  AgentApiKeyMetadata,
  AgentManagementOptions,
  WalletAgentMetadata,
} from '../../src/api/admin';

const activeApiKey: AgentApiKeyMetadata = {
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
};

const revokedApiKey: AgentApiKeyMetadata = {
  ...activeApiKey,
  id: 'key-2',
  name: 'Old Runtime',
  revokedAt: '2026-04-17T00:00:00.000Z',
};

const options: AgentManagementOptions = {
  users: [
    { id: 'user-1', username: 'alice', email: 'alice@example.com', emailVerified: true, isAdmin: false, createdAt: '2026-04-16T00:00:00.000Z', updatedAt: '2026-04-16T00:00:00.000Z' },
    { id: 'user-2', username: 'bob', email: null, emailVerified: false, isAdmin: false, createdAt: '2026-04-16T00:00:00.000Z', updatedAt: '2026-04-16T00:00:00.000Z' },
  ],
  wallets: [
    { id: 'funding-1', name: 'Funding', type: 'multi_sig', network: 'testnet', accessUserIds: ['user-1'], deviceIds: ['device-1'] },
    { id: 'funding-2', name: 'Other Funding', type: 'multi_sig', network: 'mainnet', accessUserIds: ['user-2'], deviceIds: ['device-2'] },
    { id: 'operational-1', name: 'Operational', type: 'single_sig', network: 'testnet', accessUserIds: ['user-1'], deviceIds: [] },
    { id: 'operational-2', name: 'Wrong Network', type: 'single_sig', network: 'mainnet', accessUserIds: ['user-1'], deviceIds: [] },
  ],
  devices: [
    { id: 'device-1', label: 'Agent Signer', fingerprint: 'aabbccdd', type: 'ledger', userId: 'user-1', walletIds: ['funding-1'] },
    { id: 'device-2', label: 'Other Signer', fingerprint: 'eeff0011', type: 'ledger', userId: 'user-2', walletIds: ['funding-2'] },
  ],
};

function makeAgent(overrides: Partial<WalletAgentMetadata> = {}): WalletAgentMetadata {
  return {
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
    minOperationalBalanceSats: '25000',
    largeOperationalSpendSats: '75000',
    largeOperationalFeeSats: '5000',
    repeatedFailureThreshold: 3,
    repeatedFailureLookbackMinutes: 60,
    alertDedupeMinutes: 120,
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
    apiKeys: [activeApiKey],
    ...overrides,
  };
}

function validForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    ...DEFAULT_AGENT_FORM,
    name: 'Ops Agent',
    userId: 'user-1',
    fundingWalletId: 'funding-1',
    operationalWalletId: 'operational-1',
    signerDeviceId: 'device-1',
    ...overrides,
  };
}

describe('AgentManagement extracted branches', () => {
  it('renders header status and active-key empty/click branches', async () => {
    const user = userEvent.setup();
    const pausedAgent = makeAgent({ status: 'paused', pauseOnUnexpectedSpend: true });
    const revokedAgent = makeAgent({ status: 'active', revokedAt: '2026-04-17T00:00:00.000Z' });
    const onRevokeKey = vi.fn();

    const { rerender, container } = render(<AgentHeader agent={pausedAgent} />);

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Auto-pause on spend')).toBeInTheDocument();

    rerender(<AgentHeader agent={revokedAgent} />);
    expect(screen.getByText('Revoked')).toBeInTheDocument();

    const emptyKeys = render(<ActiveKeyList activeKeys={[]} agent={pausedAgent} onRevokeKey={onRevokeKey} />);
    expect(emptyKeys.container).toBeEmptyDOMElement();

    rerender(<ActiveKeyList activeKeys={[activeApiKey]} agent={pausedAgent} onRevokeKey={onRevokeKey} />);
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRevokeKey).toHaveBeenCalledWith(pausedAgent, 'key-1');
    expect(container).not.toBeEmptyDOMElement();
  });

  it('derives row view models across fallback and plural branches', () => {
    const fallbackAgent = makeAgent({
      user: undefined,
      fundingWallet: undefined,
      operationalWallet: undefined,
      signerDevice: undefined,
      apiKeys: undefined,
      maxFundingAmountSats: null,
      minOperationalBalanceSats: null,
      cooldownMinutes: null,
      alertDedupeMinutes: null,
    });
    const richAgent = makeAgent({ apiKeys: [activeApiKey, revokedApiKey] });

    expect(getActiveAgentKeys(fallbackAgent)).toEqual([]);
    expect(getActiveAgentKeys(richAgent)).toEqual([activeApiKey]);
    expect(isAgentRevoked(fallbackAgent)).toBe(false);
    expect(isAgentRevoked(makeAgent({ status: 'revoked' }))).toBe(true);
    expect(isAgentRevoked(makeAgent({ revokedAt: '2026-04-17T00:00:00.000Z' }))).toBe(true);

    expect(getAgentInfoBlocks(fallbackAgent)).toEqual([
      { label: 'User', value: 'user-1' },
      { label: 'Funding wallet', value: 'funding-1', helper: undefined },
      { label: 'Operational wallet', value: 'operational-1', helper: undefined },
      { label: 'Signer', value: 'device-1', helper: undefined },
    ]);
    expect(getAgentInfoBlocks(richAgent)[1].helper).toBe('Multisig');
    expect(getPolicySummary(fallbackAgent)).toContainEqual({ label: 'Cooldown', value: '0 min' });
    expect(getMonitoringSummary(fallbackAgent)).toContainEqual({ label: 'Dedupe', value: 'Default' });
    expect(getMonitoringSummary(richAgent)).toContainEqual({ label: 'Dedupe', value: '120 min' });
    expect(getTimelineSummary(fallbackAgent, 0)[0].label).toBe('0 active keys');
    expect(getTimelineSummary(richAgent, 1)[0].label).toBe('1 active key');
  });

  it('covers form state, options, and reconciliation helpers', () => {
    const filledForm = validForm();
    const fundingWallets = getFundingWallets(options.wallets, 'user-1');
    const selectedFundingWallet = getSelectedFundingWallet(options.wallets, 'funding-1');
    const operationalWallets = getOperationalWallets(options.wallets, filledForm, selectedFundingWallet);
    const signerDevices = getSignerDevices(options.devices, 'funding-1');

    expect(createInitialAgentForm()).toEqual(DEFAULT_AGENT_FORM);
    expect(createInitialAgentForm(makeAgent({
      cooldownMinutes: null,
      repeatedFailureThreshold: null,
      repeatedFailureLookbackMinutes: null,
      alertDedupeMinutes: null,
    }))).toMatchObject({
      cooldownMinutes: '',
      repeatedFailureThreshold: '',
      repeatedFailureLookbackMinutes: '',
      alertDedupeMinutes: '',
    });
    expect(fundingWallets.map(wallet => wallet.id)).toEqual(['funding-1']);
    expect(operationalWallets.map(wallet => wallet.id)).toEqual(['operational-1']);
    expect(getSignerDevices(options.devices, '').map(device => device.id)).toEqual(['device-1', 'device-2']);
    expect(signerDevices.map(device => device.id)).toEqual(['device-1']);
    expect(canSubmitAgentForm(filledForm)).toBe(true);
    expect(canSubmitAgentForm(validForm({ name: ' ' }))).toBe(false);
    expect(setAgentFormUser(filledForm, 'user-2')).toMatchObject({ userId: 'user-2', fundingWalletId: '', operationalWalletId: '', signerDeviceId: '' });
    expect(setAgentFormFundingWallet(filledForm, 'funding-2')).toMatchObject({ fundingWalletId: 'funding-2', operationalWalletId: '', signerDeviceId: '' });
    expect(reconcileAgentFormSelections(validForm({ fundingWalletId: 'missing' }), fundingWallets, operationalWallets, signerDevices)).toMatchObject({ fundingWalletId: '', operationalWalletId: '', signerDeviceId: '' });
    expect(reconcileAgentFormSelections(validForm({ operationalWalletId: 'missing' }), fundingWallets, operationalWallets, signerDevices)).toMatchObject({ operationalWalletId: '' });
    expect(reconcileAgentFormSelections(validForm({ signerDeviceId: 'missing' }), fundingWallets, operationalWallets, signerDevices)).toMatchObject({ signerDeviceId: '' });
    expect(reconcileAgentFormSelections(filledForm, fundingWallets, operationalWallets, signerDevices)).toBe(filledForm);
    expect(toUserOptions(options.users)).toContainEqual({ value: 'user-1', label: 'alice' });
    expect(toWalletOptions(fundingWallets)).toContainEqual({ value: 'funding-1', label: 'Funding · testnet' });
    expect(toDeviceOptions(signerDevices)).toContainEqual({ value: 'device-1', label: 'Agent Signer · aabbccdd' });
  });

  it('submits toggled form booleans from the extracted modal', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentFormModal
        title="Create Wallet Agent"
        options={options}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.selectOptions(selects[2], 'funding-1');
    await user.selectOptions(selects[3], 'operational-1');
    await user.selectOptions(selects[4], 'device-1');

    const switches = screen.getAllByRole('switch');
    await user.click(switches[1]);
    await user.click(switches[2]);
    await user.click(screen.getByRole('button', { name: 'Create Agent' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      notifyOnOperationalSpend: false,
      pauseOnUnexpectedSpend: true,
      requireHumanApproval: true,
    })));
  });
});
