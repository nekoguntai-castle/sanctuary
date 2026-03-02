import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletGridView } from '../../../components/WalletList/WalletGridView';

const mockNavigate = vi.fn();
const mockFormat = vi.fn((value: number) => `BTC ${value}`);
const mockFormatFiat = vi.fn((value: number) => `$${value}`);
let mockShowFiat = true;

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getWalletIcon: () => <span data-testid="wallet-icon" />,
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: mockFormat,
    formatFiat: mockFormatFiat,
    showFiat: mockShowFiat,
  }),
}));

describe('WalletGridView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowFiat = true;
    mockFormatFiat.mockImplementation((value: number) => `$${value}`);
  });

  it('renders card info and navigates to wallet details on click', () => {
    render(
      <WalletGridView
        wallets={[
          {
            id: 'w-single',
            name: 'Primary Wallet',
            type: 'single_sig',
            balance: 1000,
            scriptType: 'native_segwit',
            deviceCount: 1,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
        ]}
        pendingByWallet={{}}
      />
    );

    expect(screen.getByText('Primary Wallet')).toBeInTheDocument();
    expect(screen.getByText('Single Sig')).toBeInTheDocument();
    expect(screen.getByText('native segwit')).toBeInTheDocument();
    expect(screen.getByText('1 device')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Primary Wallet'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w-single');
  });

  it('renders shared multisig wallet pending indicators and fiat net sign handling', () => {
    render(
      <WalletGridView
        wallets={[
          {
            id: 'w-multi',
            name: 'Shared Vault',
            type: 'multi_sig',
            balance: 5000,
            scriptType: 'taproot',
            deviceCount: 3,
            quorum: 2,
            totalSigners: 3,
            isShared: true,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
          {
            id: 'w-outgoing',
            name: 'Outgoing Wallet',
            type: 'single_sig',
            balance: 4000,
            scriptType: 'legacy',
            deviceCount: 2,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
        ]}
        pendingByWallet={{
          'w-multi': { net: 250, count: 2, hasIncoming: true, hasOutgoing: false },
          'w-outgoing': { net: -150, count: 1, hasIncoming: false, hasOutgoing: true },
        }}
      />
    );

    expect(screen.getByText('Multisig')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.getByTitle('Pending received')).toBeInTheDocument();
    expect(screen.getByTitle('Pending sent')).toBeInTheDocument();
    expect(screen.getByText(/\(\+BTC 250\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(BTC -150\)/)).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText(/\(\+\$250\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(\$-150\)/)).toBeInTheDocument();
  });

  it('renders sync status variants and fallback script/device text', () => {
    render(
      <WalletGridView
        wallets={[
          {
            id: 'syncing',
            name: 'Syncing Wallet',
            type: 'single_sig',
            balance: 1,
            scriptType: undefined,
            deviceCount: undefined,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: true,
          } as any,
          {
            id: 'synced',
            name: 'Synced Wallet',
            type: 'single_sig',
            balance: 1,
            scriptType: 'nested_segwit',
            deviceCount: 1,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
          {
            id: 'failed',
            name: 'Failed Wallet',
            type: 'single_sig',
            balance: 1,
            scriptType: 'legacy',
            deviceCount: 2,
            isShared: false,
            lastSyncStatus: 'failed',
            syncInProgress: false,
          } as any,
          {
            id: 'retrying',
            name: 'Retrying Wallet',
            type: 'single_sig',
            balance: 1,
            scriptType: 'legacy',
            deviceCount: 2,
            isShared: false,
            lastSyncStatus: 'retrying',
            syncInProgress: false,
          } as any,
          {
            id: 'pending',
            name: 'Pending Wallet',
            type: 'single_sig',
            balance: 1,
            scriptType: 'legacy',
            deviceCount: 2,
            isShared: false,
            lastSyncStatus: undefined,
            syncInProgress: false,
          } as any,
        ]}
        pendingByWallet={{}}
      />
    );

    expect(screen.getByTitle('Syncing')).toBeInTheDocument();
    expect(screen.getByTitle('Synced')).toBeInTheDocument();
    expect(screen.getByTitle('Sync failed')).toBeInTheDocument();
    expect(screen.getByTitle('Retrying')).toBeInTheDocument();
    expect(screen.getByTitle('Pending sync')).toBeInTheDocument();
    expect(screen.getByText('0 devices')).toBeInTheDocument();
  });

  it('hides fiat values when disabled and when formatter returns empty output', () => {
    mockShowFiat = false;
    const { rerender } = render(
      <WalletGridView
        wallets={[
          {
            id: 'w-fiat-hidden',
            name: 'No Fiat Wallet',
            type: 'single_sig',
            balance: 2000,
            scriptType: 'legacy',
            deviceCount: 1,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
        ]}
        pendingByWallet={{}}
      />
    );

    expect(screen.queryByText('$2000')).not.toBeInTheDocument();

    mockShowFiat = true;
    mockFormatFiat.mockImplementation(() => '');
    rerender(
      <WalletGridView
        wallets={[
          {
            id: 'w-fiat-empty',
            name: 'Empty Fiat Wallet',
            type: 'single_sig',
            balance: 3000,
            scriptType: 'legacy',
            deviceCount: 1,
            isShared: false,
            lastSyncStatus: 'success',
            syncInProgress: false,
          } as any,
        ]}
        pendingByWallet={{}}
      />
    );

    expect(screen.queryByText('$3000')).not.toBeInTheDocument();
  });
});
