import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'user-1' } }),
}));

import { useTransferActions } from '../../../components/PendingTransfersPanel/useTransferActions';
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
    const onTransferComplete = vi.fn();

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
});
