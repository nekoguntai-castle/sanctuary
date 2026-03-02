import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { WalletList } from '../../components/WalletList/WalletList';
import * as CurrencyContext from '../../contexts/CurrencyContext';
import * as UserContext from '../../contexts/UserContext';
import * as useWalletsHook from '../../hooks/queries/useWallets';
import {
  DEFAULT_WALLET_COLUMN_ORDER,
  DEFAULT_WALLET_VISIBLE_COLUMNS,
} from '../../components/columns/walletColumns';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../hooks/queries/useWallets', () => ({
  useWallets: vi.fn(),
  useInvalidateAllWallets: vi.fn(),
  usePendingTransactions: vi.fn(),
}));

vi.mock('../../components/NetworkTabs', () => ({
  NetworkTabs: ({ selectedNetwork, onNetworkChange }: any) => (
    <div data-testid="network-tabs">
      <span data-testid="selected-network">{selectedNetwork}</span>
      <button onClick={() => onNetworkChange('mainnet')}>to-mainnet</button>
      <button onClick={() => onNetworkChange('testnet')}>to-testnet</button>
      <button onClick={() => onNetworkChange('signet')}>to-signet</button>
    </div>
  ),
}));

vi.mock('../../components/NetworkSyncActions', () => ({
  NetworkSyncActions: ({ onSyncStarted }: any) => (
    <button data-testid="sync-start" onClick={onSyncStarted}>
      sync-start
    </button>
  ),
}));

vi.mock('../../components/ui/ConfigurableTable', () => ({
  ConfigurableTable: ({ data, sortBy, sortOrder, onSort, onRowClick, keyExtractor }: any) => (
    <div data-testid="configurable-table">
      <span data-testid="table-sort">{`${sortBy}-${sortOrder}`}</span>
      <span data-testid="table-order">{data.map((w: any) => w.id).join(',')}</span>
      <span data-testid="table-keys">{data.map((w: any) => keyExtractor(w)).join(',')}</span>
      <button onClick={() => onSort('name')}>sort-name</button>
      <button onClick={() => onSort('type')}>sort-type</button>
      <button onClick={() => onRowClick(data[0])}>row-click</button>
    </div>
  ),
}));

vi.mock('../../components/ui/ColumnConfigButton', () => ({
  ColumnConfigButton: ({
    onOrderChange,
    onVisibilityChange,
    onReset,
  }: {
    onOrderChange: (order: string[]) => void;
    onVisibilityChange: (columnId: string, visible: boolean) => void;
    onReset: () => void;
  }) => (
    <div data-testid="column-config">
      <button onClick={() => onOrderChange(['balance', 'name'])}>order-change</button>
      <button onClick={() => onVisibilityChange('network', false)}>visibility-hide</button>
      <button onClick={() => onVisibilityChange('custom-col', true)}>visibility-show</button>
      <button onClick={onReset}>reset-columns</button>
    </div>
  ),
}));

vi.mock('../../components/WalletList/BalanceChart', () => ({
  BalanceChart: ({ totalBalance, walletCount, selectedNetwork }: any) => (
    <div data-testid="balance-chart">
      {`${selectedNetwork}:${walletCount}:${totalBalance}`}
    </div>
  ),
}));

vi.mock('../../components/WalletList/WalletGridView', () => ({
  WalletGridView: ({ wallets, pendingByWallet }: any) => (
    <div data-testid="wallet-grid">
      <span data-testid="wallet-order">{wallets.map((w: any) => w.id).join(',')}</span>
      <span data-testid="pending-json">{JSON.stringify(pendingByWallet)}</span>
    </div>
  ),
}));

describe('WalletList branch coverage', () => {
  const updatePreferences = vi.fn();
  const invalidateAllWallets = vi.fn();

  const wallets = [
    {
      id: 'w1',
      name: 'Charlie',
      type: 'single_sig',
      balance: 300,
      network: 'mainnet',
      deviceCount: 2,
    },
    {
      id: 'w2',
      name: 'Alpha',
      type: 'multi_sig',
      balance: 100,
      network: 'mainnet',
      deviceCount: 5,
    },
    {
      id: 'w3',
      name: 'Bravo',
      type: 'single_sig',
      balance: 200,
      network: 'mainnet',
      deviceCount: 1,
    },
    {
      id: 'w4',
      name: 'Testnet Wallet',
      type: 'single_sig',
      balance: 400,
      network: 'testnet',
      deviceCount: 4,
    },
  ];

  const renderWalletList = (path = '/wallets') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <WalletList />
      </MemoryRouter>
    );

  const setUserPrefs = (walletPrefs: Record<string, unknown>) => {
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: {
        id: 'user-1',
        preferences: {
          viewSettings: {
            wallets: walletPrefs,
          },
        },
      },
      updatePreferences,
    } as any);
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (v: number) => `${v}`,
      formatFiat: (v: number) => `$${v}`,
      showFiat: true,
    } as any);

    setUserPrefs({});

    vi.mocked(useWalletsHook.useWallets).mockReturnValue({
      data: wallets,
      isLoading: false,
      error: null,
    } as any);

    vi.mocked(useWalletsHook.useInvalidateAllWallets).mockReturnValue(invalidateAllWallets);

    vi.mocked(useWalletsHook.usePendingTransactions).mockReturnValue({
      data: [],
    } as any);
  });

  it('handles network URL state and mainnet URL cleanup branch', async () => {
    const user = userEvent.setup();
    renderWalletList('/wallets?network=testnet');

    expect(screen.getByTestId('selected-network')).toHaveTextContent('testnet');
    await user.click(screen.getByText('to-mainnet'));
    expect(screen.getByTestId('selected-network')).toHaveTextContent('mainnet');
  });

  it('handles table sort callback branches and row navigation', async () => {
    const user = userEvent.setup();
    setUserPrefs({ layout: 'table', sortBy: 'name', sortOrder: 'asc' });
    renderWalletList();

    await user.click(screen.getByText('sort-name'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ sortBy: 'name', sortOrder: 'desc' }),
        }),
      })
    );

    await user.click(screen.getByText('sort-type'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ sortBy: 'type', sortOrder: 'asc' }),
        }),
      })
    );

    await user.click(screen.getByText('row-click'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w2');
  });

  it('toggles same sort field from desc back to asc', async () => {
    const user = userEvent.setup();
    setUserPrefs({ layout: 'table', sortBy: 'name', sortOrder: 'desc' });
    renderWalletList();

    await user.click(screen.getByText('sort-name'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ sortBy: 'name', sortOrder: 'asc' }),
        }),
      })
    );
  });

  it('handles column config callbacks, view toggles, and sync invalidation', async () => {
    const user = userEvent.setup();
    setUserPrefs({
      layout: 'table',
      visibleColumns: ['name', 'network'],
      columnOrder: ['name', 'balance'],
    });
    const { container } = renderWalletList();

    await user.click(screen.getByText('visibility-hide'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ visibleColumns: ['name'] }),
        }),
      })
    );

    await user.click(screen.getByText('visibility-show'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ visibleColumns: ['name', 'network', 'custom-col'] }),
        }),
      })
    );

    await user.click(screen.getByText('order-change'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ columnOrder: ['balance', 'name'] }),
        }),
      })
    );

    await user.click(screen.getByText('reset-columns'));
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({
            columnOrder: DEFAULT_WALLET_COLUMN_ORDER,
            visibleColumns: DEFAULT_WALLET_VISIBLE_COLUMNS,
          }),
        }),
      })
    );

    const viewButtons = container.querySelectorAll('button.p-2.rounded-md.transition-colors');
    expect(viewButtons.length).toBe(2);
    await user.click(viewButtons[0]);
    await user.click(viewButtons[1]);
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ layout: 'grid' }),
        }),
      })
    );
    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          wallets: expect.objectContaining({ layout: 'table' }),
        }),
      })
    );

    await user.click(screen.getByTestId('sync-start'));
    expect(invalidateAllWallets).toHaveBeenCalledTimes(1);
  });

  it('executes type sort branch', () => {
    setUserPrefs({ sortBy: 'type', sortOrder: 'asc' });
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w2,w1,w3');
  });

  it('executes devices sort branch', () => {
    setUserPrefs({ sortBy: 'devices', sortOrder: 'asc' });
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w3,w1,w2');
  });

  it('executes devices sort fallback when device count is missing', () => {
    setUserPrefs({ sortBy: 'devices', sortOrder: 'asc' });
    vi.mocked(useWalletsHook.useWallets).mockReturnValue({
      data: wallets.map(({ deviceCount, ...rest }) => rest),
      isLoading: false,
      error: null,
    } as any);
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w1,w2,w3');
  });

  it('executes network sort branch', () => {
    setUserPrefs({ sortBy: 'network', sortOrder: 'asc' });
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w1,w2,w3');
  });

  it('executes network sort nullish fallbacks when network getters return undefined during sort', () => {
    setUserPrefs({ sortBy: 'network', sortOrder: 'asc' });

    const makeNetworkFlipWallet = (id: string) => {
      let reads = 0;
      const wallet = {
        ...wallets.find(w => w.id === id)!,
        id,
      } as any;
      Object.defineProperty(wallet, 'network', {
        configurable: true,
        get() {
          reads += 1;
          // First read is used by filtering; subsequent reads happen during sorting.
          return reads === 1 ? 'mainnet' : undefined;
        },
      });
      return wallet;
    };

    vi.mocked(useWalletsHook.useWallets).mockReturnValue({
      data: [
        makeNetworkFlipWallet('u1'),
        makeNetworkFlipWallet('u2'),
      ],
      isLoading: false,
      error: null,
    } as any);

    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('u1,u2');
  });

  it('executes balance sort and descending order branch', () => {
    setUserPrefs({ sortBy: 'balance', sortOrder: 'desc' });
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w1,w3,w2');
  });

  it('executes default sort branch for unsupported sort field', () => {
    setUserPrefs({ sortBy: 'unsupported', sortOrder: 'asc' });
    renderWalletList();
    expect(screen.getByTestId('wallet-order')).toHaveTextContent('w1,w2,w3');
  });

  it('aggregates pending transactions including existing-wallet branch', async () => {
    vi.mocked(useWalletsHook.usePendingTransactions).mockReturnValue({
      data: [
        { walletId: 'w1', type: 'received', amount: 50 },
        { walletId: 'w1', type: 'sent', amount: -20 },
      ],
    } as any);

    renderWalletList();

    await waitFor(() => {
      const pending = screen.getByTestId('pending-json').textContent || '';
      expect(pending).toContain('"w1"');
      expect(pending).toContain('"net":30');
      expect(pending).toContain('"count":2');
      expect(pending).toContain('"hasIncoming":true');
      expect(pending).toContain('"hasOutgoing":true');
    });
  });

  it('navigates to empty-state import button target', async () => {
    const user = userEvent.setup();
    vi.mocked(useWalletsHook.useWallets).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as any);

    renderWalletList();
    await user.click(screen.getByText('Import Wallet'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/import');
  });
});
