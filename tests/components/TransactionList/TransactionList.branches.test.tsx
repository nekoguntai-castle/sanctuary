import { render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { TransactionList } from '../../../src/components/TransactionList/TransactionList';
import { TransactionDetailPanel } from '../../../src/components/TransactionList/TransactionTabs/TransactionDetailPanel';
import { getOwnAddressValue } from '../../../src/components/TransactionList/TransactionList/detailsModel';
import type { Transaction } from '../../../src/types';

const useTransactionListMock = vi.fn();
const useTransactionResolutionMock = vi.fn();
const useTransactionLabelMutationsMock = vi.fn();

vi.mock('../../../src/contexts/CurrencyContext', () => {
  const value = {
    format: (value: number) => `${value.toLocaleString()} sats`,
    unit: 'sats',
  };
  return {
    useCurrency: () => value,
    usePriceFreeFormatter: () => value,
  };
});

vi.mock('../../../src/hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: true,
    loading: false,
  }),
}));

vi.mock('../../../src/components/TransactionList/hooks/useTransactionList', () => ({
  useTransactionList: (args: unknown) => useTransactionListMock(args),
}));

// The detail body's own branches are the subject here, so the panel's two hooks
// are stubbed and the states they can produce are driven directly.
vi.mock('../../../src/components/TransactionList/hooks/useTransactionResolution', () => ({
  useTransactionResolution: (args: unknown) => useTransactionResolutionMock(args),
}));

vi.mock('../../../src/components/TransactionList/hooks/useTransactionLabelMutations', () => ({
  useTransactionLabelMutations: (args: unknown) => useTransactionLabelMutationsMock(args),
}));

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({
    sats = 0,
    showSign,
  }: {
    sats?: number;
    showSign?: boolean;
  }) => <span>{showSign && sats > 0 ? '+' : ''}{sats.toLocaleString()} sats</span>,
}));

vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({
    data,
    fixedHeaderContent,
    itemContent,
    components,
  }: {
    data: unknown[];
    fixedHeaderContent?: () => React.ReactNode;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: { Table?: React.ComponentType<any>; TableBody?: React.ComponentType<any> };
  }) => {
    const Table = components?.Table ?? ((props: any) => <table {...props} />);
    const TableBody = components?.TableBody ?? ((props: any) => <tbody {...props} />);
    return (
      <Table data-testid="virtuoso-table">
        <thead>{fixedHeaderContent?.()}</thead>
        <TableBody>
          {data.map((item, index) => (
            <tr key={index}>{itemContent(index, item)}</tr>
          ))}
        </TableBody>
      </Table>
    );
  },
}));

vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span data-testid="arrow-down-left" />,
  ArrowUpRight: () => <span data-testid="arrow-up-right" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  ShieldCheck: () => <span data-testid="shield-check-icon" />,
  CheckCircle2: () => <span data-testid="check-circle-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

vi.mock('../../../src/components/TransactionList/TransactionRow', () => ({
  TransactionRow: ({ tx, onTxClick }: { tx: Transaction; onTxClick: (t: Transaction) => void }) => (
    <>
      <td>
        <button onClick={() => onTxClick(tx)}>{tx.id}</button>
      </td>
    </>
  ),
}));

vi.mock('../../../src/components/TransactionList/ActionMenu', () => ({
  ActionMenu: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="action-close" onClick={onClose}>
      close-from-action
    </button>
  ),
}));

vi.mock('../../../src/components/TransactionList/FlowPreview', () => ({
  FlowPreview: () => <div data-testid="flow-preview" />,
}));

vi.mock('../../../src/components/TransactionList/LabelEditor', () => ({
  LabelEditor: ({
    canEdit,
    aiEnabled,
    onCancelEdit,
  }: {
    canEdit: boolean;
    aiEnabled: boolean;
    onCancelEdit: () => void;
  }) => (
    <div>
      <span>{`canEdit:${String(canEdit)}`}</span>
      <span>{`aiEnabled:${String(aiEnabled)}`}</span>
      <button data-testid="cancel-edit" onClick={onCancelEdit}>
        cancel-edit
      </button>
    </div>
  ),
}));

describe('TransactionList branch coverage', () => {
  const closeTab = vi.fn();
  const handleCancelEdit = vi.fn();
  const retry = vi.fn();

  const baseTx: Transaction = {
    id: 'tx-1',
    txid: 'txid-1',
    walletId: 'wallet-1',
    amount: 1000,
    fee: 10,
    confirmations: 1,
    timestamp: '2026-01-01T00:00:00.000Z' as any,
    counterpartyAddress: 'bc1q-counterparty',
    address: 'bc1q-own-address' as any,
    labels: [],
    rbfStatus: undefined,
    blockHeight: 900000 as any,
    type: 'received' as any,
  } as Transaction;

  const makeListState = (overrides: Record<string, unknown> = {}) => ({
    ownsSelection: true,
    explorerUrl: 'https://mempool.space',
    copied: false,
    activeTab: 'list',
    openTxids: [],
    activateTab: vi.fn(),
    closeTab,
    findTransaction: vi.fn().mockReturnValue(baseTx),
    filteredTransactions: [{ ...baseTx }],
    virtuosoRef: { current: null },
    txStats: {
      total: 1,
      received: 1,
      sent: 0,
      consolidations: 0,
      totalReceived: 1000,
      totalSent: 0,
      totalFees: 10,
    },
    getWallet: vi.fn().mockReturnValue({ id: 'wallet-1', name: 'Main Wallet' }),
    copyToClipboard: vi.fn(),
    handleTxClick: vi.fn(),
    getTxTypeInfo: vi.fn().mockReturnValue({ isReceive: true, isConsolidation: false }),
    ...overrides,
  });

  const setSelection = (
    overrides: Record<string, unknown> = {},
    selectedTxOverride?: Partial<Transaction> | null,
  ) => {
    const selectedTx =
      selectedTxOverride === null ? null : ({ ...baseTx, ...selectedTxOverride } as Transaction);
    useTransactionResolutionMock.mockReturnValue({
      selection: {
        key: 'wallet-1:txid-1',
        status: 'resolved',
        selectedTx,
        fullTxDetails: null,
        error: null,
        ...overrides,
      },
      retry,
      patchSelectedTxLabels: vi.fn(),
    });
  };

  const renderPanel = (walletAddresses: string[] = []) =>
    render(
      <TransactionDetailPanel
        txid="txid-1"
        instanceId="test"
        hidden={false}
        onClose={closeTab}
        onUnresolvable={vi.fn()}
        wallets={[]}
        walletAddresses={walletAddresses}
        walletLabels={[]}
        selectionTransactions={[baseTx]}
        walletId="wallet-1"
        explorerUrl="https://mempool.space"
        copied={false}
        canEdit
        aiEnabled
        confirmationThreshold={1}
        deepConfirmationThreshold={3}
        format={(sats: number) => `${sats.toLocaleString()} sats`}
        onCopyToClipboard={vi.fn()}
      />,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    useTransactionListMock.mockReturnValue(makeListState());
    useTransactionLabelMutationsMock.mockReturnValue({
      editingLabels: false,
      availableLabels: [],
      selectedLabelIds: [],
      savingLabels: false,
      labelMutationError: null,
      handleEditLabels: vi.fn(),
      handleSaveLabels: vi.fn(),
      handleCancelEdit,
      handleToggleLabel: vi.fn(),
      handleAISuggestion: vi.fn(),
    });
    setSelection();
  });

  it('shows empty state when hook returns no filtered transactions', () => {
    useTransactionListMock.mockReturnValue(makeListState({ filteredTransactions: [] }));

    render(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('No transactions found.')).toBeInTheDocument();
  });

  it('hides the table and shows the panel when a transaction tab is active', () => {
    useTransactionListMock.mockReturnValue(
      makeListState({ openTxids: ['txid-1'], activeTab: 'txid-1' }),
    );

    render(<TransactionList transactions={[baseTx]} />);

    expect(screen.getByTestId('transaction-tab-strip')).toBeInTheDocument();
    const panel = screen.getByTestId('transaction-detail-panel');
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('virtuoso-table').closest('[hidden]')).not.toBeNull();
  });

  it('renders loading and retryable panel states', async () => {
    const user = userEvent.setup();
    setSelection({ status: 'loading' }, null);
    const { rerender } = renderPanel();
    expect(screen.getByText('Loading transaction details…')).toBeInTheDocument();

    setSelection({ status: 'error', error: null }, null);
    rerender(<div />);
    renderPanel();
    expect(screen.getByText('Failed to load transaction details')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    // Nothing here closes the tab: a failed load is retryable, and the tab is
    // closed from its own × or by the resolution reporting it unresolvable.
    expect(closeTab).not.toHaveBeenCalled();
  });

  it('renders confirming status branch and pending timestamp/date fallbacks', () => {
    setSelection({}, { confirmations: 1, timestamp: undefined as any, blockHeight: 0 as any });

    render(
      <TransactionDetailPanel
        txid="txid-1"
        instanceId="test"
        hidden={false}
        onClose={closeTab}
        onUnresolvable={vi.fn()}
        wallets={[]}
        walletAddresses={[]}
        walletLabels={[]}
        selectionTransactions={[baseTx]}
        walletId="wallet-1"
        explorerUrl="https://mempool.space"
        copied={false}
        canEdit
        aiEnabled
        confirmationThreshold={3}
        deepConfirmationThreshold={6}
        format={(sats: number) => `${sats.toLocaleString()} sats`}
        onCopyToClipboard={vi.fn()}
      />,
    );

    expect(screen.getByText('Confirming (1/6)')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
  });

  it('renders pending confirmation and confirmation fallback to 0 when undefined', () => {
    setSelection({}, { confirmations: undefined as any });

    renderPanel();
    expect(screen.getByText('Pending Confirmation')).toBeInTheDocument();
    const confirmationsCard = screen.getByText('Confirmations').closest('div');
    expect(confirmationsCard).toBeInTheDocument();
    if (!confirmationsCard) throw new Error('Missing confirmations card');
    expect(within(confirmationsCard).getByText('0')).toBeInTheDocument();
  });

  it('renders network fee and N/A branches for sent transactions', () => {
    setSelection({}, { amount: -1000, fee: 25 });
    const { unmount } = renderPanel();
    expect(screen.getByText('25 sats')).toBeInTheDocument();
    unmount();

    setSelection({}, { amount: -1000, fee: 0 });
    renderPanel();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('renders consolidation labels for both sent and received self-transfer cases', () => {
    const walletAddresses = ['bc1q-self'];

    setSelection({}, { amount: -1200, counterpartyAddress: 'bc1q-self' });
    const { unmount } = renderPanel(walletAddresses);
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
    expect(screen.getByText('Consolidation Address (Your Wallet)')).toBeInTheDocument();
    unmount();

    setSelection({}, { amount: 1200, counterpartyAddress: 'bc1q-self' });
    renderPanel(walletAddresses);
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
    expect(screen.getByText('Consolidation Address (Your Wallet)')).toBeInTheDocument();
  });

  it('renders sender/recipient labels for non-consolidation branches', () => {
    const walletAddresses = ['bc1q-self'];

    setSelection({}, { amount: 500, counterpartyAddress: 'bc1q-external' });
    const { unmount } = renderPanel(walletAddresses);
    expect(screen.getAllByText('Received').length).toBeGreaterThan(0);
    expect(screen.getByText('Sender Address')).toBeInTheDocument();
    unmount();

    setSelection({}, { amount: -500, counterpartyAddress: 'bc1q-external' });
    renderPanel(walletAddresses);
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('renders own address branches for string and object forms', () => {
    setSelection({}, { amount: 1000, address: 'bc1q-string-address' as any });
    const { unmount } = renderPanel();
    expect(screen.getByText('Your Receiving Address')).toBeInTheDocument();
    expect(screen.getByText('bc1q-string-address')).toBeInTheDocument();
    unmount();

    setSelection({}, { amount: -1000, address: { address: 'bc1q-object-address' } as any });
    renderPanel();
    expect(screen.getByText('Your Sending Address')).toBeInTheDocument();
    expect(screen.getByText('bc1q-object-address')).toBeInTheDocument();
  });

  it('hides counterparty and own-address blocks when fields are absent', () => {
    setSelection({}, { counterpartyAddress: undefined as any, address: undefined as any });

    renderPanel();
    expect(screen.queryByText('Sender Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Recipient Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Receiving Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Sending Address')).not.toBeInTheDocument();
    expect(getOwnAddressValue({ ...baseTx, address: undefined as any })).toBe('');
  });

  it('closes the tab from the header, the action menu, and cancels label editing', async () => {
    const user = userEvent.setup();
    renderPanel();

    const closeButton = screen.getByTestId('x-icon').closest('button');
    if (!closeButton) throw new Error('Missing header close button');
    await user.click(closeButton);

    await user.click(screen.getByTestId('action-close'));
    await user.click(screen.getByTestId('cancel-edit'));

    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenCalledWith('txid-1');
    expect(handleCancelEdit).toHaveBeenCalledTimes(1);
  });
});
