import { render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { TransactionList } from '../../../components/TransactionList/TransactionList';
import { getOwnAddressValue } from '../../../components/TransactionList/TransactionList/detailsModel';
import type { Transaction } from '../../../types';

const useTransactionListMock = vi.fn();

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (value: number) => `${value.toLocaleString()} sats`,
  }),
}));

vi.mock('../../../hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: true,
    loading: false,
  }),
}));

vi.mock('../../../components/TransactionList/hooks/useTransactionList', () => ({
  useTransactionList: (args: unknown) => useTransactionListMock(args),
}));

vi.mock('../../../components/Amount', () => ({
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

vi.mock('../../../components/TransactionList/TransactionRow', () => ({
  TransactionRow: ({ tx, onTxClick }: { tx: Transaction; onTxClick: (t: Transaction) => void }) => (
    <>
      <td>
        <button onClick={() => onTxClick(tx)}>{tx.id}</button>
      </td>
    </>
  ),
}));

vi.mock('../../../components/TransactionList/ActionMenu', () => ({
  ActionMenu: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="action-close" onClick={onClose}>
      close-from-action
    </button>
  ),
}));

vi.mock('../../../components/TransactionList/FlowPreview', () => ({
  FlowPreview: () => <div data-testid="flow-preview" />,
}));

vi.mock('../../../components/TransactionList/LabelEditor', () => ({
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
  const setSelectedTx = vi.fn();
  const setEditingLabels = vi.fn();

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

  const makeHookState = (
    overrides: Partial<ReturnType<typeof useTransactionListMock>> = {},
    selectedTxOverride?: Partial<Transaction> | null
  ) => {
    const selectedTx =
      selectedTxOverride === null
        ? null
        : ({ ...baseTx, ...selectedTxOverride } as Transaction);

    return {
      selectedTx,
      setSelectedTx,
      explorerUrl: 'https://mempool.space',
      copied: false,
      editingLabels: false,
      setEditingLabels,
      availableLabels: [],
      selectedLabelIds: [],
      savingLabels: false,
      fullTxDetails: null,
      loadingDetails: false,
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
      handleEditLabels: vi.fn(),
      handleSaveLabels: vi.fn(),
      handleToggleLabel: vi.fn(),
      handleAISuggestion: vi.fn(),
      getTxTypeInfo: vi.fn().mockReturnValue({ isReceive: true, isConsolidation: false }),
      ...overrides,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useTransactionListMock.mockReturnValue(makeHookState());
  });

  it('shows empty state when hook returns no filtered transactions', () => {
    useTransactionListMock.mockReturnValue(
      makeHookState({
        filteredTransactions: [],
      })
    );

    render(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('No transactions found.')).toBeInTheDocument();
  });

  it('renders confirming status branch and pending timestamp/date fallbacks', () => {
    useTransactionListMock.mockReturnValue(
      makeHookState({}, { confirmations: 1, timestamp: undefined as any, blockHeight: 0 as any })
    );

    render(
      <TransactionList
        transactions={[baseTx]}
        confirmationThreshold={3}
        deepConfirmationThreshold={6}
      />
    );

    expect(screen.getByText('Confirming (1/6)')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
  });

  it('renders pending confirmation and confirmation fallback to 0 when undefined', () => {
    useTransactionListMock.mockReturnValue(
      makeHookState({}, { confirmations: undefined as any })
    );

    render(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('Pending Confirmation')).toBeInTheDocument();
    const confirmationsCard = screen.getByText('Confirmations').closest('div');
    expect(confirmationsCard).toBeInTheDocument();
    if (!confirmationsCard) throw new Error('Missing confirmations card');
    expect(within(confirmationsCard).getByText('0')).toBeInTheDocument();
  });

  it('renders network fee and N/A branches for sent transactions', () => {
    const { rerender } = render(<TransactionList transactions={[baseTx]} />);

    useTransactionListMock.mockReturnValue(makeHookState({}, { amount: -1000, fee: 25 }));
    rerender(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('25 sats')).toBeInTheDocument();

    useTransactionListMock.mockReturnValue(makeHookState({}, { amount: -1000, fee: 0 }));
    rerender(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('renders consolidation labels for both sent and received self-transfer cases', () => {
    const walletAddresses = ['bc1q-self'];
    const { rerender } = render(
      <TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />
    );

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: -1200, counterpartyAddress: 'bc1q-self' })
    );
    rerender(<TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />);
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
    expect(screen.getByText('Consolidation Address (Your Wallet)')).toBeInTheDocument();

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: 1200, counterpartyAddress: 'bc1q-self' })
    );
    rerender(<TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />);
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
    expect(screen.getByText('Consolidation Address (Your Wallet)')).toBeInTheDocument();
  });

  it('renders sender/recipient labels for non-consolidation branches', () => {
    const walletAddresses = ['bc1q-self'];
    const { rerender } = render(
      <TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />
    );

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: 500, counterpartyAddress: 'bc1q-external' })
    );
    rerender(<TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />);
    expect(screen.getAllByText('Received').length).toBeGreaterThan(0);
    expect(screen.getByText('Sender Address')).toBeInTheDocument();

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: -500, counterpartyAddress: 'bc1q-external' })
    );
    rerender(<TransactionList transactions={[baseTx]} walletAddresses={walletAddresses} />);
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    expect(screen.getByText('Recipient Address')).toBeInTheDocument();
  });

  it('renders own address branches for string and object forms', () => {
    const { rerender } = render(<TransactionList transactions={[baseTx]} />);

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: 1000, address: 'bc1q-string-address' as any })
    );
    rerender(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('Your Receiving Address')).toBeInTheDocument();
    expect(screen.getByText('bc1q-string-address')).toBeInTheDocument();

    useTransactionListMock.mockReturnValue(
      makeHookState({}, { amount: -1000, address: { address: 'bc1q-object-address' } as any })
    );
    rerender(<TransactionList transactions={[baseTx]} />);
    expect(screen.getByText('Your Sending Address')).toBeInTheDocument();
    expect(screen.getByText('bc1q-object-address')).toBeInTheDocument();
  });

  it('hides counterparty and own-address blocks when fields are absent', () => {
    useTransactionListMock.mockReturnValue(
      makeHookState({}, { counterpartyAddress: undefined as any, address: undefined as any })
    );

    render(<TransactionList transactions={[baseTx]} />);
    expect(screen.queryByText('Sender Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Recipient Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Receiving Address')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Sending Address')).not.toBeInTheDocument();
    expect(getOwnAddressValue({ ...baseTx, address: undefined as any })).toBe('');
  });

  it('executes modal close handlers from backdrop, header close, action menu, and label cancel', async () => {
    const user = userEvent.setup();
    const { container } = render(<TransactionList transactions={[baseTx]} />);

    const backdrop = container.querySelector('div.fixed.inset-0.z-50');
    if (!backdrop) throw new Error('Missing backdrop container');
    await user.click(backdrop);

    const closeButton = screen.getByTestId('x-icon').closest('button');
    if (!closeButton) throw new Error('Missing header close button');
    await user.click(closeButton);

    await user.click(screen.getByTestId('action-close'));
    await user.click(screen.getByTestId('cancel-edit'));

    expect(setSelectedTx).toHaveBeenCalledWith(null);
    expect(setEditingLabels).toHaveBeenCalledWith(false);
  });
});
