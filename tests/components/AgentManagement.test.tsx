import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AgentManagement } from '../../components/AgentManagement';
import * as adminApi from '../../src/api/admin';
import * as walletsApi from '../../src/api/wallets';

vi.mock('../../src/api/admin', () => ({
  getWalletAgents: vi.fn(),
  getWalletAgentOptions: vi.fn(),
  createWalletAgent: vi.fn(),
  updateWalletAgent: vi.fn(),
  revokeWalletAgent: vi.fn(),
  getAgentFundingOverrides: vi.fn(),
  createAgentFundingOverride: vi.fn(),
  revokeAgentFundingOverride: vi.fn(),
  createAgentApiKey: vi.fn(),
  revokeAgentApiKey: vi.fn(),
}));

vi.mock('../../src/api/wallets', () => ({
  validateImport: vi.fn(),
  importWallet: vi.fn(),
  validateXpub: vi.fn(),
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
  fundingWallet: {
    id: 'funding-1',
    name: 'Funding',
    type: 'multi_sig',
    network: 'testnet3',
  },
  operationalWallet: {
    id: 'operational-1',
    name: 'Operational',
    type: 'single_sig',
    network: 'testnet3',
  },
  signerDevice: {
    id: 'device-1',
    label: 'Agent Signer',
    fingerprint: 'aabbccdd',
  },
  apiKeys: [
    {
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
    },
  ],
} as any;

const options = {
  users: [
    {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      emailVerified: true,
      isAdmin: false,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    },
  ],
  wallets: [
    {
      id: 'funding-1',
      name: 'Funding',
      type: 'multi_sig',
      network: 'testnet3',
      accessUserIds: ['user-1'],
      deviceIds: ['device-1'],
    },
    {
      id: 'operational-1',
      name: 'Operational',
      type: 'single_sig',
      network: 'testnet3',
      accessUserIds: ['user-1'],
      deviceIds: [],
    },
  ],
  devices: [
    {
      id: 'device-1',
      label: 'Agent Signer',
      fingerprint: 'aabbccdd',
      type: 'ledger',
      userId: 'user-1',
      walletIds: ['funding-1'],
    },
  ],
};

const importedOperationalWallet = {
  id: 'operational-imported',
  name: 'Imported Ops',
  type: 'single_sig',
  network: 'testnet3',
  accessUserIds: ['user-1'],
  deviceIds: [],
};

const fundingOverride = {
  id: 'override-1',
  agentId: 'agent-1',
  fundingWalletId: 'funding-1',
  operationalWalletId: 'operational-1',
  createdByUserId: 'admin-1',
  reason: 'Emergency refill',
  maxAmountSats: '150000',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  usedAt: null,
  usedDraftId: null,
  revokedAt: null,
  createdAt: '2026-04-16T00:00:00.000Z',
  updatedAt: '2026-04-16T00:00:00.000Z',
} as any;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-route">{location.pathname}</div>;
}

function renderAgentManagement() {
  return render(
    <MemoryRouter initialEntries={['/admin/agents']}>
      <LocationProbe />
      <Routes>
        <Route path="/admin/agents" element={<AgentManagement />} />
        <Route path="/admin/agent-wallets" element={<div>Agent Wallets route</div>} />
        <Route path="/wallets/import" element={<div>Import Wallet route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AgentManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getWalletAgents).mockResolvedValue([agent]);
    vi.mocked(adminApi.getWalletAgentOptions).mockResolvedValue(options);
    vi.mocked(adminApi.createWalletAgent).mockResolvedValue(agent);
    vi.mocked(adminApi.updateWalletAgent).mockResolvedValue({
      ...agent,
      status: 'paused',
    });
    vi.mocked(adminApi.revokeWalletAgent).mockResolvedValue({
      ...agent,
      status: 'revoked',
      revokedAt: '2026-04-16T01:00:00.000Z',
    });
    vi.mocked(adminApi.getAgentFundingOverrides).mockResolvedValue([fundingOverride]);
    vi.mocked(adminApi.createAgentFundingOverride).mockResolvedValue(fundingOverride);
    vi.mocked(adminApi.revokeAgentFundingOverride).mockResolvedValue({
      ...fundingOverride,
      status: 'revoked',
      revokedAt: '2026-04-16T01:00:00.000Z',
    });
    vi.mocked(adminApi.createAgentApiKey).mockResolvedValue({
      ...agent.apiKeys[0],
      id: 'key-2',
      name: 'New Runtime',
      apiKey: 'agt_'.padEnd(68, 'a'),
    });
    vi.mocked(adminApi.revokeAgentApiKey).mockResolvedValue({
      ...agent.apiKeys[0],
      revokedAt: '2026-04-16T01:00:00.000Z',
    });
    vi.mocked(walletsApi.validateImport).mockResolvedValue({
      valid: true,
      format: 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      devices: [],
      suggestedName: 'Imported Ops',
    });
    vi.mocked(walletsApi.importWallet).mockResolvedValue({
      wallet: {
        id: importedOperationalWallet.id,
        name: importedOperationalWallet.name,
        type: importedOperationalWallet.type,
        scriptType: 'native_segwit',
        network: importedOperationalWallet.network,
        quorum: null,
        totalSigners: null,
        descriptor: 'wpkh([abcd1234/84h/1h/0h]tpub.../0/*)',
      },
      devicesCreated: 0,
      devicesReused: 0,
      createdDeviceIds: [],
      reusedDeviceIds: [],
    });
    vi.mocked(walletsApi.validateXpub).mockResolvedValue({
      valid: true,
      descriptor: 'wpkh([00000000/84h/1h/0h]tpub-inline/0/*)',
      scriptType: 'native_segwit',
      firstAddress: 'tb1qagent',
      xpub: 'tpub-inline',
      fingerprint: '00000000',
      accountPath: "84'/1'/0'",
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it('loads and renders wallet agent summary, policy, and key metadata', async () => {
    renderAgentManagement();

    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(screen.getByText('Active agents')).toBeInTheDocument();
    expect(screen.getByText('Funding')).toBeInTheDocument();
    expect(screen.getByText('Operational')).toBeInTheDocument();
    expect(screen.getByText(/Request cap: 100,000 sats/)).toBeInTheDocument();
    expect(screen.getByText(/Refill alert: 25,000 sats/)).toBeInTheDocument();
    expect(screen.getByText(/Large spend: 75,000 sats/)).toBeInTheDocument();
    expect(screen.getByText(/Runtime/)).toBeInTheDocument();
  });

  it('renders empty and recoverable load-error states', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getWalletAgents).mockRejectedValueOnce(new Error('network down'));

    const { unmount } = renderAgentManagement();

    expect(await screen.findByText('network down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(await screen.findByText('Treasury Agent')).toBeInTheDocument();
    expect(adminApi.getWalletAgents).toHaveBeenCalledTimes(2);
    unmount();

    vi.mocked(adminApi.getWalletAgents).mockResolvedValueOnce([]);
    renderAgentManagement();

    expect(await screen.findByText('No wallet agents registered.')).toBeInTheDocument();
  });

  it('creates an agent using filtered wallet and signer options', async () => {
    const user = userEvent.setup();
    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Add Agent Wallet/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');

    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('link', { name: 'Open full import page' })).toHaveAttribute(
      'href',
      '/wallets/import'
    );
    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'funding-1');
    await user.selectOptions(selects[1], 'operational-1');
    await user.selectOptions(selects[2], 'device-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByPlaceholderText('0'), '15');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText('Refill threshold'), '20000');
    await user.type(screen.getByLabelText('Large spend alert'), '90000');
    await user.type(screen.getByLabelText('Large fee alert'), '4000');
    await user.type(screen.getByLabelText('Rejected attempt alert count'), '4');
    await user.type(screen.getByLabelText('Failure lookback minutes'), '45');
    await user.type(screen.getByLabelText('Alert dedupe minutes'), '90');

    await user.click(screen.getAllByRole('button', { name: 'Add Agent Wallet' }).at(-1)!);

    await waitFor(() =>
      expect(adminApi.createWalletAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ops Agent',
          userId: 'user-1',
          fundingWalletId: 'funding-1',
          operationalWalletId: 'operational-1',
          signerDeviceId: 'device-1',
          cooldownMinutes: 15,
          minOperationalBalanceSats: '20000',
          largeOperationalSpendSats: '90000',
          largeOperationalFeeSats: '4000',
          repeatedFailureThreshold: 4,
          repeatedFailureLookbackMinutes: 45,
          alertDedupeMinutes: 90,
          requireHumanApproval: true,
        })
      )
    );
    expect(await screen.findByText('Agent Wallets route')).toBeInTheDocument();
    expect(screen.getByTestId('current-route')).toHaveTextContent('/admin/agent-wallets');
  });

  it('imports a watch-only operational wallet inline and creates with the imported wallet', async () => {
    const user = userEvent.setup();
    const initialOptions = {
      ...options,
      wallets: [options.wallets[0]],
    };
    const optionsWithImported = {
      ...options,
      wallets: [options.wallets[0], importedOperationalWallet],
    };
    vi.mocked(adminApi.getWalletAgentOptions)
      .mockResolvedValue(optionsWithImported)
      .mockResolvedValueOnce(initialOptions)
      .mockResolvedValueOnce(optionsWithImported);

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Add Agent Wallet/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');
    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'funding-1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.type(screen.getByPlaceholderText('Agent operational wallet'), 'Imported Ops');
    await user.type(screen.getByPlaceholderText(/wpkh/), 'wpkh(tpub-inline/0/*)');
    await user.click(screen.getByRole('button', { name: 'Import and select' }));

    await waitFor(() => expect(walletsApi.importWallet).toHaveBeenCalled());
    expect(walletsApi.validateImport).toHaveBeenCalledWith({
      descriptor: 'wpkh(tpub-inline/0/*)',
    });
    expect(walletsApi.importWallet).toHaveBeenCalledWith({
      data: 'wpkh(tpub-inline/0/*)',
      name: 'Imported Ops',
      network: 'testnet3',
    });

    selects = screen.getAllByRole('combobox');
    expect((selects[1] as HTMLSelectElement).value).toBe('operational-imported');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getAllByRole('button', { name: 'Add Agent Wallet' }).at(-1)!);

    await waitFor(() =>
      expect(adminApi.createWalletAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          fundingWalletId: 'funding-1',
          operationalWalletId: 'operational-imported',
        })
      )
    );
  });

  it('imports a raw extended public key by validating it into a descriptor first', async () => {
    const user = userEvent.setup();
    const descriptor = 'tr([00000000/86h/1h/0h]tpub-inline/0/*)';
    const initialOptions = {
      ...options,
      wallets: [options.wallets[0]],
    };
    const optionsWithImported = {
      ...options,
      wallets: [options.wallets[0], importedOperationalWallet],
    };
    vi.mocked(adminApi.getWalletAgentOptions)
      .mockResolvedValue(optionsWithImported)
      .mockResolvedValueOnce(initialOptions)
      .mockResolvedValueOnce(optionsWithImported);
    vi.mocked(walletsApi.validateXpub).mockResolvedValueOnce({
      valid: true,
      descriptor,
      scriptType: 'taproot',
      firstAddress: 'tb1pagent',
      xpub: 'tpub-inline',
      fingerprint: '00000000',
      accountPath: "86'/1'/0'",
    });

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Add Agent Wallet/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');
    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'funding-1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.type(screen.getByPlaceholderText('Agent operational wallet'), 'Imported Ops');
    await user.type(screen.getByPlaceholderText(/xpub/), 'tpub-inline');
    await user.selectOptions(screen.getByLabelText('Extended public key type'), 'taproot');
    await user.click(screen.getByRole('button', { name: 'Import and select' }));

    await waitFor(() => expect(walletsApi.validateXpub).toHaveBeenCalled());
    expect(walletsApi.validateXpub).toHaveBeenCalledWith(
      expect.objectContaining({
        xpub: 'tpub-inline',
        scriptType: 'taproot',
        network: 'testnet3',
        fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
      })
    );
    expect(walletsApi.validateImport).toHaveBeenCalledWith({ descriptor });
    expect(walletsApi.importWallet).toHaveBeenCalledWith({
      data: descriptor,
      name: 'Imported Ops',
      network: 'testnet3',
    });
  });

  it('rejects raw multisig extended keys in the operational wallet import', async () => {
    const user = userEvent.setup();
    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Add Agent Wallet/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');
    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'funding-1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.type(screen.getByPlaceholderText(/xpub/), 'Zpub-agent');
    await user.click(screen.getByRole('button', { name: 'Import and select' }));

    expect(
      await screen.findByText(
        'Operational agent wallets must use a single-sig xpub/ypub/zpub. Use the multisig wallet as the funding wallet instead.'
      )
    ).toBeInTheDocument();
    expect(walletsApi.validateXpub).not.toHaveBeenCalled();
    expect(walletsApi.validateImport).not.toHaveBeenCalled();
    expect(walletsApi.importWallet).not.toHaveBeenCalled();
  });

  it('rejects inline operational imports that are not single-sig', async () => {
    const user = userEvent.setup();
    vi.mocked(walletsApi.validateImport).mockResolvedValueOnce({
      valid: true,
      format: 'descriptor',
      walletType: 'multi_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      quorum: 2,
      totalSigners: 3,
      devices: [],
    });

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: /Add Agent Wallet/i }));
    await user.type(screen.getByPlaceholderText('Treasury funding agent'), 'Ops Agent');
    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'user-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'funding-1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.type(screen.getByPlaceholderText(/wpkh/), 'wsh(sortedmulti(...))');
    await user.click(screen.getByRole('button', { name: 'Import and select' }));

    expect(
      await screen.findByText('Operational agent wallets must be single-sig watch-only wallets.')
    ).toBeInTheDocument();
    expect(walletsApi.importWallet).not.toHaveBeenCalled();
  });

  it('updates agent policy and issues a one-time key', async () => {
    const user = userEvent.setup();
    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], 'paused');
    const capInput = screen.getByDisplayValue('100000');
    await user.clear(capInput);
    await user.type(capInput, '250000');
    const refillInput = screen.getByDisplayValue('25000');
    await user.clear(refillInput);
    await user.type(refillInput, '30000');
    await user.click(screen.getByRole('button', { name: 'Save Agent' }));

    await waitFor(() =>
      expect(adminApi.updateWalletAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          status: 'paused',
          maxFundingAmountSats: '250000',
          minOperationalBalanceSats: '30000',
          largeOperationalSpendSats: '75000',
          largeOperationalFeeSats: '5000',
          repeatedFailureThreshold: 3,
          repeatedFailureLookbackMinutes: 60,
          alertDedupeMinutes: 120,
        })
      )
    );

    await user.click(screen.getByRole('button', { name: 'Issue Key' }));
    await user.type(screen.getByPlaceholderText('Agent runtime key'), 'New Runtime');
    await user.click(screen.getByRole('button', { name: 'Create Key' }));

    await waitFor(() =>
      expect(adminApi.createAgentApiKey).toHaveBeenCalledWith('agent-1', {
        name: 'New Runtime',
        allowedActions: ['create_funding_draft'],
      })
    );
    expect(await screen.findByDisplayValue(/^agt_/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('creates and revokes owner funding overrides', async () => {
    const user = userEvent.setup();
    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Overrides' }));

    expect(await screen.findByText('Emergency refill')).toBeInTheDocument();
    expect(adminApi.getAgentFundingOverrides).toHaveBeenCalledWith('agent-1');

    await user.type(screen.getByPlaceholderText('250000'), '250000');
    await user.type(screen.getByLabelText('Expires at'), '2026-04-18T09:30');
    await user.type(screen.getByPlaceholderText('Emergency refill'), '  Higher refill  ');
    await user.click(screen.getByRole('button', { name: 'Create Override' }));

    await waitFor(() =>
      expect(adminApi.createAgentFundingOverride).toHaveBeenCalledWith('agent-1', {
        maxAmountSats: '250000',
        expiresAt: expect.any(String),
        reason: 'Higher refill',
      })
    );

    await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);
    await waitFor(() => expect(adminApi.revokeAgentFundingOverride).toHaveBeenCalledWith('agent-1', 'override-1'));
  });

  it('renders owner funding override history statuses', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getAgentFundingOverrides).mockResolvedValueOnce([
      fundingOverride,
      {
        ...fundingOverride,
        id: 'override-used',
        reason: 'Used refill',
        status: 'used',
        usedAt: '2026-04-16T02:00:00.000Z',
        usedDraftId: 'draft-1',
      },
      {
        ...fundingOverride,
        id: 'override-revoked',
        reason: 'Revoked refill',
        status: 'revoked',
        revokedAt: '2026-04-16T03:00:00.000Z',
      },
      {
        ...fundingOverride,
        id: 'override-expired',
        reason: 'Expired refill',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Overrides' }));

    expect(await screen.findByText('Used refill')).toBeInTheDocument();
    expect(screen.getByText('Revoked refill')).toBeInTheDocument();
    expect(screen.getByText('Expired refill')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('surfaces owner funding override create and revoke failures', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.createAgentFundingOverride).mockRejectedValueOnce(new Error('create failed'));
    vi.mocked(adminApi.revokeAgentFundingOverride).mockRejectedValueOnce(new Error('revoke failed'));

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Overrides' }));

    await user.type(await screen.findByPlaceholderText('250000'), '250000');
    await user.type(screen.getByLabelText('Expires at'), '2026-04-18T09:30');
    await user.type(screen.getByPlaceholderText('Emergency refill'), 'Higher refill');
    await user.click(screen.getByRole('button', { name: 'Create Override' }));
    expect(await screen.findByText('create failed')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);
    expect(await screen.findByText('revoke failed')).toBeInTheDocument();
  });

  it('does not revoke owner funding overrides when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    );

    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByRole('button', { name: 'Overrides' }));
    await screen.findByText('Emergency refill');
    await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);

    expect(adminApi.revokeAgentFundingOverride).not.toHaveBeenCalled();
  });

  it('reports when a one-time key cannot be copied', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    renderAgentManagement();

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
    renderAgentManagement();

    await screen.findByText('Treasury Agent');
    await user.click(screen.getByText('Revoke', { selector: 'button.text-rose-500' }));
    await waitFor(() => expect(adminApi.revokeAgentApiKey).toHaveBeenCalledWith('agent-1', 'key-1'));

    await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);
    await waitFor(() => expect(adminApi.revokeWalletAgent).toHaveBeenCalledWith('agent-1'));
  });
});
