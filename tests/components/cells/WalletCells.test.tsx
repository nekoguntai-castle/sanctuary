import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { createWalletCellRenderers,type WalletWithPending } from '../../../src/components/cells/WalletCells';
import type { TableColumnConfig } from '../../../src/types';

vi.mock('lucide-react', () => ({
  RefreshCw: () => <span data-testid="refresh-icon" />,
  CheckCircle: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  // walletSyncPresentation's default glyph set; the cell maps tones to its own
  // outline icons but the module is still imported.
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
  Check: () => <span data-testid="check-plain-icon" />,
  Users: () => <span data-testid="users-icon" />,
  ArrowDownLeft: () => <span data-testid="incoming-icon" />,
  ArrowUpRight: () => <span data-testid="outgoing-icon" />,
}));

vi.mock('../../../src/components/ui/CustomIcons', () => ({
  getWalletIcon: (_type: string, _className?: string) => <span data-testid="wallet-icon" />,
}));

const baseColumn: TableColumnConfig = { id: 'name', label: 'Name' };

const baseWallet: WalletWithPending = {
  id: 'wallet-1',
  name: 'Primary Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  deviceCount: 2,
  balance: 100000,
  syncInProgress: false,
  lastSyncStatus: 'success',
  isShared: false,
  quorum: 2,
  totalSigners: 3,
};

describe('WalletCells', () => {
  it('uses the shared lifecycle-clock reading for an expired table lease', () => {
    const expiresAt = Date.parse('2026-08-27T04:30:01.000Z');
    const wallet = {
      ...baseWallet,
      syncInProgress: true,
      lastSyncStatus: null,
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      syncExecutionOwner: 'worker' as const,
      incrementalSyncClaimedAt: '2026-08-27T04:30:00.000Z',
      incrementalSyncLeaseExpiresAt: '2026-08-27T04:30:01.000Z',
    };
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    }, expiresAt + 1);

    render(<renderers.sync item={wallet} column={baseColumn} />);

    expect(screen.getByRole('button', { name: 'Sync status: Attention' })).toBeInTheDocument();
  });

  it('renders name cell with icon and script type', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(<renderers.name item={{ ...baseWallet, type: 'multi_sig' }} column={baseColumn} />);
    expect(screen.getByText('Primary Wallet')).toBeInTheDocument();
    expect(screen.getByText('native segwit')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-icon')).toBeInTheDocument();
  });

  it('renders name cell for single-sig wallets', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(<renderers.name item={{ ...baseWallet, type: 'single_sig' }} column={baseColumn} />);
    expect(screen.getByText('Primary Wallet')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-icon')).toBeInTheDocument();
  });

  it('renders "unknown" when wallet.scriptType is undefined', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.name
        item={{ ...baseWallet, scriptType: undefined as any }}
        column={baseColumn}
      />
    );
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('renders type cell with multisig badge and shared indicator', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.type
        item={{ ...baseWallet, type: 'multi_sig', isShared: true, quorum: 2, totalSigners: 3 }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.getByTestId('users-icon')).toBeInTheDocument();
  });

  it('renders type cell single-sig branch without shared badge', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.type
        item={{ ...baseWallet, type: 'single_sig', isShared: false }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Single Sig')).toBeInTheDocument();
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });

  it('renders devices count correctly', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(<renderers.devices item={baseWallet} column={baseColumn} />);
    expect(screen.getByText('2 devices')).toBeInTheDocument();

    rerender(<renderers.devices item={{ ...baseWallet, deviceCount: 1 }} column={baseColumn} />);
    expect(screen.getByText('1 device')).toBeInTheDocument();
  });

  it('renders sync state icons', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(
      <renderers.sync item={{ ...baseWallet, syncInProgress: true }} column={baseColumn} />
    );
    expect(screen.getByText('Syncing')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, syncInProgress: false, lastSyncStatus: 'failed' }} column={baseColumn} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: 'retrying' }} column={baseColumn} />);
    expect(screen.getByText('Retrying')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: 'partial' }} column={baseColumn} />);
    expect(screen.getByText('Partial')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: undefined }} column={baseColumn} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('distinguishes a full resync from a wallet that was never queued', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.sync
        item={{ ...baseWallet, lastSyncStatus: 'resyncing', syncInProgress: false }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Resyncing')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('exposes the failure reason on the failed state', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.sync
        item={{
          ...baseWallet,
          lastSyncStatus: 'failed',
          lastSyncError: 'connect ECONNREFUSED 127.0.0.1:50002',
        }}
        column={baseColumn}
      />
    );

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'connect ECONNREFUSED 127.0.0.1:50002'
    );
  });

  it('renders synced state for successful sync status', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(<renderers.sync item={{ ...baseWallet, lastSyncStatus: 'success' }} column={baseColumn} />);
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('renders pending icons when pending data exists', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(
      <renderers.pending item={baseWallet} column={baseColumn} />
    );
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(
      <renderers.pending
        item={{
          ...baseWallet,
          pendingData: { net: 1000, count: 2, hasIncoming: true, hasOutgoing: true },
        }}
        column={baseColumn}
      />
    );
    expect(screen.getByTestId('incoming-icon')).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-icon')).toBeInTheDocument();
  });

  it('renders balance with pending net and fiat', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: (sats) => `$${(sats / 100000).toFixed(2)}`,
      showFiat: true,
    });

    render(
      <renderers.balance
        item={{
          ...baseWallet,
          pendingData: { net: -5000, count: 1, hasIncoming: false, hasOutgoing: true },
        }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('100000 sats')).toBeInTheDocument();
    expect(screen.getByText('(-5000 sats)')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('($-0.05)')).toBeInTheDocument();
  });

  it('renders positive pending net with plus sign for BTC and fiat', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: (sats) => `$${(sats / 100000).toFixed(2)}`,
      showFiat: true,
    });

    render(
      <renderers.balance
        item={{
          ...baseWallet,
          pendingData: { net: 5000, count: 1, hasIncoming: true, hasOutgoing: false },
        }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('(+5000 sats)')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('(+$0.05)')).toBeInTheDocument();
  });

  it('omits balance deltas when pending data is absent or zero', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: (sats) => `$${(sats / 100000).toFixed(2)}`,
      showFiat: true,
    });

    const { rerender } = render(
      <renderers.balance item={baseWallet} column={baseColumn} />
    );

    expect(screen.getByText('100000 sats')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.queryByText('(+0 sats)')).not.toBeInTheDocument();
    expect(screen.queryByText('(+$0.00)')).not.toBeInTheDocument();

    rerender(
      <renderers.balance
        item={{
          ...baseWallet,
          pendingData: { net: 0, count: 1, hasIncoming: false, hasOutgoing: false },
        }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('100000 sats')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.queryByText('(0 sats)')).not.toBeInTheDocument();
    expect(screen.queryByText('($0.00)')).not.toBeInTheDocument();
  });
});
