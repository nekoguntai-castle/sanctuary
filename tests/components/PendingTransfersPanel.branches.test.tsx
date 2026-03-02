import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingTransfersPanel } from '../../components/PendingTransfersPanel';
import { ApiError } from '../../src/api/client';
import * as transfersApi from '../../src/api/transfers';
import type { Transfer } from '../../types';

vi.mock('../../src/api/transfers', () => ({
  getTransfers: vi.fn(),
  acceptTransfer: vi.fn(),
  declineTransfer: vi.fn(),
  cancelTransfer: vi.fn(),
  confirmTransfer: vi.fn(),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: {
      id: 'current-user',
      username: 'currentuser',
    },
  }),
}));

const baseTransfer = (overrides: Partial<Transfer>): Transfer => ({
  id: 'transfer-0',
  resourceType: 'wallet',
  resourceId: 'wallet-123',
  fromUserId: 'other-user',
  toUserId: 'current-user',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  acceptedAt: null,
  confirmedAt: null,
  cancelledAt: null,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  message: null,
  declineReason: null,
  keepExistingUsers: false,
  fromUser: { id: 'other-user', username: 'otheruser' },
  toUser: { id: 'current-user', username: 'currentuser' },
  ...overrides,
});

const defaultProps = {
  resourceType: 'wallet' as const,
  resourceId: 'wallet-123',
  onTransferComplete: vi.fn(),
};

const getIncomingCard = () =>
  screen.getByText('Incoming Transfer Request').closest('div.surface-elevated') as HTMLElement;
const getOutgoingCard = () =>
  screen.getByText('Awaiting Response').closest('div.surface-elevated') as HTMLElement;
const getAwaitingConfirmCard = () =>
  screen.getByText('Ready to Confirm').closest('div.surface-elevated') as HTMLElement;

describe('PendingTransfersPanel branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transfersApi.acceptTransfer).mockResolvedValue({} as any);
    vi.mocked(transfersApi.declineTransfer).mockResolvedValue({} as any);
    vi.mocked(transfersApi.cancelTransfer).mockResolvedValue({} as any);
    vi.mocked(transfersApi.confirmTransfer).mockResolvedValue({} as any);
  });

  it('covers relative-time and expiry formatting branches including acceptedAt fallback', async () => {
    const now = Date.now();
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [
        baseTransfer({
          id: 'incoming-just-now',
          fromUserId: 'other-user',
          toUserId: 'current-user',
          status: 'pending',
          createdAt: new Date(now - 15_000).toISOString(),
          expiresAt: new Date(now - 3_600_000).toISOString(),
        }),
        baseTransfer({
          id: 'outgoing-minutes',
          fromUserId: 'current-user',
          toUserId: 'recipient-1',
          status: 'pending',
          createdAt: new Date(now - 30 * 60_000).toISOString(),
          expiresAt: new Date(now + 5 * 3_600_000).toISOString(),
          toUser: { id: 'recipient-1', username: 'recipient1' },
        }),
        baseTransfer({
          id: 'outgoing-days',
          fromUserId: 'current-user',
          toUserId: 'recipient-2',
          status: 'pending',
          createdAt: new Date(now - 3 * 24 * 3_600_000).toISOString(),
          expiresAt: new Date(now + 4 * 24 * 3_600_000).toISOString(),
          toUser: { id: 'recipient-2', username: 'recipient2' },
        }),
        baseTransfer({
          id: 'accepted-fallback',
          fromUserId: 'current-user',
          toUserId: 'recipient-3',
          status: 'accepted',
          acceptedAt: null,
          updatedAt: new Date(now - 90 * 60_000).toISOString(),
          expiresAt: new Date(now + 3 * 24 * 3_600_000).toISOString(),
          toUser: { id: 'recipient-3', username: 'recipient3' },
        }),
      ],
      total: 4,
    });

    render(<PendingTransfersPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
    });

    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('Initiated 30m ago')).toBeInTheDocument();
    expect(screen.getByText(/^Initiated \d+d ago$/)).toBeInTheDocument();
    expect(screen.getByText(/^Accepted \d+h ago$/)).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getAllByText(/\d+h remaining$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d+d remaining$/).length).toBeGreaterThan(1);
  });

  it('covers decline-empty-reason plus modal cancellation paths for decline/cancel/confirm', async () => {
    const now = Date.now();
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [
        baseTransfer({
          id: 'incoming-1',
          createdAt: new Date(now - 3_600_000).toISOString(),
          expiresAt: new Date(now + 24 * 3_600_000).toISOString(),
        }),
        baseTransfer({
          id: 'outgoing-1',
          fromUserId: 'current-user',
          toUserId: 'recipient-1',
          status: 'pending',
          toUser: { id: 'recipient-1', username: 'recipient1' },
        }),
        baseTransfer({
          id: 'accepted-1',
          fromUserId: 'current-user',
          toUserId: 'recipient-2',
          status: 'accepted',
          acceptedAt: new Date(now - 3_600_000).toISOString(),
          toUser: { id: 'recipient-2', username: 'recipient2' },
        }),
      ],
      total: 3,
    });

    render(<PendingTransfersPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
    });

    // Empty reason path: declineReason.trim() || undefined.
    fireEvent.click(within(getIncomingCard()).getByRole('button', { name: /Decline/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline Transfer' }));
    await waitFor(() => {
      expect(transfersApi.declineTransfer).toHaveBeenCalledWith('incoming-1', { reason: undefined });
    });

    // Decline modal cancel path.
    fireEvent.click(within(getIncomingCard()).getByRole('button', { name: /Decline/i }));
    const declineModal = screen.getByText('Decline Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(declineModal).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Decline Transfer?')).not.toBeInTheDocument();
    });

    // Cancel modal "Keep Transfer" path.
    fireEvent.click(within(getOutgoingCard()).getByRole('button', { name: 'Cancel' }));
    const cancelModal = screen.getByText('Cancel Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(cancelModal).getByRole('button', { name: 'Keep Transfer' }));
    await waitFor(() => {
      expect(screen.queryByText('Cancel Transfer?')).not.toBeInTheDocument();
    });

    // Confirm modal cancel path.
    fireEvent.click(within(getAwaitingConfirmCard()).getByRole('button', { name: /Confirm Transfer/i }));
    const confirmModal = screen.getByText('Confirm Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(confirmModal).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Confirm Transfer?')).not.toBeInTheDocument();
    });
  });

  it('uses ApiError messages for accept/decline/cancel/confirm failures', async () => {
    const now = Date.now();
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [
        baseTransfer({
          id: 'incoming-err',
          createdAt: new Date(now - 3_600_000).toISOString(),
        }),
        baseTransfer({
          id: 'outgoing-err',
          fromUserId: 'current-user',
          toUserId: 'recipient-err',
          status: 'pending',
          toUser: { id: 'recipient-err', username: 'recipientErr' },
        }),
        baseTransfer({
          id: 'accepted-err',
          fromUserId: 'current-user',
          toUserId: 'recipient-confirm',
          status: 'accepted',
          acceptedAt: new Date(now - 3_600_000).toISOString(),
          toUser: { id: 'recipient-confirm', username: 'recipientConfirm' },
        }),
      ],
      total: 3,
    });

    vi.mocked(transfersApi.acceptTransfer).mockRejectedValue(new ApiError('Accept API error', 400));
    vi.mocked(transfersApi.declineTransfer).mockRejectedValue(new ApiError('Decline API error', 400));
    vi.mocked(transfersApi.cancelTransfer).mockRejectedValue(new ApiError('Cancel API error', 400));
    vi.mocked(transfersApi.confirmTransfer).mockRejectedValue(new ApiError('Confirm API error', 400));

    render(<PendingTransfersPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
    });

    fireEvent.click(within(getIncomingCard()).getByRole('button', { name: /Accept/i }));
    let modal = screen.getByText('Accept Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: 'Accept Transfer' }));
    await waitFor(() => {
      expect(screen.getByText('Accept API error')).toBeInTheDocument();
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(getIncomingCard()).getByRole('button', { name: /Decline/i }));
    modal = screen.getByText('Decline Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: 'Decline Transfer' }));
    await waitFor(() => {
      expect(screen.getByText('Decline API error')).toBeInTheDocument();
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(getOutgoingCard()).getByRole('button', { name: 'Cancel' }));
    modal = screen.getByText('Cancel Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel Transfer' }));
    await waitFor(() => {
      expect(screen.getByText('Cancel API error')).toBeInTheDocument();
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Keep Transfer' }));

    fireEvent.click(within(getAwaitingConfirmCard()).getByRole('button', { name: /Confirm Transfer/i }));
    modal = screen.getByText('Confirm Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: /Complete Transfer/i }));
    await waitFor(() => {
      expect(screen.getByText('Confirm API error')).toBeInTheDocument();
    });
  });

  it('uses fallback messages for non-ApiError decline/cancel/confirm failures', async () => {
    const now = Date.now();
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [
        baseTransfer({
          id: 'incoming-nonapi',
          createdAt: new Date(now - 3_600_000).toISOString(),
        }),
        baseTransfer({
          id: 'outgoing-nonapi',
          fromUserId: 'current-user',
          toUserId: 'recipient-nonapi',
          status: 'pending',
          toUser: { id: 'recipient-nonapi', username: 'recipientNonApi' },
        }),
        baseTransfer({
          id: 'accepted-nonapi',
          fromUserId: 'current-user',
          toUserId: 'recipient-confirm-nonapi',
          status: 'accepted',
          acceptedAt: new Date(now - 3_600_000).toISOString(),
          toUser: { id: 'recipient-confirm-nonapi', username: 'recipientConfirmNonApi' },
        }),
      ],
      total: 3,
    });

    vi.mocked(transfersApi.declineTransfer).mockRejectedValue(new Error('decline boom'));
    vi.mocked(transfersApi.cancelTransfer).mockRejectedValue(new Error('cancel boom'));
    vi.mocked(transfersApi.confirmTransfer).mockRejectedValue(new Error('confirm boom'));

    render(<PendingTransfersPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
    });

    fireEvent.click(within(getIncomingCard()).getByRole('button', { name: /Decline/i }));
    let modal = screen.getByText('Decline Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: 'Decline Transfer' }));
    await waitFor(() => {
      expect(screen.getByText('Failed to decline transfer')).toBeInTheDocument();
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(getOutgoingCard()).getByRole('button', { name: 'Cancel' }));
    modal = screen.getByText('Cancel Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel Transfer' }));
    await waitFor(() => {
      expect(screen.getByText('Failed to cancel transfer')).toBeInTheDocument();
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Keep Transfer' }));

    fireEvent.click(within(getAwaitingConfirmCard()).getByRole('button', { name: /Confirm Transfer/i }));
    modal = screen.getByText('Confirm Transfer?').closest('div.surface-elevated') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: /Complete Transfer/i }));
    await waitFor(() => {
      expect(screen.getByText('Failed to confirm transfer')).toBeInTheDocument();
    });
  });
});
