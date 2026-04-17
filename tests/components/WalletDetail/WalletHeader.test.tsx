import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { WalletHeader } from '../../../components/WalletDetail/WalletHeader';
import { WalletType } from '../../../types';

vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <div data-testid="amount">{sats}</div>,
}));

const baseWallet = {
  id: 'wallet-1',
  name: 'Primary Wallet',
  type: WalletType.SINGLE_SIG,
  network: 'mainnet',
  balance: 123_456,
  quorum: { m: 1, n: 1 },
  totalSigners: 1,
  userRole: 'owner',
  isShared: false,
  lastSyncStatus: null,
  lastSyncedAt: null,
  syncInProgress: false,
} as any;

const renderHeader = (
  walletOverrides: Record<string, unknown> = {},
  propOverrides: Record<string, unknown> = {}
) => {
  const handlers = {
    onReceive: vi.fn(),
    onSend: vi.fn(),
    onSync: vi.fn(),
    onFullResync: vi.fn(),
    onExport: vi.fn(),
  };

  const view = render(
    <WalletHeader
      wallet={{ ...baseWallet, ...walletOverrides }}
      syncing={false}
      syncRetryInfo={null}
      {...handlers}
      {...propOverrides}
    />
  );

  return { ...view, handlers };
};

describe('WalletHeader', () => {
  it('renders single-sig owner wallet actions and handles button clicks', () => {
    const { handlers } = renderHeader();

    expect(screen.getByText('Single Sig')).toBeInTheDocument();
    expect(screen.queryByText('mainnet')).not.toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Receive/i }));
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    fireEvent.click(screen.getByTitle('Sync wallet'));
    fireEvent.click(screen.getByTitle('Full resync (clears and re-syncs all transactions)'));
    fireEvent.click(screen.getByTitle('Export wallet'));

    expect(handlers.onReceive).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
    expect(handlers.onFullResync).toHaveBeenCalledTimes(1);
    expect(handlers.onExport).toHaveBeenCalledTimes(1);
  });

  it('renders multisig retrying state with signer/shared badges', () => {
    renderHeader(
      {
        type: WalletType.MULTI_SIG,
        quorum: { m: 2, n: 3 },
        totalSigners: 3,
        network: 'signet',
        userRole: 'signer',
        isShared: true,
        lastSyncStatus: 'retrying',
      },
      {
        syncRetryInfo: {
          retryCount: 2,
          maxRetries: 5,
          error: 'temporary error',
        },
      }
    );

    expect(screen.getByText('2/3 Multisig')).toBeInTheDocument();
    expect(screen.getByText('signet')).toBeInTheDocument();
    expect(screen.getByText('Retrying 2/5')).toBeInTheDocument();
    expect(screen.getByText('Signer')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });

  it('renders linked agent wallet role badges', () => {
    renderHeader({}, {
      agentLinks: [
        {
          agentId: 'agent-1',
          agentName: 'Treasury Agent',
          role: 'funding',
          linkedWalletName: 'Operational',
          status: 'active',
        },
        {
          agentId: 'agent-2',
          agentName: 'Ops Agent',
          role: 'operational',
          linkedWalletName: 'Funding',
          status: 'paused',
        },
      ],
    });

    expect(screen.getByText('Agent Funding Wallet')).toBeInTheDocument();
    expect(screen.getByText('Agent Operational Wallet')).toBeInTheDocument();
    expect(screen.getByText('Agent Funding Wallet').closest('span')).toHaveAttribute(
      'title',
      'Treasury Agent links this wallet to Operational'
    );
  });

  it('uses retrying defaults when status is retrying without retry metadata', () => {
    renderHeader({
      lastSyncStatus: 'retrying',
      network: 'testnet',
    });

    const badge = screen.getByText('Retrying 1/3').closest('span');
    expect(screen.getByText('testnet')).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Sync failed, retrying...');
  });

  it('shows syncing badge and disables sync controls while syncing', () => {
    renderHeader({}, { syncing: true });

    expect(screen.getByText('Syncing')).toBeInTheDocument();
    expect(screen.getByTitle('Sync wallet')).toBeDisabled();
    expect(screen.getByTitle('Full resync (clears and re-syncs all transactions)')).toBeDisabled();
  });

  it('renders success status when sync completed', () => {
    renderHeader({
      lastSyncStatus: 'success',
      lastSyncedAt: '2026-02-02T00:00:00.000Z',
    });

    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('renders success status without last-synced timestamp and supports custom network badge', () => {
    renderHeader({
      lastSyncStatus: 'success',
      lastSyncedAt: null,
      network: 'regtest',
    });

    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('regtest')).toBeInTheDocument();
  });

  it('renders failed and cached sync statuses', () => {
    const { rerender } = renderHeader({ lastSyncStatus: 'failed' });
    expect(screen.getByText('Failed')).toBeInTheDocument();

    rerender(
      <WalletHeader
        wallet={{
          ...baseWallet,
          lastSyncStatus: null,
          lastSyncedAt: '2026-02-01T00:00:00.000Z',
        }}
        syncing={false}
        syncRetryInfo={null}
        onReceive={vi.fn()}
        onSend={vi.fn()}
        onSync={vi.fn()}
        onFullResync={vi.fn()}
        onExport={vi.fn()}
      />
    );

    expect(screen.getByText('Cached')).toBeInTheDocument();
  });

  it('hides send action for viewer role', () => {
    renderHeader({ userRole: 'viewer' });

    expect(screen.getByText('Viewer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send/i })).not.toBeInTheDocument();
  });

  it('shows initial sync banner for first sync attempts', () => {
    renderHeader({ lastSyncedAt: null, syncInProgress: true });

    expect(screen.getByText('Initial sync in progress')).toBeInTheDocument();
    expect(screen.queryByText('Wallet not synced')).not.toBeInTheDocument();
  });

  it('shows never-synced banner and triggers sync now action', () => {
    const { handlers } = renderHeader({
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncInProgress: false,
    });

    expect(screen.getByText('Wallet not synced')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sync Now/i }));
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
  });
});
