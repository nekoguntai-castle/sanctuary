import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TransferCard } from '../../../components/PendingTransfersPanel/TransferCard';
import type { Transfer } from '../../../types';

vi.mock('../../../components/PendingTransfersPanel/transferTimeUtils', () => ({
  formatTimeAgo: (d: string) => `${d} ago`,
  formatExpiry: (d: string) => `expires ${d}`,
}));

const makeTransfer = (overrides: Partial<Transfer> = {}): Transfer => ({
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
  message: 'Please take this',
  declineReason: null,
  keepExistingUsers: false,
  fromUser: { id: 'user-1', username: 'alice' },
  toUser: { id: 'user-2', username: 'bob' },
  ...overrides,
});

describe('TransferCard', () => {
  let onAction: (...args: unknown[]) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    onAction = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('incoming variant', () => {
    it('renders incoming transfer title and direction', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="incoming"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('You')).toBeInTheDocument();
    });

    it('shows message for incoming transfers', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="incoming"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('"Please take this"')).toBeInTheDocument();
    });

    it('renders Accept and Decline buttons', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="incoming"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Accept')).toBeInTheDocument();
      expect(screen.getByText('Decline')).toBeInTheDocument();
    });

    it('calls onAction with accept when Accept is clicked', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="incoming"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      fireEvent.click(screen.getByText('Accept'));
      expect(onAction).toHaveBeenCalledWith('transfer-1', 'accept');
    });

    it('calls onAction with decline when Decline is clicked', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="incoming"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      fireEvent.click(screen.getByText('Decline'));
      expect(onAction).toHaveBeenCalledWith('transfer-1', 'decline');
    });
  });

  describe('outgoing variant', () => {
    it('renders outgoing transfer title and direction', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="outgoing"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Awaiting Response')).toBeInTheDocument();
      // For outgoing: left = You, right = toUser
      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    it('renders Cancel button for outgoing transfers', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="outgoing"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onAction).toHaveBeenCalledWith('transfer-1', 'cancel');
    });

    it('shows message for outgoing transfers', () => {
      render(
        <TransferCard
          transfer={makeTransfer()}
          variant="outgoing"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('"Please take this"')).toBeInTheDocument();
    });

    it('hides message when message is null', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ message: null })}
          variant="outgoing"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.queryByText(/"/)).not.toBeInTheDocument();
    });
  });

  describe('awaiting_confirmation variant', () => {
    it('renders awaiting confirmation title', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: '2026-01-15' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Ready to Confirm')).toBeInTheDocument();
    });

    it('shows acceptance info with username', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: '2026-01-15' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText(/bob accepted the transfer/)).toBeInTheDocument();
    });

    it('renders Cancel and Confirm Transfer buttons', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: '2026-01-15' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Confirm Transfer')).toBeInTheDocument();
    });

    it('calls onAction with confirm when Confirm Transfer is clicked', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: '2026-01-15' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      fireEvent.click(screen.getByText('Confirm Transfer'));
      expect(onAction).toHaveBeenCalledWith('transfer-1', 'confirm');
    });

    it('calls onAction with cancel when Cancel is clicked', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: '2026-01-15' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onAction).toHaveBeenCalledWith('transfer-1', 'cancel');
    });

    it('uses updatedAt as fallback when acceptedAt is null', () => {
      render(
        <TransferCard
          transfer={makeTransfer({ acceptedAt: null, updatedAt: '2026-01-20' })}
          variant="awaiting_confirmation"
          actionLoading={null}
          onAction={onAction}
        />,
      );

      expect(screen.getByText(/Accepted/)).toBeInTheDocument();
    });
  });

  it('disables buttons when actionLoading matches transfer ID', () => {
    render(
      <TransferCard
        transfer={makeTransfer()}
        variant="incoming"
        actionLoading="transfer-1"
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Accept').closest('button')).toBeDisabled();
    expect(screen.getByText('Decline').closest('button')).toBeDisabled();
  });

  it('does not disable buttons when actionLoading is for a different transfer', () => {
    render(
      <TransferCard
        transfer={makeTransfer()}
        variant="incoming"
        actionLoading="transfer-other"
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Accept').closest('button')).not.toBeDisabled();
  });

  it('renders expiry timestamp', () => {
    render(
      <TransferCard
        transfer={makeTransfer()}
        variant="incoming"
        actionLoading={null}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('expires 2026-02-01')).toBeInTheDocument();
  });
});
