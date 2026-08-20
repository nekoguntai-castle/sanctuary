/**
 * The sub-tab surface: opening, switching, closing, detaching, docking and
 * reordering transaction detail tabs.
 *
 * Split out of TransactionList.test.tsx when that file crossed the 1000-line
 * limit the large-file gate enforces. The mock preamble is repeated rather than
 * shared because `vi.mock` hoists per file: a shared module's mocks would run
 * after this file's own imports had already resolved.
 */
/**
 * TransactionList Component Tests
 *
 * Tests for the transaction list display including filtering,
 * transaction details, and label management.
 */

import { fireEvent,render as rtlRender,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as transactionsApi from '../../../src/api/transactions';
import type { Transaction } from '../../../src/types';

// TransactionList -> useTransactionList -> useSearchParams requires a Router.
// Wrap every render in a MemoryRouter (default at "/"); pass { wrapper } to seed
// a ?tx deep-link entry.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: MemoryRouter, ...options });

// Mock the CurrencyContext
vi.mock('../../../src/contexts/CurrencyContext', () => {
  const value = {
    format: (sats: number) => `${sats.toLocaleString()} sats`,
    btcPrice: 50000,
    currency: 'USD',
    unit: 'sats',
  };
  return {
    useCurrency: () => value,
    usePriceFreeFormatter: () => value,
  };
});

// Mock AI status hook
vi.mock('../../../src/hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: false,
    loading: false,
  }),
}));

// Mock APIs
vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn().mockResolvedValue({} as any),
}));

vi.mock('../../../src/api/labels', () => ({
  setTransactionLabels: vi.fn().mockResolvedValue([]),
  createLabel: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getTransaction: vi.fn().mockResolvedValue({} as any),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock explorer utility
vi.mock('../../../src/utils/explorer', () => ({
  getTxExplorerUrl: vi.fn((txid: string, _network: string, explorerUrl: string) => `${explorerUrl}/tx/${txid}`),
}));

// Mock Amount component
vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats?: number }) => <span data-testid="amount">{sats?.toLocaleString() ?? 0} sats</span>,
  default: ({ sats }: { sats?: number }) => <span data-testid="amount">{sats?.toLocaleString() ?? 0} sats</span>,
}));

// Mock react-virtuoso - render a simpler version that just shows data
// Honours `components.TableRow` so the inline detail expansion — which is rendered by
// that override, not by itemContent — is exercised here rather than silently skipped.
vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({ data, fixedHeaderContent, itemContent, components }: {
    data: unknown[];
    fixedHeaderContent?: () => React.ReactNode;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: { TableRow?: React.ComponentType<Record<string, unknown>> };
  }) => {
    const TableRow = components?.TableRow;
    return (
      <table data-testid="virtuoso-table">
        <thead>
          {fixedHeaderContent?.()}
        </thead>
        <tbody>
          {data.map((item, index) => (
            TableRow
              ? (
                <TableRow key={index} item={item} data-index={index} data-testid="transaction-row">
                  {itemContent(index, item)}
                </TableRow>
              )
              : (
                <tr key={index} data-testid="transaction-row">
                  {itemContent(index, item)}
                </tr>
              )
          ))}
        </tbody>
      </table>
    );
  },
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span data-testid="arrow-down-left" />,
  ArrowUpRight: () => <span data-testid="arrow-up-right" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  Tag: () => <span data-testid="tag-icon" />,
  CheckCircle2: () => <span data-testid="check-circle-icon" />,
  ShieldCheck: () => <span data-testid="shield-check-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  X: () => <span data-testid="x-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Edit2: () => <span data-testid="edit-icon" />,
  TrendingUp: () => <span data-testid="trending-up-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  PanelRightOpen: () => <span data-testid="detach-icon" />,
  PanelBottomClose: () => <span data-testid="dock-icon" />,
}));

// Mock child components
vi.mock('../../../src/components/TransactionActions', () => ({
  TransactionActions: () => <div data-testid="transaction-actions" />,
}));

vi.mock('../../../src/components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: () => <div data-testid="transaction-flow-preview" />,
}));

vi.mock('../../../src/components/LabelSelector', () => ({
  LabelBadges: ({ labels }: { labels: unknown[] }) => (
    <div data-testid="label-badges">{labels?.length || 0} labels</div>
  ),
}));

vi.mock('../../../src/components/AILabelSuggestion', () => ({
  AILabelSuggestion: () => <div data-testid="ai-label-suggestion" />,
}));

// Create mock transactions
describe('TransactionList - detail sub-tabs', () => {
  const baseTx = {
    id: 'tx-1',
    txid: 'txid-1',
    walletId: 'wallet-1',
    amount: 1000,
    fee: 10,
    timestamp: Date.now(),
    confirmations: 2,
    type: 'received',
  } as Transaction;

  const secondTx = {
    ...baseTx,
    id: 'tx-2',
    txid: 'txid-2',
    amount: -2000,
  } as Transaction;

  const openRow = async (user: ReturnType<typeof userEvent.setup>, index = 0) => {
    const rows = screen.getAllByTestId('transaction-row');
    await user.click(rows[index].querySelectorAll('td')[0]);
  };

  /** Wide enough for a detached panel to sit beside the list (the tablet breakpoint). */
  const stubViewport = (canFloat: boolean) => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: canFloat && query.includes('900'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({} as any);
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue({} as any);
    stubViewport(true);
  });

  it('reserves no space for details while nothing is open', async () => {
    // The old layout kept a 320-448px pane showing "Select a transaction to see
    // its details" from 900px up. That reserved column is why this changed.
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);

    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-detail-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a transaction to see its details')).not.toBeInTheDocument();
  });

  it('opens a transaction into its own tab and shows it instead of the table', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);

    await openRow(user);

    const strip = await screen.findByRole('tablist', { name: 'Transaction tabs' });
    expect(within(strip).getByRole('tab', { name: 'Transactions' })).toBeInTheDocument();
    const detailTab = within(strip).getByRole('tab', { name: /Received/ });
    expect(detailTab).toHaveAttribute('aria-selected', 'true');
    // The details body is in the DOM exactly once.
    expect(screen.getAllByText('Transaction Details')).toHaveLength(1);
  });

  it('keeps several transactions open at once and switches between them', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx, secondTx]} />);

    await openRow(user, 0);
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    await openRow(user, 1);

    const strip = screen.getByTestId('transaction-tab-strip');
    const tabs = within(strip).getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);

    // Both panels stay mounted; only the inactive one is hidden, so switching
    // back does not refetch or lose an in-progress label edit.
    const panels = screen.getAllByTestId('transaction-detail-panel');
    expect(panels).toHaveLength(2);
    expect(panels.filter((panel) => !panel.hasAttribute('hidden'))).toHaveLength(1);

    await user.click(tabs[1]);
    expect(screen.getAllByTestId('transaction-detail-panel')[0]).not.toHaveAttribute('hidden');
  });

  it('closes a tab from its own close control', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    await user.click(screen.getByRole('button', { name: /^Close / }));

    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-detail-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
  });

  it('shows the table again from the pinned list tab without closing anything', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    await user.click(screen.getByRole('tab', { name: 'Transactions' }));

    expect(screen.getByTestId('transaction-detail-panel')).toHaveAttribute('hidden');
    expect(screen.getByRole('tab', { name: /Received/ })).toBeInTheDocument();
  });

  it('gives the close control an accessible name, and keeps it out of the tab', async () => {
    // A button nested inside a role="tab" becomes a tab stop of its own and
    // shadows the tab in keyboard traversal.
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    const closeButton = screen.getByRole('button', { name: /^Close Received/ });
    expect(closeButton.closest('[role="tab"]')).toBeNull();
  });

  it('renders no tabs when a caller owns selection via onTransactionClick', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    const onTransactionClick = vi.fn();
    render(
      <TransactionList transactions={[baseTx]} onTransactionClick={onTransactionClick} />
    );

    await openRow(user);

    expect(onTransactionClick).toHaveBeenCalledWith(baseTx);
    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-detail-panel')).not.toBeInTheDocument();
  });

  it('closes a tab whose transaction turns out not to exist', async () => {
    // A deep link to a transaction the node has never heard of. Leaving the tab
    // open would strand an empty panel, and since tabs are URL state it would
    // survive a reload.
    vi.mocked(transactionsApi.getTransaction).mockRejectedValue({ status: 404 });
    const { TransactionList } = await import('../../../src/components/TransactionList');
    const missing = 'f'.repeat(64);

    rtlRender(<TransactionList transactions={[baseTx]} walletId="wallet-1" />, {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[`/?tx=${missing}`]}>{children}</MemoryRouter>
      ),
    });

    await waitFor(() =>
      expect(screen.queryByTestId('transaction-detail-panel')).not.toBeInTheDocument());
    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
  });

  it('detaches a tab into a floating panel and docks it back', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    await user.click(screen.getByRole('button', { name: /^Detach / }));

    const floating = screen.getByTestId('floating-panel');
    expect(floating).toBeInTheDocument();
    // Its tab leaves the strip: the transaction is on screen in its own panel,
    // and a tab that can never be selected is worse than no tab.
    expect(screen.queryByRole('tab', { name: /Received/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeInTheDocument();
    // The table is showing again behind it: that is the point of detaching.
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
    expect(within(floating).getByTestId('transaction-detail-panel')).not.toHaveAttribute('hidden');
    // The floating window carries the title and controls, so the panel does not
    // repeat its own header inside it.
    expect(within(floating).queryByText('Transaction Details')).not.toBeInTheDocument();

    await user.click(within(floating).getByRole('button', { name: /^Dock / }));

    expect(screen.queryByTestId('floating-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Received/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('closes a detached panel from its own close control', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);
    await user.click(screen.getByRole('button', { name: /^Detach / }));

    await user.click(within(screen.getByTestId('floating-panel')).getByRole('button', { name: /^Close / }));

    expect(screen.queryByTestId('floating-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
  });

  it('offers no detach where a floating panel would cover the list', async () => {
    // Below the tablet breakpoint a panel wide enough to read hides the list it
    // was detached to sit beside.
    stubViewport(false);
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    expect(screen.queryByRole('button', { name: /^Detach / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close / })).toBeInTheDocument();
  });

  it('docks a panel that a narrowing window would strand', async () => {
    const { TransactionList } = await import('../../../src/components/TransactionList');
    const missing = 'c'.repeat(64);
    stubViewport(false);

    rtlRender(<TransactionList transactions={[{ ...baseTx, txid: missing }]} />, {
      wrapper: ({ children }) => (
        <MemoryRouter initialEntries={[`/?tx=${missing}&txWin=${missing}`]}>{children}</MemoryRouter>
      ),
    });

    await waitFor(() =>
      expect(screen.queryByTestId('floating-panel')).not.toBeInTheDocument());
    expect(screen.getByTestId('transaction-detail-panel')).not.toHaveAttribute('hidden');
  });

  describe('dragging a panel back into the strip', () => {
    /**
     * jsdom gives every element a zero box, so the strip has to be given one
     * before a pointer position can be inside or outside it.
     */
    const stubStripRect = (rect: { top: number; bottom: number }) => {
      const zone = screen.getByTestId('transaction-tab-strip-zone');
      vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 1200,
        top: rect.top,
        bottom: rect.bottom,
        width: 1200,
        height: rect.bottom - rect.top,
        x: 0,
        y: rect.top,
        toJSON: () => ({}),
      } as DOMRect);
    };

    const dragHeaderTo = (to: { x: number; y: number }) => {
      const header = screen.getByTestId('floating-panel-header');
      fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 600, clientY: 600 });
      fireEvent.pointerMove(header, { pointerId: 1, clientX: to.x, clientY: to.y });
      fireEvent.pointerUp(header, { pointerId: 1 });
    };

    const openDetached = async (user: ReturnType<typeof userEvent.setup>) => {
      const { TransactionList } = await import('../../../src/components/TransactionList');
      render(<TransactionList transactions={[baseTx]} />);
      await openRow(user);
      await user.click(screen.getByRole('button', { name: /^Detach / }));
    };

    beforeEach(() => {
      Element.prototype.setPointerCapture = vi.fn();
      Element.prototype.releasePointerCapture = vi.fn();
    });

    it('docks the panel when it is dropped on the strip', async () => {
      const user = userEvent.setup();
      await openDetached(user);
      stubStripRect({ top: 100, bottom: 140 });

      dragHeaderTo({ x: 400, y: 120 });

      expect(screen.queryByTestId('floating-panel')).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Received/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('leaves the panel floating when it is dropped anywhere else', async () => {
      const user = userEvent.setup();
      await openDetached(user);
      stubStripRect({ top: 100, bottom: 140 });

      dragHeaderTo({ x: 400, y: 700 });

      expect(screen.getByTestId('floating-panel')).toBeInTheDocument();
    });

    it('marks the strip while the panel is over it, and unmarks it after', async () => {
      const user = userEvent.setup();
      await openDetached(user);
      stubStripRect({ top: 100, bottom: 140 });
      const header = screen.getByTestId('floating-panel-header');

      fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 600, clientY: 600 });
      fireEvent.pointerMove(header, { pointerId: 1, clientX: 400, clientY: 120 });
      expect(screen.getByTestId('transaction-tab-strip-zone')).toHaveAttribute('data-dock-target');

      fireEvent.pointerMove(header, { pointerId: 1, clientX: 400, clientY: 700 });
      expect(screen.getByTestId('transaction-tab-strip-zone')).not.toHaveAttribute(
        'data-dock-target',
      );

      fireEvent.pointerUp(header, { pointerId: 1 });
      expect(screen.getByTestId('transaction-tab-strip-zone')).not.toHaveAttribute(
        'data-dock-target',
      );
    });
  });

  it('opens a tab in the background on a modifier-click, without leaving the list', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx, secondTx]} />);

    await openRow(user, 0);
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    // The chord that opens a link in a background browser tab.
    await user.keyboard('{Meta>}');
    await openRow(user, 1);
    await user.keyboard('{/Meta}');

    const strip = screen.getByTestId('transaction-tab-strip');
    expect(within(strip).getAllByRole('tab')).toHaveLength(3);
    // Still on the table, which is the point of a background open.
    expect(within(strip).getByRole('tab', { name: 'Transactions' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('closes a tab with the middle button', async () => {
    const user = userEvent.setup();
    const { TransactionList } = await import('../../../src/components/TransactionList');
    render(<TransactionList transactions={[baseTx]} />);
    await openRow(user);

    fireEvent(
      screen.getByRole('tab', { name: /Received/ }),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );

    expect(screen.queryByTestId('transaction-tab-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
  });
});
