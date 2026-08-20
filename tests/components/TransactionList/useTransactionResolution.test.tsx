import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransactionResolution } from '../../../src/components/TransactionList/hooks/useTransactionResolution';
import * as transactionsApi from '../../../src/api/transactions';
import type { Transaction } from '../../../src/types';

/**
 * One resolver per open detail tab.
 *
 * The previous shape was a single slot switched between transactions, and every
 * race it had to police — a stale response landing after a newer selection —
 * came from that sharing. Here the identity is structural: each hook instance
 * owns one txid for its whole life, so those tests are about two *instances*
 * not disturbing each other rather than about generation counters.
 */

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

const VALID_TXID = 'a'.repeat(64);
const OTHER_TXID = 'b'.repeat(64);

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  txid: VALID_TXID,
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 1,
  labels: [],
  ...overrides,
} as Transaction);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface HarnessProps {
  txid?: string;
  rows?: Transaction[];
  /** `null` means "no wallet context", which a destructuring default cannot express. */
  walletId?: string | null;
}

function renderResolution(initialProps: HarnessProps = {}) {
  const onUnresolvable = vi.fn();
  const view = renderHook(
    ({ txid = VALID_TXID, rows = [], walletId = 'wallet-1' }: HarnessProps) =>
      useTransactionResolution({
        txid,
        selectionTransactions: rows,
        walletId: walletId ?? undefined,
        onUnresolvable,
      }),
    { initialProps },
  );
  return { ...view, onUnresolvable };
}

const lastSignal = () =>
  vi.mocked(transactionsApi.getTransaction).mock.calls.at(-1)?.[2]?.signal;

describe('useTransactionResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue(makeTx());
  });

  it('resolves its transaction through the wallet-scoped endpoint', async () => {
    const tx = makeTx();
    vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce(tx);

    const { result } = renderResolution();

    expect(result.current.selection.status).toBe('loading');
    await waitFor(() => expect(result.current.selection.status).toBe('resolved'));
    expect(transactionsApi.getTransaction).toHaveBeenCalledWith(
      'wallet-1',
      VALID_TXID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.selection.fullTxDetails).toEqual(tx);
  });

  it('does nothing on retry once resolved', async () => {
    const { result } = renderResolution();
    await waitFor(() => expect(result.current.selection.status).toBe('resolved'));

    act(() => result.current.retry());

    expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
  });

  it('shows a stable error, and asks for nothing, without a wallet to ask about', async () => {
    const { result } = renderResolution({ walletId: null });

    await waitFor(() => expect(result.current.selection.status).toBe('error'));
    expect(result.current.selection.error).toBe('Unable to determine the transaction wallet');
    expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
  });

  it('takes the wallet from the local row when the list is not wallet-scoped', async () => {
    const tx = makeTx({ walletId: 'wallet-9' });

    renderResolution({ walletId: null, rows: [tx] });

    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith(
      'wallet-9',
      VALID_TXID,
      expect.any(Object),
    ));
  });

  describe('transactions that cannot be shown', () => {
    it('reports a malformed txid without asking the server', async () => {
      const { result, onUnresolvable } = renderResolution({ txid: 'not-a-txid' });

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith('not-a-txid'));
      expect(result.current.selection.status).toBe('not-found');
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('reports an empty or whitespace-only txid', async () => {
      const { onUnresolvable } = renderResolution({ txid: '   ' });

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith(''));
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('reports a row that the list already knows was replaced', async () => {
      const { onUnresolvable } = renderResolution({
        rows: [makeTx({ rbfStatus: 'replaced' })],
      });

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith(VALID_TXID));
      expect(transactionsApi.getTransaction).not.toHaveBeenCalled();
    });

    it('reports a transaction the server says was replaced', async () => {
      vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce(
        makeTx({ rbfStatus: 'replaced' }),
      );

      const { result, onUnresolvable } = renderResolution();

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith(VALID_TXID));
      expect(result.current.selection.status).toBe('not-found');
      expect(result.current.selection.selectedTx).toBeNull();
    });

    it('reports a transaction the server has never heard of', async () => {
      vi.mocked(transactionsApi.getTransaction).mockRejectedValueOnce({ status: 404 });

      const { result, onUnresolvable } = renderResolution();

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith(VALID_TXID));
      expect(result.current.selection.status).toBe('not-found');
    });

    it('reports a row that becomes replaced while it is open', async () => {
      const tx = makeTx();
      const { rerender, onUnresolvable } = renderResolution({ rows: [tx] });
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalled());

      rerender({ rows: [{ ...tx, rbfStatus: 'replaced' }] });

      await waitFor(() => expect(onUnresolvable).toHaveBeenCalledWith(VALID_TXID));
    });
  });

  describe('failures the user can act on', () => {
    it('keeps a network failure on screen and retries it', async () => {
      vi.mocked(transactionsApi.getTransaction)
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(makeTx());

      const { result, onUnresolvable } = renderResolution();
      await waitFor(() => expect(result.current.selection.status).toBe('error'));
      expect(result.current.selection.error).toBe('offline');
      // A network failure is not evidence the transaction is gone, so the tab
      // stays open with a retry rather than closing itself.
      expect(onUnresolvable).not.toHaveBeenCalled();

      act(() => result.current.retry());

      await waitFor(() => expect(result.current.selection.status).toBe('resolved'));
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(2);
    });

    it('keeps the summary row visible behind the error', async () => {
      vi.mocked(transactionsApi.getTransaction).mockRejectedValueOnce(new Error('offline'));
      const tx = makeTx();

      const { result } = renderResolution({ rows: [tx] });

      await waitFor(() => expect(result.current.selection.status).toBe('error'));
      expect(result.current.selection.selectedTx).toBe(tx);
    });
  });

  describe('requests in flight', () => {
    it('aborts on unmount', async () => {
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { unmount } = renderResolution();
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));
      const signal = lastSignal();

      unmount();

      expect(signal?.aborted).toBe(true);
      deferred.resolve(makeTx());
    });

    it('does not re-request when the row arrives in the list mid-flight', async () => {
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { result, rerender } = renderResolution({ rows: [] });
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));

      rerender({ rows: [makeTx()] });

      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.selection.selectedTx?.txid).toBe(VALID_TXID);
      deferred.resolve(makeTx());
    });

    it('refreshes a resolved summary from list data without asking again', async () => {
      const initial = makeTx({ confirmations: 1 });
      const refreshed = { ...initial, confirmations: 2 };
      const { result, rerender } = renderResolution({ rows: [initial] });
      await waitFor(() => expect(result.current.selection.status).toBe('resolved'));

      rerender({ rows: [refreshed] });

      await waitFor(() => expect(result.current.selection.selectedTx).toBe(refreshed));
      expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('keeps a refreshed summary when the pending detail lands', async () => {
      const initial = makeTx({ confirmations: 1 });
      const refreshed = { ...initial, confirmations: 2 };
      const deferred = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
      const { result, rerender } = renderResolution({ rows: [initial] });
      await waitFor(() => expect(result.current.selection.status).toBe('loading'));

      rerender({ rows: [refreshed] });
      await waitFor(() => expect(result.current.selection.selectedTx).toBe(refreshed));
      await act(async () => deferred.resolve(makeTx({ confirmations: 3 })));

      await waitFor(() => expect(result.current.selection.status).toBe('resolved'));
      expect(result.current.selection.selectedTx).toBe(refreshed);
      expect(result.current.selection.fullTxDetails?.confirmations).toBe(3);
    });
  });

  describe('two open tabs', () => {
    it('resolve independently, and a late response reaches only its own tab', async () => {
      // The race the old single-slot resolver existed to police. Two panels are
      // two instances, so a slow response has no path to the other one.
      const slow = createDeferred<Transaction>();
      const fast = createDeferred<Transaction>();
      vi.mocked(transactionsApi.getTransaction).mockImplementation((_wallet, txid) => (
        txid === VALID_TXID ? slow.promise : fast.promise
      ));

      const first = renderResolution();
      const second = renderResolution({ txid: OTHER_TXID });
      await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(2));

      await act(async () => {
        fast.resolve(makeTx({ id: 'tx-second', txid: OTHER_TXID, confirmations: 9 }));
        await fast.promise;
      });
      expect(second.result.current.selection.fullTxDetails?.txid).toBe(OTHER_TXID);
      expect(first.result.current.selection.status).toBe('loading');
      expect(first.result.current.selection.fullTxDetails).toBeNull();

      await act(async () => {
        slow.resolve(makeTx({ confirmations: 4 }));
        await slow.promise;
      });
      expect(first.result.current.selection.fullTxDetails?.txid).toBe(VALID_TXID);
      expect(second.result.current.selection.fullTxDetails?.confirmations).toBe(9);
    });

    it('a failure in one leaves the other resolved', async () => {
      vi.mocked(transactionsApi.getTransaction).mockImplementation((_wallet, txid) => (
        txid === VALID_TXID
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(makeTx({ txid: OTHER_TXID }))
      ));

      const failing = renderResolution();
      const healthy = renderResolution({ txid: OTHER_TXID });

      await waitFor(() => expect(failing.result.current.selection.status).toBe('error'));
      await waitFor(() => expect(healthy.result.current.selection.status).toBe('resolved'));
    });
  });

  describe('patchSelectedTxLabels', () => {
    it('applies labels to the transaction the caller meant', async () => {
      const { result } = renderResolution();
      await waitFor(() => expect(result.current.selection.status).toBe('resolved'));
      const { key } = result.current.selection;
      const labels = [{ id: 'lbl-1', name: 'Cold storage' }] as Transaction['labels'];

      act(() => result.current.patchSelectedTxLabels(key!, 'tx-1', labels));

      expect(result.current.selection.selectedTx?.labels).toBe(labels);
    });

    it('ignores a patch aimed at a different transaction or a stale resolution', async () => {
      // The guard that keeps a label save that finished late from writing onto
      // whatever the panel is showing now.
      const { result } = renderResolution();
      await waitFor(() => expect(result.current.selection.status).toBe('resolved'));
      const { key } = result.current.selection;
      const labels = [{ id: 'lbl-1', name: 'Cold storage' }] as Transaction['labels'];

      act(() => result.current.patchSelectedTxLabels(key!, 'tx-other', labels));
      expect(result.current.selection.selectedTx?.labels).toEqual([]);

      act(() => result.current.patchSelectedTxLabels('wallet-1:stale', 'tx-1', labels));
      expect(result.current.selection.selectedTx?.labels).toEqual([]);
    });
  });

  it('ignores an abort rejection for the request it still owns', async () => {
    // React 18 double-invokes effects in development, and a cleanup can abort a
    // request whose rejection arrives while the slot still looks current.
    const deferred = createDeferred<Transaction>();
    vi.mocked(transactionsApi.getTransaction).mockReturnValue(deferred.promise);
    const { result } = renderResolution();
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledTimes(1));

    await act(async () => {
      deferred.reject(new DOMException('aborted', 'AbortError'));
      await deferred.promise.catch(() => undefined);
    });

    // Still loading: an abort is not a failure to report to the user.
    expect(result.current.selection.status).toBe('loading');
    expect(result.current.selection.error).toBeNull();
  });
});
