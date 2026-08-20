import {
  act,
  renderHook,
  waitFor,
  type RenderHookOptions,
  type RenderHookResult,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useTransactionList } from '../../../src/components/TransactionList/hooks/useTransactionList';
import {
  isAbortError,
  selectionErrorMessage,
} from '../../../src/components/TransactionList/hooks/selectionResolution';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as labelsApi from '../../../src/api/labels';
import type { TransactionStats } from '../../../src/api/transactions';
import * as transactionsApi from '../../../src/api/transactions';
import type { Transaction } from '../../../src/types';

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

vi.mock('../../../src/utils/logger', () => ({
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

  it('survives an explorer-status failure and covers clipboard success/fallback timeout paths', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('status failed'));
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

    await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());

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


  it('finds the row behind an open tab, and reports one it does not have', () => {
    // The tab strip labels a tab from its row; a tab opened by deep link before
    // the page loads has no row yet.
    const tx = makeTx({ id: 'tx-known', txid: VALID_TXID });
    const { result } = renderTxHook(() => useTransactionList({ transactions: [tx] }));

    expect(result.current.findTransaction(VALID_TXID.toUpperCase())).toBe(tx);
    expect(result.current.findTransaction('b'.repeat(64))).toBeNull();
  });
});
