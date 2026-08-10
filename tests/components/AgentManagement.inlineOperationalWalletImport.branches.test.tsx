import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineOperationalWalletImport } from '../../src/components/AgentManagement/AgentManagement/InlineOperationalWalletImport';
import * as walletsApi from '../../src/api/wallets';
import type { AgentOptionWallet } from '../../src/api/admin';

vi.mock('../../src/api/wallets', () => ({
  validateImport: vi.fn(),
  importWallet: vi.fn(),
  validateXpub: vi.fn(),
}));

const fundingWallet: AgentOptionWallet = {
  id: 'funding-1',
  name: 'Funding',
  type: 'multi_sig',
  network: 'testnet3',
  accessUserIds: ['user-1'],
  deviceIds: ['device-1'],
};

function renderImport(
  overrides: Partial<{
    selectedFundingWallet: AgentOptionWallet;
    disabled: boolean;
    onImported: (walletId: string) => Promise<void>;
  }> = {}
) {
  return render(
    <InlineOperationalWalletImport
      selectedFundingWallet={overrides.selectedFundingWallet ?? fundingWallet}
      disabled={overrides.disabled ?? false}
      onImported={overrides.onImported ?? vi.fn().mockResolvedValue(undefined)}
    />
  );
}

async function openImportPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import' }));
}

async function enterDescriptorAndImport(user: ReturnType<typeof userEvent.setup>, descriptor = 'wpkh(tpub-inline/0/*)') {
  await user.type(screen.getByPlaceholderText(/wpkh/), descriptor);
  await user.click(screen.getByRole('button', { name: 'Import and select' }));
}

describe('InlineOperationalWalletImport branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletsApi.validateImport).mockResolvedValue({
      valid: true,
      format: 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      devices: [],
    });
    vi.mocked(walletsApi.importWallet).mockResolvedValue({
      wallet: {
        id: 'operational-1',
        name: '',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        quorum: null,
        totalSigners: null,
      },
      devicesCreated: 0,
      devicesReused: 0,
      createdDeviceIds: [],
      reusedDeviceIds: [],
    });
  });

  it('closes the import panel without importing', async () => {
    const user = userEvent.setup();
    renderImport();

    await openImportPanel(user);
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));

    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
    expect(walletsApi.validateImport).not.toHaveBeenCalled();
  });

  it('describes imports when no funding wallet network is selected', async () => {
    const user = userEvent.setup();
    render(
      <InlineOperationalWalletImport
        disabled={false}
        onImported={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await openImportPanel(user);

    expect(screen.getByText(/on the funding wallet/)).toBeInTheDocument();
  });

  it('warns that raw keys lack verified origin evidence', async () => {
    const user = userEvent.setup();
    renderImport();

    await openImportPanel(user);
    await user.type(screen.getByPlaceholderText(/wpkh/), 'ypub-inline');

    expect(screen.getByText(/verified master fingerprint and account-path evidence/)).toBeInTheDocument();
  });

  it('shows the default validation error for invalid imports', async () => {
    const user = userEvent.setup();
    vi.mocked(walletsApi.validateImport).mockResolvedValueOnce({
      valid: false,
      format: 'unknown',
      walletType: 'unknown',
      network: 'testnet3',
      devices: [],
    } as any);
    renderImport();

    await openImportPanel(user);
    await enterDescriptorAndImport(user);

    expect(await screen.findByText('Invalid wallet import data')).toBeInTheDocument();
    expect(walletsApi.importWallet).not.toHaveBeenCalled();
  });

  it('rejects operational wallet imports from the wrong network', async () => {
    const user = userEvent.setup();
    vi.mocked(walletsApi.validateImport).mockResolvedValueOnce({
      valid: true,
      format: 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'mainnet',
      devices: [],
    });
    renderImport();

    await openImportPanel(user);
    await enterDescriptorAndImport(user);

    expect(
      await screen.findByText('Operational wallet network mainnet must match funding wallet network testnet3.')
    ).toBeInTheDocument();
    expect(walletsApi.importWallet).not.toHaveBeenCalled();
  });

  it('falls back to the default operational wallet name when no names are returned', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn().mockResolvedValue(undefined);
    renderImport({ onImported });

    await openImportPanel(user);
    await enterDescriptorAndImport(user);

    await waitFor(() => expect(onImported).toHaveBeenCalledWith('operational-1'));
    expect(walletsApi.importWallet).toHaveBeenCalledWith({
      data: 'wpkh(tpub-inline/0/*)',
      name: 'Agent operational wallet',
      network: 'testnet3',
    });
    expect(await screen.findByText('Imported and selected Agent operational wallet')).toBeInTheDocument();
  });

  it('shows API errors raised during import validation', async () => {
    const user = userEvent.setup();
    vi.mocked(walletsApi.validateImport).mockRejectedValueOnce(new Error('backend down'));
    renderImport();

    await openImportPanel(user);
    await enterDescriptorAndImport(user);

    expect(await screen.findByText('backend down')).toBeInTheDocument();
  });
});
