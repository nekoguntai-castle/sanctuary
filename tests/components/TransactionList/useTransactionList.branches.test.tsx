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
import {
  isAbortError,
  removeExpectedTxParam,
  selectionErrorMessage,
} from '../../../components/TransactionList/hooks/selectionResolution';
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

const VALID_TXID = 'a'.repeat(64);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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
  it('normalizes non-Error selection failures and distinguishes non-abort DOM exceptions', () => {
    expect(selectionErrorMessage('offline')).toBe('Failed to load transaction details');
    expect(isAbortError(new DOMException('bad request', 'NetworkError'))).toBe(false);
  });

  it('removes only the expected normalized transaction URL parameter', () => {
    const missing = new URLSearchParams('view=compact');
    const different = new URLSearchParams(`tx=${'b'.repeat(64)}&view=compact`);
    const matching = new URLSearchParams(`tx=${VALID_TXID.toUpperCase()}&view=compact`);

    expect(removeExpectedTxParam(missing, VALID_TXID)).toBe(missing);
    expect(removeExpectedTxParam(different, VALID_TXID)).toBe(different);
    expect(removeExpectedTxParam(matching, VALID_TXID).toString()).toBe('view=compact');
  });

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
      expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-fail', expect.any(Object));
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
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-no-labels', expect.any(Object)));

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
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-edit', expect.any(Object)));

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
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValueOnce([labelB]);

    await act(async () => {
      await result.current.handleSaveLabels();
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalledWith('tx-edit', ['lbl-existing-on-tx', 'lbl-b']);
    expect(result.current.selectedTx?.labels?.map(l => l.id)).toEqual(['lbl-existing-on-tx', 'lbl-b']);
    expect(onLabelsChange).toHaveBeenCalledTimes(1);
  });

  it('covers save/AI suggestion error handlers', async () => {
    const tx = makeTx({ id: 'tx-errors', txid: 'txid-errors', walletId: 'wallet-errors', labels: [] });
    vi.mocked(labelsApi.setTransactionLabels).mockRejectedValueOnce('save failed');
    vi.mocked(labelsApi.createLabel).mockRejectedValueOnce(new Error('create failed'));

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [tx],
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-errors', 'txid-errors', expect.any(Object)));

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
    expect(result.current.labelMutationError).toBe('create failed');

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });
    expect(result.current.labelMutationError).toBeNull();
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
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-ai', 'txid-ai', expect.any(Object)));

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
    it('keeps B loading and details when stale A settles before B', async () => {
      const txA = makeTx({ id: 'tx-a', txid: 'txid-a' });
      const txB = makeTx({ id: 'tx-b', txid: 'txid-b' });
      const detailsA = createDeferred<Transaction>();
      const detailsB = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockImplementation((_walletId, txid) => (
        txid === 'txid-a' ? detailsA.promise : detailsB.promise
      ));
      const { result } = renderTxHook(() =>
        useTransactionList({ transactions: [txA, txB] })
      );

      act(() => result.current.handleTxClick(txA));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-a', expect.any(Object)));
      act(() => result.current.handleTxClick(txB));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-b', expect.any(Object)));

      await act(async () => {
        detailsA.resolve({ ...txA, inputs: [] });
        await detailsA.promise;
      });
      expect(result.current.selectedTx?.txid).toBe('txid-b');
      expect(result.current.fullTxDetails).toBeNull();
      expect(result.current.loadingDetails).toBe(true);

      await act(async () => {
        detailsB.resolve({ ...txB, inputs: [] });
        await detailsB.promise;
      });
      expect(result.current.fullTxDetails?.txid).toBe('txid-b');
      expect(result.current.loadingDetails).toBe(false);
    });

    it('ignores a stale detail failure after a newer selection starts', async () => {
      const txA = makeTx({ id: 'tx-a', txid: 'txid-a' });
      const txB = makeTx({ id: 'tx-b', txid: 'txid-b' });
      const detailsA = createDeferred<Transaction>();
      const detailsB = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockImplementation((_walletId, txid) => (
        txid === 'txid-a' ? detailsA.promise : detailsB.promise
      ));
      const { result } = renderTxHook(() =>
        useTransactionList({ transactions: [txA, txB] })
      );

      act(() => result.current.handleTxClick(txA));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-a', expect.any(Object)));
      act(() => result.current.handleTxClick(txB));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-b', expect.any(Object)));

      await act(async () => {
        detailsA.reject(new Error('stale detail failure'));
        await expect(detailsA.promise).rejects.toThrow('stale detail failure');
      });
      expect(result.current.loadingDetails).toBe(true);

      await act(async () => {
        detailsB.resolve({ ...txB, inputs: [] });
        await detailsB.promise;
      });
      expect(result.current.fullTxDetails?.txid).toBe('txid-b');
      expect(result.current.loadingDetails).toBe(false);
    });

    it('does not let late A overwrite details after B completes first', async () => {
      const txA = makeTx({ id: 'tx-a', txid: 'txid-a' });
      const txB = makeTx({ id: 'tx-b', txid: 'txid-b' });
      const detailsA = createDeferred<Transaction>();
      const detailsB = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockImplementation((_walletId, txid) => (
        txid === 'txid-a' ? detailsA.promise : detailsB.promise
      ));
      const { result } = renderTxHook(() =>
        useTransactionList({ transactions: [txA, txB] })
      );

      act(() => result.current.handleTxClick(txA));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-a', expect.any(Object)));
      act(() => result.current.handleTxClick(txB));
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('wallet-1', 'txid-b', expect.any(Object)));
      await act(async () => {
        detailsB.resolve({ ...txB, outputs: [] });
        await detailsB.promise;
      });
      expect(result.current.fullTxDetails?.txid).toBe('txid-b');

      await act(async () => {
        detailsA.resolve({ ...txA, outputs: [] });
        await detailsA.promise;
      });
      expect(result.current.selectedTx?.txid).toBe('txid-b');
      expect(result.current.fullTxDetails?.txid).toBe('txid-b');
      expect(result.current.loadingDetails).toBe(false);
    });

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

    it('resolves a valid off-page deep link through the wallet-scoped endpoint', async () => {
      const tx = makeTx({ id: 'tx-2', txid: VALID_TXID });
      vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce(tx);
      const { result } = renderTxHook(
        () => useTransactionList({ transactions: [], walletId: 'wallet-1' }),
        { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) },
      );

      expect(result.current.selectionStatus).toBe('loading');
      await waitFor(() => expect(result.current.selectedTx?.txid).toBe(VALID_TXID));
      expect(transactionsApi.getTransaction).toHaveBeenCalledWith(
        'wallet-1',
        VALID_TXID,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result.current.fullTxDetails).toEqual(tx);
      act(() => result.current.retrySelection());
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('shows a stable error when a valid deep link has no wallet context', async () => {
      const { result } = renderTxHook(
        () => useTransactionList({ transactions: [] }),
        { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) },
      );

      await waitFor(() => expect(result.current.selectionStatus).toBe('error'));
      expect(result.current.selectionError).toBe('Unable to determine the transaction wallet');
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('clears a deep link when the fetched transaction was replaced', async () => {
      vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce(
        makeTx({ txid: VALID_TXID, rbfStatus: 'replaced' }),
      );
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [], walletId: 'wallet-1' });
        const [params] = useSearchParams();
        return { list, txParam: params.get('tx') };
      }, { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) });

      await waitFor(() => expect(result.current.txParam).toBeNull());
      expect(result.current.list.selectedTx).toBeNull();
    });

    it('leaves selection empty for a ?tx that matches no transaction', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [tx] });
        const [params] = useSearchParams();
        return { list, txParam: params.get('tx') };
      }, { wrapper: makeRouterWrapper(['/?tx=does-not-exist&view=compact']) });

      await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
      await waitFor(() => expect(result.current.txParam).toBeNull());
      expect(result.current.list.selectedTx).toBeNull();
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('clears an empty or whitespace-only transaction URL parameter', async () => {
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [], walletId: 'wallet-1' });
        const [params, setParams] = useSearchParams();
        return { list, txParam: params.get('tx'), setParams };
      }, { wrapper: makeRouterWrapper(['/?tx=']) });

      await waitFor(() => expect(result.current.txParam).toBeNull());
      act(() => result.current.setParams({ tx: '   ' }));
      await waitFor(() => expect(result.current.txParam).toBeNull());
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('clears an invalid replacement while ignoring a late 404 from the prior deep link', async () => {
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValueOnce(deferred.promise);
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [], walletId: 'wallet-1' });
        const [params, setParams] = useSearchParams();
        return { list, txParam: params.get('tx'), setParams };
      }, { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) });

      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));
      const priorSignal = vi.mocked(transactionsApi.getTransaction).mock.calls[0][2]?.signal;
      act(() => result.current.setParams({ tx: 'invalid-replacement' }));

      await waitFor(() => expect(result.current.txParam).toBeNull());
      expect(priorSignal?.aborted).toBe(true);
      await act(async () => deferred.reject({ status: 404 }));
      expect(result.current.txParam).toBeNull();
      expect(result.current.list.selectionStatus).toBe('idle');
    });

    it('clears a current 404 but retains and retries a network failure', async () => {
      const tx = makeTx({ txid: VALID_TXID });
      vi.mocked(transactionsApi.getTransaction)
        .mockRejectedValueOnce({ status: 404 })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(tx);
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [], walletId: 'wallet-1' });
        const [params, setParams] = useSearchParams();
        return { list, txParam: params.get('tx'), setParams };
      }, { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) });

      await waitFor(() => expect(result.current.txParam).toBeNull());
      act(() => result.current.setParams({ tx: VALID_TXID }));
      await waitFor(() => expect(result.current.list.selectionStatus).toBe('error'));
      expect(result.current.txParam).toBe(VALID_TXID);

      act(() => result.current.list.retrySelection());
      await waitFor(() => expect(result.current.list.selectionStatus).toBe('resolved'));
      expect(result.current.txParam).toBe(VALID_TXID);
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(3);
    });

    it('aborts on unmount and does not duplicate a request when the row enters the list', async () => {
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { result, rerender, unmount } = renderTxHook(
        ({ rows }: { rows: Transaction[] }) => useTransactionList({
          transactions: rows,
          selectionTransactions: rows,
          walletId: 'wallet-1',
        }),
        {
          initialProps: { rows: [] as Transaction[] },
          wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]),
        },
      );
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));
      const signal = vi.mocked(transactionsApi.getTransaction).mock.calls[0][2]?.signal;

      rerender({ rows: [makeTx({ txid: VALID_TXID })] });
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.selectedTx?.txid).toBe(VALID_TXID);

      unmount();
      expect(signal?.aborted).toBe(true);
      deferred.resolve(makeTx({ txid: VALID_TXID }));
    });

    it('refreshes a resolved summary from list data without another detail request', async () => {
      const initial = makeTx({ id: 'tx-initial', txid: VALID_TXID, confirmations: 1 });
      const refreshed = { ...initial, confirmations: 2, label: 'refreshed' };
      vi.mocked(transactionsApi.getTransaction).mockResolvedValue(initial);
      const { result, rerender } = renderTxHook(
        ({ rows }: { rows: Transaction[] }) => useTransactionList({
          transactions: rows,
          selectionTransactions: rows,
          walletId: 'wallet-1',
        }),
        {
          initialProps: { rows: [initial] },
          wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]),
        },
      );
      await waitFor(() => expect(result.current.selectionStatus).toBe('resolved'));

      rerender({ rows: [refreshed] });
      await waitFor(() => expect(result.current.selectedTx).toMatchObject({
        confirmations: 2,
        label: 'refreshed',
      }));
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('preserves a refreshed local summary when the pending detail request resolves', async () => {
      const initial = makeTx({ id: 'tx-initial', txid: VALID_TXID, confirmations: 1 });
      const refreshed = { ...initial, confirmations: 2, label: 'refreshed' };
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { result, rerender } = renderTxHook(
        ({ rows }: { rows: Transaction[] }) => useTransactionList({
          transactions: rows,
          selectionTransactions: rows,
          walletId: 'wallet-1',
        }),
        {
          initialProps: { rows: [initial] },
          wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]),
        },
      );
      await waitFor(() => expect(result.current.selectionStatus).toBe('loading'));

      rerender({ rows: [refreshed] });
      await waitFor(() => expect(result.current.selectedTx).toBe(refreshed));
      await act(async () => deferred.resolve(makeTx({
        id: 'tx-detail',
        txid: VALID_TXID,
        confirmations: 3,
      })));

      await waitFor(() => expect(result.current.selectionStatus).toBe('resolved'));
      expect(result.current.selectedTx).toBe(refreshed);
      expect(result.current.fullTxDetails?.confirmations).toBe(3);
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('aborts an in-flight detail request when the tx URL parameter is cleared', async () => {
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [], walletId: 'wallet-1' });
        const [, setParams] = useSearchParams();
        return { list, setParams };
      }, { wrapper: makeRouterWrapper([`/?tx=${VALID_TXID}`]) });

      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));
      const signal = vi.mocked(transactionsApi.getTransaction).mock.calls[0][2]?.signal;
      act(() => result.current.setParams({}));

      await waitFor(() => expect(result.current.list.selectionStatus).toBe('idle'));
      expect(signal?.aborted).toBe(true);
      deferred.resolve(makeTx({ txid: VALID_TXID }));
    });

    it('clears a valid selection when the URL changes to an unresolved transaction', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const { result } = renderTxHook(() => {
        const list = useTransactionList({ transactions: [tx] });
        const [, setParams] = useSearchParams();
        return { list, setParams };
      }, {
        wrapper: makeRouterWrapper(['/?tx=txid-1']),
      });
      await waitFor(() => expect(result.current.list.selectedTx?.txid).toBe('txid-1'));

      act(() => result.current.setParams({ tx: 'missing-txid' }));

      await waitFor(() => expect(result.current.list.selectedTx).toBeNull());
      expect(result.current.list.fullTxDetails).toBeNull();
    });

    it('clears a selected transaction when it becomes replaced', async () => {
      const tx = makeTx({ id: 'tx-1', txid: 'txid-1' });
      const { result, rerender } = renderTxHook(
        ({ transactions }: { transactions: Transaction[] }) =>
          useTransactionList({ transactions }),
        {
          initialProps: { transactions: [tx] },
          wrapper: makeRouterWrapper(['/?tx=txid-1']),
        },
      );
      await waitFor(() => expect(result.current.selectedTx?.txid).toBe('txid-1'));

      rerender({ transactions: [{ ...tx, rbfStatus: 'replaced' }] });

      await waitFor(() => expect(result.current.selectedTx).toBeNull());
      expect(result.current.filteredTransactions).toEqual([]);
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
