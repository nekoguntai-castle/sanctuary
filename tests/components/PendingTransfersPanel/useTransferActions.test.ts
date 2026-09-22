import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  promise: Promise<T>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

const mockGetTransfers = vi.fn();
const mockAcceptTransfer = vi.fn();
const mockDeclineTransfer = vi.fn();
const mockCancelTransfer = vi.fn();
const mockConfirmTransfer = vi.fn();

vi.mock('../../../src/api/transfers', () => ({
  getTransfers: (...args: unknown[]) => mockGetTransfers(...args),
  acceptTransfer: (...args: unknown[]) => mockAcceptTransfer(...args),
  declineTransfer: (...args: unknown[]) => mockDeclineTransfer(...args),
  cancelTransfer: (...args: unknown[]) => mockCancelTransfer(...args),
  confirmTransfer: (...args: unknown[]) => mockConfirmTransfer(...args),
}));

vi.mock('../../../src/api/client', () => {
  class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError };
});

vi.mock('../../../src/contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'user-1' } }),
}));

import { useTransferActions } from '../../../src/components/PendingTransfersPanel/useTransferActions';
import { ApiError } from '../../../src/api/client';

const makeTransfer = (overrides = {}) => ({
  id: 'transfer-1',
  resourceType: 'wallet',
  resourceId: 'wallet-1',
  fromUserId: 'user-1',
  toUserId: 'user-2',
  status: 'pending',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  acceptedAt: null,
  confirmedAt: null,
  cancelledAt: null,
  expiresAt: '2026-02-01',
  message: null,
  declineReason: null,
  keepExistingUsers: false,
  ...overrides,
});

describe('useTransferActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTransfers.mockResolvedValue({ transfers: [] });
  });

  it('returns initial state and fetches on mount', async () => {
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.confirmModal).toBeNull();
    expect(result.current.declineReason).toBe('');
    expect(result.current.actionLoading).toBeNull();
    expect(result.current.hasTransfers).toBe(false);
    expect(mockGetTransfers).toHaveBeenCalledWith({
      status: 'active',
      resourceType: 'wallet',
    });
  });

  it('categorizes incoming, outgoing, and awaiting transfers', async () => {
    mockGetTransfers.mockResolvedValue({
      transfers: [
        makeTransfer({ id: 't1', toUserId: 'user-1', fromUserId: 'user-2', status: 'pending' }),
        makeTransfer({ id: 't2', fromUserId: 'user-1', toUserId: 'user-2', status: 'pending' }),
        makeTransfer({ id: 't3', fromUserId: 'user-1', toUserId: 'user-2', status: 'accepted' }),
      ],
    });

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => {
      expect(result.current.hasTransfers).toBe(true);
    });

    expect(result.current.incomingPending).toHaveLength(1);
    expect(result.current.outgoingPending).toHaveLength(1);
    expect(result.current.awaitingConfirmation).toHaveLength(1);
  });

  it('filters transfers by resourceId', async () => {
    mockGetTransfers.mockResolvedValue({
      transfers: [
        makeTransfer({ id: 't1', resourceId: 'wallet-1', toUserId: 'user-1' }),
        makeTransfer({ id: 't2', resourceId: 'wallet-other', toUserId: 'user-1' }),
      ],
    });

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => {
      expect(result.current.incomingPending).toHaveLength(1);
    });

    expect(result.current.incomingPending[0].id).toBe('t1');
  });

  it('handleAccept calls API and refreshes', async () => {
    mockAcceptTransfer.mockResolvedValue({});

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleAccept('t1');
    });

    expect(mockAcceptTransfer).toHaveBeenCalledWith('t1');
    // Refreshes transfers after action
    expect(mockGetTransfers).toHaveBeenCalledTimes(2);
  });

  it('handleDecline sends reason', async () => {
    mockDeclineTransfer.mockResolvedValue({});

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDeclineReason('Not needed'));

    await act(async () => {
      await result.current.handleDecline('t1');
    });

    expect(mockDeclineTransfer).toHaveBeenCalledWith('t1', { reason: 'Not needed' });
  });

  it('handleDecline sends undefined reason when empty', async () => {
    mockDeclineTransfer.mockResolvedValue({});

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleDecline('t1');
    });

    expect(mockDeclineTransfer).toHaveBeenCalledWith('t1', { reason: undefined });
  });

  it('handleCancel calls cancelTransfer API', async () => {
    mockCancelTransfer.mockResolvedValue({});

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleCancel('t1');
    });

    expect(mockCancelTransfer).toHaveBeenCalledWith('t1');
  });

  it('handleConfirm calls confirmTransfer and onTransferComplete', async () => {
    mockConfirmTransfer.mockResolvedValue({});
    const onTransferComplete = vi.fn().mockResolvedValue({ status: 'committed' });

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1', onTransferComplete),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleConfirm('t1');
    });

    expect(mockConfirmTransfer).toHaveBeenCalledWith('t1');
    expect(onTransferComplete).toHaveBeenCalled();
  });

  it('keeps confirmation pending until the ownership refresh settles', async () => {
    const completion = createDeferred<{ status: 'committed' }>();
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers.mockResolvedValueOnce({
      transfers: [makeTransfer({ id: 't1', status: 'accepted' })],
    });
    const onTransferComplete = vi.fn().mockReturnValue(completion.promise);
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1', onTransferComplete),
    );

    await waitFor(() => expect(result.current.awaitingConfirmation).toHaveLength(1));
    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'confirm' }));

    let action!: Promise<void>;
    act(() => {
      action = result.current.handleConfirm('t1');
    });
    await waitFor(() => expect(onTransferComplete).toHaveBeenCalledTimes(1));

    expect(result.current.actionLoading).toBe('t1');
    expect(result.current.confirmModal).toEqual({ transferId: 't1', action: 'confirm' });
    expect(mockGetTransfers).toHaveBeenCalledTimes(1);

    await act(async () => {
      completion.resolve({ status: 'committed' });
      await action;
    });

    expect(result.current.actionLoading).toBeNull();
    expect(result.current.confirmModal).toBeNull();
    expect(mockGetTransfers).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['returns failed', () => Promise.resolve({ status: 'failed', error: new Error('share refresh') } as const)],
    ['rejects', () => Promise.reject(new Error('share refresh'))],
  ])('removes the committed transfer when the completion callback %s', async (_label, completion) => {
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers
      .mockResolvedValueOnce({ transfers: [makeTransfer({ id: 't1', status: 'accepted' })] })
      .mockResolvedValueOnce({ transfers: [] });
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1', completion),
    );

    await waitFor(() => expect(result.current.awaitingConfirmation).toHaveLength(1));
    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'confirm' }));
    await act(async () => {
      await result.current.handleConfirm('t1');
    });

    expect(result.current.awaitingConfirmation).toHaveLength(0);
    expect(result.current.confirmModal).toBeNull();
    expect(result.current.error).toBe(
      'Transfer action completed, but related access details could not be refreshed.',
    );
    expect(mockConfirmTransfer).toHaveBeenCalledTimes(1);
    expect(mockGetTransfers).toHaveBeenCalledTimes(2);
  });

  it('removes a committed transfer and reports a list reconciliation failure', async () => {
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers
      .mockResolvedValueOnce({ transfers: [makeTransfer({ id: 't1', status: 'accepted' })] })
      .mockRejectedValueOnce(new Error('list refresh failed'));
    const onTransferComplete = vi.fn().mockResolvedValue({ status: 'committed' });
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1', onTransferComplete),
    );

    await waitFor(() => expect(result.current.awaitingConfirmation).toHaveLength(1));
    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'confirm' }));
    await act(async () => {
      await result.current.handleConfirm('t1');
    });

    expect(result.current.awaitingConfirmation).toHaveLength(0);
    expect(result.current.confirmModal).toBeNull();
    expect(result.current.error).toBe(
      'Transfer action completed, but pending transfers could not be refreshed.',
    );
    expect(mockConfirmTransfer).toHaveBeenCalledTimes(1);
  });

  it('does not write callback settlement into a replacement resource', async () => {
    const completion = createDeferred<{ status: 'superseded' }>();
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers.mockResolvedValue({ transfers: [] });
    const onTransferComplete = vi.fn().mockReturnValue(completion.promise);
    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) =>
        useTransferActions('wallet', resourceId, onTransferComplete),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'confirm' }));
    let action!: Promise<void>;
    act(() => {
      action = result.current.handleConfirm('t1');
    });
    await waitFor(() => expect(onTransferComplete).toHaveBeenCalledTimes(1));
    rerender({ resourceId: 'wallet-B' });

    await act(async () => {
      completion.resolve({ status: 'superseded' });
      await action;
    });

    expect(result.current.confirmModal).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.actionLoading).toBeNull();
    expect(mockGetTransfers).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale callback regain ownership after an A-B-A resource cycle', async () => {
    const completion = createDeferred<{ status: 'committed' }>();
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers
      .mockResolvedValueOnce({
        transfers: [makeTransfer({ id: 'old-A', resourceId: 'wallet-A', status: 'accepted' })],
      })
      .mockResolvedValueOnce({ transfers: [] })
      .mockResolvedValueOnce({
        transfers: [makeTransfer({ id: 'new-A', resourceId: 'wallet-A', status: 'accepted' })],
      });
    const onTransferComplete = vi.fn().mockReturnValue(completion.promise);
    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) =>
        useTransferActions('wallet', resourceId, onTransferComplete),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.awaitingConfirmation[0]?.id).toBe('old-A'));
    let action!: Promise<void>;
    act(() => {
      action = result.current.handleConfirm('old-A');
    });
    await waitFor(() => expect(onTransferComplete).toHaveBeenCalledTimes(1));
    rerender({ resourceId: 'wallet-B' });
    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(2));
    rerender({ resourceId: 'wallet-A' });
    await waitFor(() => expect(result.current.awaitingConfirmation[0]?.id).toBe('new-A'));

    await act(async () => {
      completion.resolve({ status: 'committed' });
      await action;
    });

    expect(result.current.awaitingConfirmation[0]?.id).toBe('new-A');
    expect(result.current.error).toBeNull();
    expect(mockGetTransfers).toHaveBeenCalledTimes(3);
  });

  it('does not let a stale list refresh regain ownership after an A-B-A resource cycle', async () => {
    const staleRefresh = createDeferred<{ transfers: ReturnType<typeof makeTransfer>[] }>();
    mockConfirmTransfer.mockResolvedValue({});
    mockGetTransfers
      .mockResolvedValueOnce({
        transfers: [makeTransfer({ id: 't1', resourceId: 'wallet-A', status: 'accepted' })],
      })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ transfers: [] })
      .mockResolvedValueOnce({
        transfers: [makeTransfer({ id: 'new-A', resourceId: 'wallet-A', status: 'accepted' })],
      });
    const onTransferComplete = vi.fn().mockResolvedValue({ status: 'committed' });
    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) =>
        useTransferActions('wallet', resourceId, onTransferComplete),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.awaitingConfirmation).toHaveLength(1));
    let action!: Promise<void>;
    act(() => {
      action = result.current.handleConfirm('t1');
    });
    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(2));

    rerender({ resourceId: 'wallet-B' });
    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(3));
    rerender({ resourceId: 'wallet-A' });
    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.awaitingConfirmation[0]?.id).toBe('new-A'));
    await act(async () => {
      staleRefresh.resolve({
        transfers: [makeTransfer({ id: 'old-A', resourceId: 'wallet-A', status: 'accepted' })],
      });
      await action;
    });

    expect(result.current.actionLoading).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.awaitingConfirmation[0]?.id).toBe('new-A');
  });

  it('sets a load error when fetching transfers fails for the current resource', async () => {
    mockGetTransfers.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('network down');
  });

  it('sets error on ApiError failure', async () => {
    mockAcceptTransfer.mockRejectedValue(new (ApiError as unknown as new (msg: string) => Error)('Transfer expired'));

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleAccept('t1');
    });

    expect(result.current.error).toBe('Transfer expired');
  });

  it('sets fallback error for non-ApiError failures', async () => {
    mockAcceptTransfer.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleAccept('t1');
    });

    expect(result.current.error).toBe('Failed to accept transfer');
  });

  it('manages confirmModal state', async () => {
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'accept' }));
    expect(result.current.confirmModal).toEqual({ transferId: 't1', action: 'accept' });

    act(() => result.current.setConfirmModal(null));
    expect(result.current.confirmModal).toBeNull();
  });

  it('manages declineReason state', async () => {
    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDeclineReason('Too busy'));
    expect(result.current.declineReason).toBe('Too busy');
  });

  it('clears confirmModal after successful action', async () => {
    mockAcceptTransfer.mockResolvedValue({});

    const { result } = renderHook(() =>
      useTransferActions('wallet', 'wallet-1'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setConfirmModal({ transferId: 't1', action: 'accept' }));

    await act(async () => {
      await result.current.handleAccept('t1');
    });

    expect(result.current.confirmModal).toBeNull();
  });

  it('clears the list synchronously when the resource switches, before any refetch resolves', async () => {
    mockGetTransfers.mockResolvedValue({
      transfers: [makeTransfer({ id: 'a1', resourceId: 'wallet-A', toUserId: 'user-1' })],
    });

    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) => useTransferActions('wallet', resourceId),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.incomingPending).toHaveLength(1));

    // Switching resources must clear the previous resource's data
    // synchronously (no leftover A data shown even for a single paint),
    // before the new fetch for B has had any chance to resolve.
    rerender({ resourceId: 'wallet-B' });
    expect(result.current.incomingPending).toHaveLength(0);

    // Let B's refetch (also resolving to the same fixture data, filtered
    // out by resourceId) settle within act before the test ends.
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('scopes fetched transfers to the currently mounted resource when a stale fetch resolves late', async () => {
    const deferreds: Deferred<{ transfers: ReturnType<typeof makeTransfer>[] }>[] = [];
    mockGetTransfers.mockImplementation(() => {
      const deferred = createDeferred<{ transfers: ReturnType<typeof makeTransfer>[] }>();
      deferreds.push(deferred);
      return deferred.promise;
    });

    const { result, rerender } = renderHook(
      ({ resourceType, resourceId }: { resourceType: 'wallet' | 'device'; resourceId: string }) =>
        useTransferActions(resourceType, resourceId),
      { initialProps: { resourceType: 'wallet' as const, resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(1));

    // Switch to resource B while A's fetch is still pending.
    rerender({ resourceType: 'wallet', resourceId: 'wallet-B' });

    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(2));

    // Resolve B's fetch first, then A's stale fetch late.
    await act(async () => {
      deferreds[1].resolve({
        transfers: [makeTransfer({ id: 'b1', resourceId: 'wallet-B', toUserId: 'user-1' })],
      });
    });
    await act(async () => {
      deferreds[0].resolve({
        transfers: [makeTransfer({ id: 'a1', resourceId: 'wallet-A', toUserId: 'user-1' })],
      });
    });

    await waitFor(() => expect(result.current.incomingPending).toHaveLength(1));
    expect(result.current.incomingPending[0].id).toBe('b1');
  });

  it('does not surface a stale load error when the resource switches before the fetch rejects', async () => {
    const deferreds: Deferred<{ transfers: ReturnType<typeof makeTransfer>[] }>[] = [];
    mockGetTransfers.mockImplementation(() => {
      const deferred = createDeferred<{ transfers: ReturnType<typeof makeTransfer>[] }>();
      deferreds.push(deferred);
      return deferred.promise;
    });

    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) => useTransferActions('wallet', resourceId),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(1));

    // Switch to resource B while A's fetch is still pending, then let B's
    // fetch resolve successfully before A's stale fetch rejects.
    rerender({ resourceId: 'wallet-B' });

    await waitFor(() => expect(mockGetTransfers).toHaveBeenCalledTimes(2));

    await act(async () => {
      deferreds[1].resolve({ transfers: [] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      deferreds[0].reject(new Error('stale wallet-A fetch failure'));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('does not invoke onTransferComplete when the resource switches before confirm resolves', async () => {
    const confirmDeferred = createDeferred<unknown>();
    mockConfirmTransfer.mockReturnValue(confirmDeferred.promise);
    const onTransferComplete = vi.fn();

    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) =>
        useTransferActions('wallet', resourceId, onTransferComplete),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    let actionPromise!: Promise<void>;
    act(() => {
      actionPromise = result.current.handleConfirm('t1');
    });

    // Switch resources while the confirm call is still in flight.
    rerender({ resourceId: 'wallet-B' });

    await act(async () => {
      confirmDeferred.resolve({});
      await actionPromise;
    });

    expect(onTransferComplete).not.toHaveBeenCalled();
  });

  it('does not surface a stale action error when the resource switches before the call rejects', async () => {
    const acceptDeferred = createDeferred<unknown>();
    mockAcceptTransfer.mockReturnValue(acceptDeferred.promise);

    const { result, rerender } = renderHook(
      ({ resourceId }: { resourceId: string }) => useTransferActions('wallet', resourceId),
      { initialProps: { resourceId: 'wallet-A' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    let actionPromise!: Promise<void>;
    act(() => {
      actionPromise = result.current.handleAccept('t1');
    });

    // Switch resources while the accept call is still in flight.
    rerender({ resourceId: 'wallet-B' });

    await act(async () => {
      acceptDeferred.reject(new Error('stale failure'));
      await actionPromise;
    });

    expect(result.current.error).toBeNull();
  });
});
