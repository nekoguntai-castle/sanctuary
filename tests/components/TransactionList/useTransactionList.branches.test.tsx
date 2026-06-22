import {
  act,
  renderHook,
  waitFor,
  type RenderHookOptions,
  type RenderHookResult,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useTransactionList } from '../../../components/TransactionList/hooks/useTransactionList';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as labelsApi from '../../../src/api/labels';
import type { TransactionStats } from '../../../src/api/transactions';
import * as transactionsApi from '../../../src/api/transactions';
import type { Label,Transaction } from '../../../types';

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../src/api/labels', () => ({
  setTransactionLabels: vi.fn(),
  createLabel: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getTransaction: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  txid: 'txid-1',
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 1,
  labels: [],
  ...overrides,
});

// useTransactionList calls useSearchParams, so the hook must render inside a
// Router. renderTxHook injects a MemoryRouter wrapper (default at "/"); pass a
// custom one via options.wrapper to seed the ?tx deep-link param.
const makeRouterWrapper = (initialEntries: string[] = ['/']) =>
  function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };

function renderTxHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return renderHook(callback, { wrapper: makeRouterWrapper(), ...options });
}

describe('useTransactionList branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      explorerUrl: 'https://mempool.space',
    } as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValue([]);
    vi.mocked(labelsApi.createLabel).mockResolvedValue({
      id: 'lbl-new',
      walletId: 'wallet-1',
      name: 'New Label',
      color: '#6366f1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue(makeTx());
  });

  it('keeps default explorer URL when API response omits explorerUrl', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValueOnce({} as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);

    const { result } = renderTxHook(() => useTransactionList({ transactions: [] }));

    await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
    expect(result.current.explorerUrl).toBe('https://mempool.space');
  });

  it('handles highlighted scroll branch for missing and found transaction indexes', () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    const tx1 = makeTx({ id: 'tx-1', txid: 'txid-1' });
    const tx2 = makeTx({ id: 'tx-2', txid: 'txid-2' });

    const { result, rerender } = renderTxHook(
      ({ highlightedTxId }) => useTransactionList({ transactions: [tx1, tx2], highlightedTxId }),
      { initialProps: { highlightedTxId: undefined as string | undefined } }
    );

    act(() => {
      result.current.virtuosoRef.current = { scrollToIndex };
    });

    rerender({ highlightedTxId: 'missing-id' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(scrollToIndex).not.toHaveBeenCalled();

    rerender({ highlightedTxId: 'tx-2' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'center',
      behavior: 'smooth',
    });
  });

  it('covers explorer/details fetch failures plus clipboard success/fallback timeout paths', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('status failed'));
    vi.mocked(transactionsApi.getTransaction).mockRejectedValueOnce(new Error('details failed'));
    const timeoutCallbacks: Array<() => void> = [];
    let timeoutId = 0;
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 2000) {
          timeoutCallbacks.push(cb as () => void);
          timeoutId += 1;
          return timeoutId as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const writeText = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('clipboard failed'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
    });

    const tx = makeTx({ id: 'tx-fail', txid: 'txid-fail' });
    const { result } = renderTxHook(() => useTransactionList({ transactions: [tx] }));

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => {
      expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-fail');
    });
    await waitFor(() => {
      expect(result.current.loadingDetails).toBe(false);
    });
    expect(result.current.fullTxDetails).toBeNull();

    await act(async () => {
      await result.current.copyToClipboard('txid-fail');
    });
    expect(result.current.copied).toBe(true);

    await act(async () => {
      await result.current.copyToClipboard('txid-fail');
    });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(clearTimeoutSpy).toHaveBeenCalledWith(1);
    expect(result.current.copied).toBe(true);
    act(() => timeoutCallbacks.pop()?.());
    expect(result.current.copied).toBe(false);
    clearTimeoutSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });

  it('no-ops save labels and AI suggestion when no transaction is selected', async () => {
    const { result } = renderTxHook(() => useTransactionList({ transactions: [makeTx()] }));

    await act(async () => {
      await result.current.handleSaveLabels();
      await result.current.handleAISuggestion('Coffee');
    });

    expect(labelsApi.setTransactionLabels).not.toHaveBeenCalled();
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
  });

  it('falls back to empty selected labels when transaction labels are undefined', async () => {
    const tx = makeTx({
      id: 'tx-no-labels',
      txid: 'txid-no-labels',
      labels: undefined as any,
    });

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [tx],
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-no-labels'));

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    expect(result.current.selectedLabelIds).toEqual([]);
  });

  it('edits labels, toggles add/remove branches, and saves selected labels', async () => {
    const tx = makeTx({
      id: 'tx-edit',
      txid: 'txid-edit',
      labels: [{ id: 'lbl-existing-on-tx', name: 'Existing', color: '#333333' } as Label],
    });
    const onLabelsChange = vi.fn();
    const labelA: Label = {
      id: 'lbl-a',
      walletId: 'wallet-1',
      name: 'A',
      color: '#111111',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const labelB: Label = {
      id: 'lbl-b',
      walletId: 'wallet-1',
      name: 'B',
      color: '#222222',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [tx],
        walletLabels: [labelA, labelB],
        onLabelsChange,
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-edit'));

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing-on-tx']);

    act(() => {
      result.current.handleToggleLabel('lbl-a');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing-on-tx', 'lbl-a']);

    act(() => {
      result.current.handleToggleLabel('lbl-a');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing-on-tx']);

    act(() => {
      result.current.handleToggleLabel('lbl-b');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing-on-tx', 'lbl-b']);

    await act(async () => {
      await result.current.handleSaveLabels();
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalledWith('tx-edit', ['lbl-existing-on-tx', 'lbl-b']);
    expect(result.current.selectedTx?.labels?.map(l => l.id)).toEqual(['lbl-b']);
    expect(onLabelsChange).toHaveBeenCalledTimes(1);
  });

  it('covers save/AI suggestion error handlers', async () => {
    const tx = makeTx({ id: 'tx-errors', txid: 'txid-errors', walletId: 'wallet-errors', labels: [] });
    vi.mocked(labelsApi.setTransactionLabels).mockRejectedValueOnce(new Error('save failed'));
    vi.mocked(labelsApi.createLabel).mockRejectedValueOnce(new Error('create failed'));

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [tx],
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-errors'));

    // handleEditLabels now reads from walletLabels synchronously (no API call)
    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    act(() => {
      result.current.handleToggleLabel('lbl-x');
    });
    await act(async () => {
      await result.current.handleSaveLabels();
    });

    await act(async () => {
      await result.current.handleAISuggestion('NewLabel');
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalled();
    expect(labelsApi.createLabel).toHaveBeenCalled();
  });

  it('applies AI suggestions for existing labels, avoids duplicate selection, and creates missing labels', async () => {
    const tx = makeTx({ id: 'tx-ai', txid: 'txid-ai', walletId: 'wallet-ai', labels: [] });
    const existing: Label = {
      id: 'lbl-existing',
      walletId: 'wallet-ai',
      name: 'Groceries',
      color: '#00aa00',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created: Label = {
      id: 'lbl-created',
      walletId: 'wallet-ai',
      name: 'Coffee',
      color: '#6366f1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(labelsApi.createLabel).mockResolvedValueOnce(created);

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [tx],
        walletLabels: [existing],
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-ai'));

    // handleEditLabels now reads from walletLabels synchronously
    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    // "groceries" matches existing label (case-insensitive) - should not create
    await act(async () => {
      await result.current.handleAISuggestion('groceries');
    });
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing']);

    // Duplicate suggestion - should remain selected without duplication
    await act(async () => {
      await result.current.handleAISuggestion('groceries');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing']);

    // "Coffee" does not exist - should create via API
    await act(async () => {
      await result.current.handleAISuggestion('Coffee');
    });

    expect(labelsApi.createLabel).toHaveBeenCalledWith('wallet-ai', {
      name: 'Coffee',
      color: '#6366f1',
    });
    expect(result.current.selectedLabelIds).toEqual(expect.arrayContaining(['lbl-existing', 'lbl-created']));
  });

  it('covers consolidation classification and txStats fee branches', () => {
    const txConsolidationType = makeTx({
      id: 'c-type',
      txid: 'txid-c-type',
      type: 'consolidation',
      amount: -1000,
      fee: 0,
    });
    const txConsolidationSendToSelf = makeTx({
      id: 'c-self-send',
      txid: 'txid-c-self-send',
      amount: -2000,
      counterpartyAddress: 'bc1self',
      fee: 200,
    });
    const txConsolidationReceiveFromSelf = makeTx({
      id: 'c-self-recv',
      txid: 'txid-c-self-recv',
      amount: 3000,
      counterpartyAddress: 'bc1self',
      fee: 300,
    });
    const txReceive = makeTx({
      id: 'recv',
      txid: 'txid-recv',
      amount: 4000,
      type: 'received',
      fee: 100,
    });
    const txSentWithFee = makeTx({
      id: 'sent-fee',
      txid: 'txid-sent-fee',
      amount: -5000,
      counterpartyAddress: 'bc1external',
      fee: 500,
    });
    const txSentWithoutFee = makeTx({
      id: 'sent-no-fee',
      txid: 'txid-sent-no-fee',
      amount: -6000,
      counterpartyAddress: 'bc1external-2',
      fee: undefined,
    });
    const txReplaced = makeTx({
      id: 'replaced',
      txid: 'txid-replaced',
      amount: 7000,
      rbfStatus: 'replaced',
    });

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [
          txConsolidationType,
          txConsolidationSendToSelf,
          txConsolidationReceiveFromSelf,
          txReceive,
          txSentWithFee,
          txSentWithoutFee,
          txReplaced,
        ],
        walletAddresses: ['bc1self'],
      })
    );

    expect(result.current.filteredTransactions).toHaveLength(6);

    expect(result.current.getTxTypeInfo(txConsolidationSendToSelf)).toEqual({
      isReceive: false,
      isConsolidation: true,
    });
    expect(result.current.getTxTypeInfo(txConsolidationReceiveFromSelf)).toEqual({
      isReceive: true,
      isConsolidation: true,
    });
    expect(result.current.getTxTypeInfo(txReceive)).toEqual({
      isReceive: true,
      isConsolidation: false,
    });

    expect(result.current.txStats).toEqual({
      total: 6,
      received: 1,
      sent: 2,
      consolidations: 3,
      totalReceived: 4000,
      totalSent: 11000,
      totalFees: 1000,
    });
  });

  it('uses provided transactionStats when available', () => {
    const transactionStats: TransactionStats = {
      totalCount: 9,
      receivedCount: 4,
      sentCount: 3,
      consolidationCount: 2,
      totalReceived: 120000,
      totalSent: 90000,
      totalFees: 1400,
      walletBalance: 500000,
    };

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [makeTx()],
        transactionStats,
      })
    );

    expect(result.current.txStats).toEqual({
      total: 9,
      received: 4,
      sent: 3,
      consolidations: 2,
      totalReceived: 120000,
      totalSent: 90000,
      totalFees: 1400,
    });
  });

  describe('URL selection sync (#52)', () => {
    it('writes ?tx on select, clears it on clear, and clears selection when ?tx is removed externally', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [tx] });
        const [params, setParams] = useSearchParams();
        return { list, txParam: params.get('tx'), setParams };
      });

      // Settle the mount-time explorer-URL fetch before driving selection.
      await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
      expect(result.current.list.ownsSelection).toBe(true);
      expect(result.current.txParam).toBeNull();

      // Selecting writes ?tx; the reconcile effect then resolves it to selectedTx.
      await act(async () => result.current.list.handleTxClick(tx));
      expect(result.current.list.selectedTx?.txid).toBe('txid-1');
      expect(result.current.txParam).toBe('txid-1');

      // Explicit clear removes ?tx.
      await act(async () => result.current.list.clearSelectedTx());
      expect(result.current.list.selectedTx).toBeNull();
      expect(result.current.txParam).toBeNull();

      // Re-select, then drop ?tx externally (e.g. browser back) → selection clears.
      await act(async () => result.current.list.handleTxClick(tx));
      expect(result.current.list.selectedTx?.txid).toBe('txid-1');
      await act(async () => result.current.setParams(new URLSearchParams()));
      expect(result.current.list.selectedTx).toBeNull();
    });

    it('resolves a deep-linked ?tx once the matching transaction loads', async () => {
      const tx = makeTx({ id: 'tx-2', txid: 'txid-2' });
      const { result, rerender } = renderTxHook(
        ({ transactions }: { transactions: Transaction[] }) =>
          useTransactionList({ transactions }),
        {
          initialProps: { transactions: [] as Transaction[] },
          wrapper: makeRouterWrapper(['/?tx=txid-2']),
        },
      );

      // Param present but data not loaded yet → no selection.
      expect(result.current.selectedTx).toBeNull();

      // Data arrives → the effect resolves the param to the transaction.
      rerender({ transactions: [tx] });
      await waitFor(() => expect(result.current.selectedTx?.txid).toBe('txid-2'));
    });

    it('leaves selection empty for a ?tx that matches no transaction', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const { result } = renderTxHook(() => useTransactionList({ transactions: [tx] }), {
        wrapper: makeRouterWrapper(['/?tx=does-not-exist']),
      });

      await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
      expect(result.current.selectedTx).toBeNull();
    });

    it('ignores ?tx and delegates clicks when a caller owns selection via onTransactionClick', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const onTransactionClick = vi.fn();
      const { result } = renderTxHook(
        () => useTransactionList({ transactions: [tx], onTransactionClick }),
        { wrapper: makeRouterWrapper(['/?tx=txid-1']) },
      );

      await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
      expect(result.current.ownsSelection).toBe(false);
      // The matching ?tx must NOT hijack a delegating list.
      expect(result.current.selectedTx).toBeNull();

      act(() => result.current.handleTxClick(tx));
      expect(onTransactionClick).toHaveBeenCalledWith(tx);
      expect(result.current.selectedTx).toBeNull();
    });
  });
});
