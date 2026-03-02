/**
 * Tests for components/PendingTransfersPanel.tsx
 *
 * Tests the pending transfers panel including incoming transfers,
 * outgoing transfers, confirmation modals, and action handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PendingTransfersPanel } from '../../components/PendingTransfersPanel';
import * as transfersApi from '../../src/api/transfers';
import type { Transfer } from '../../types';

// Mock the transfers API
vi.mock('../../src/api/transfers', () => ({
  getTransfers: vi.fn(),
  acceptTransfer: vi.fn(),
  declineTransfer: vi.fn(),
  cancelTransfer: vi.fn(),
  confirmTransfer: vi.fn(),
}));

// Mock useUser
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: {
      id: 'current-user',
      username: 'currentuser',
    },
  }),
}));

describe('PendingTransfersPanel', () => {
  const defaultProps = {
    resourceType: 'wallet' as const,
    resourceId: 'wallet-123',
    onTransferComplete: vi.fn(),
  };

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000);
  const oneDayFromNow = new Date(now.getTime() + 86400000);

  const mockIncomingTransfer: Transfer = {
    id: 'transfer-1',
    resourceType: 'wallet',
    resourceId: 'wallet-123',
    fromUserId: 'other-user',
    toUserId: 'current-user',
    status: 'pending',
    message: 'Please accept this transfer',
    createdAt: oneHourAgo.toISOString(),
    updatedAt: oneHourAgo.toISOString(),
    expiresAt: oneDayFromNow.toISOString(),
    fromUser: { id: 'other-user', username: 'otheruser' },
    toUser: { id: 'current-user', username: 'currentuser' },
  };

  const mockOutgoingTransfer: Transfer = {
    id: 'transfer-2',
    resourceType: 'wallet',
    resourceId: 'wallet-123',
    fromUserId: 'current-user',
    toUserId: 'recipient-user',
    status: 'pending',
    message: 'Transferring to you',
    createdAt: oneHourAgo.toISOString(),
    updatedAt: oneHourAgo.toISOString(),
    expiresAt: oneDayFromNow.toISOString(),
    fromUser: { id: 'current-user', username: 'currentuser' },
    toUser: { id: 'recipient-user', username: 'recipientuser' },
  };

  const mockAcceptedTransfer: Transfer = {
    id: 'transfer-3',
    resourceType: 'wallet',
    resourceId: 'wallet-123',
    fromUserId: 'current-user',
    toUserId: 'recipient-user',
    status: 'accepted',
    createdAt: oneHourAgo.toISOString(),
    updatedAt: oneHourAgo.toISOString(),
    acceptedAt: oneHourAgo.toISOString(),
    expiresAt: oneDayFromNow.toISOString(),
    fromUser: { id: 'current-user', username: 'currentuser' },
    toUser: { id: 'recipient-user', username: 'recipientuser' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [],
      total: 0,
    });
  });

  describe('loading state', () => {
    it('shows loading skeleton while fetching', () => {
      vi.mocked(transfersApi.getTransfers).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<PendingTransfersPanel {...defaultProps} />);

      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders nothing when no transfers', async () => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [],
        total: 0,
      });

      const { container } = render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(transfersApi.getTransfers).toHaveBeenCalled();
      });

      // Wait for loading to complete
      await waitFor(() => {
        expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
      });

      expect(container.firstChild).toBeNull();
    });
  });

  describe('incoming transfers', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockIncomingTransfer],
        total: 1,
      });
    });

    it('renders incoming transfer request', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Incoming Transfer Request')).toBeInTheDocument();
      });
    });

    it('shows sender username', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('otheruser')).toBeInTheDocument();
      });
    });

    it('shows transfer message', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('"Please accept this transfer"')).toBeInTheDocument();
      });
    });

    it('shows Accept and Decline buttons', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Decline/i })).toBeInTheDocument();
      });
    });
  });

  describe('outgoing pending transfers', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockOutgoingTransfer],
        total: 1,
      });
    });

    it('renders awaiting response state', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Awaiting Response')).toBeInTheDocument();
      });
    });

    it('shows recipient username', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('recipientuser')).toBeInTheDocument();
      });
    });

    it('shows Cancel button', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
      });
    });
  });

  describe('accepted transfers (awaiting confirmation)', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockAcceptedTransfer],
        total: 1,
      });
    });

    it('renders ready to confirm state', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Ready to Confirm')).toBeInTheDocument();
      });
    });

    it('shows accepted message', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/recipientuser accepted the transfer/)).toBeInTheDocument();
      });
    });

    it('shows Confirm Transfer button', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });
    });

    it('opens cancel modal from ready-to-confirm card cancel button', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

      expect(screen.getByText('Cancel Transfer?')).toBeInTheDocument();
    });
  });

  describe('accept action', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockIncomingTransfer],
        total: 1,
      });
      vi.mocked(transfersApi.acceptTransfer).mockResolvedValue(undefined);
    });

    it('opens accept modal when Accept clicked', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Accept/i }));

      expect(screen.getByText('Accept Transfer?')).toBeInTheDocument();
    });

    it('calls acceptTransfer when confirmed', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Accept/i }));

      // Click Accept Transfer in modal
      const acceptButtons = screen.getAllByText('Accept Transfer');
      fireEvent.click(acceptButtons[acceptButtons.length - 1]);

      await waitFor(() => {
        expect(transfersApi.acceptTransfer).toHaveBeenCalledWith('transfer-1');
      });
    });
  });

  describe('decline action', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockIncomingTransfer],
        total: 1,
      });
      vi.mocked(transfersApi.declineTransfer).mockResolvedValue(undefined);
    });

    it('opens decline modal when Decline clicked', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Decline/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Decline/i }));

      expect(screen.getByText('Decline Transfer?')).toBeInTheDocument();
    });

    it('shows reason input in decline modal', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Decline/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Decline/i }));

      expect(screen.getByPlaceholderText('Let them know why...')).toBeInTheDocument();
    });

    it('calls declineTransfer with reason when confirmed', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Decline/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Decline/i }));

      // Enter reason
      fireEvent.change(screen.getByPlaceholderText('Let them know why...'), {
        target: { value: 'Not interested' },
      });

      // Click Decline Transfer in modal
      fireEvent.click(screen.getByRole('button', { name: 'Decline Transfer' }));

      await waitFor(() => {
        expect(transfersApi.declineTransfer).toHaveBeenCalledWith('transfer-1', {
          reason: 'Not interested',
        });
      });
    });
  });

  describe('cancel action', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockOutgoingTransfer],
        total: 1,
      });
      vi.mocked(transfersApi.cancelTransfer).mockResolvedValue(undefined);
    });

    it('opens cancel modal when Cancel clicked', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      expect(screen.getByText('Cancel Transfer?')).toBeInTheDocument();
    });

    it('calls cancelTransfer when confirmed', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      // Click Cancel Transfer in modal
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Transfer' }));

      await waitFor(() => {
        expect(transfersApi.cancelTransfer).toHaveBeenCalledWith('transfer-2');
      });
    });
  });

  describe('confirm action', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockAcceptedTransfer],
        total: 1,
      });
      vi.mocked(transfersApi.confirmTransfer).mockResolvedValue(undefined);
    });

    it('opens confirm modal when Confirm Transfer clicked', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Confirm Transfer/i }));

      expect(screen.getByText('Confirm Transfer?')).toBeInTheDocument();
    });

    it('shows warning about irreversible action', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Confirm Transfer/i }));

      expect(screen.getByText('This action is irreversible')).toBeInTheDocument();
    });

    it('calls confirmTransfer when confirmed', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Confirm Transfer/i }));

      // Click Complete Transfer in modal
      fireEvent.click(screen.getByRole('button', { name: /Complete Transfer/i }));

      await waitFor(() => {
        expect(transfersApi.confirmTransfer).toHaveBeenCalledWith('transfer-3');
      });
    });

    it('calls onTransferComplete callback after confirm', async () => {
      const onTransferComplete = vi.fn();
      render(<PendingTransfersPanel {...defaultProps} onTransferComplete={onTransferComplete} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Confirm Transfer/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Confirm Transfer/i }));
      fireEvent.click(screen.getByRole('button', { name: /Complete Transfer/i }));

      await waitFor(() => {
        expect(onTransferComplete).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockIncomingTransfer],
        total: 1,
      });
    });

    it('shows error message when accept fails', async () => {
      vi.mocked(transfersApi.acceptTransfer).mockRejectedValue(new Error('Network error'));

      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Accept/i }));

      const acceptButtons = screen.getAllByText('Accept Transfer');
      fireEvent.click(acceptButtons[acceptButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByText('Failed to accept transfer')).toBeInTheDocument();
      });
    });

    it('renders nothing when fetching fails with no transfers', async () => {
      // Note: When getTransfers fails, the component sets error state but returns null
      // because hasTransfers is false (transfers array is empty). This is the expected
      // behavior - errors during initial load don't show an error panel, they just
      // result in no transfers being displayed.
      vi.mocked(transfersApi.getTransfers).mockRejectedValue(new Error('API Error'));

      const { container } = render(<PendingTransfersPanel {...defaultProps} />);

      // Wait for loading to complete
      await waitFor(() => {
        expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
      });

      // Component returns null when there are no transfers
      expect(container.firstChild).toBeNull();
    });
  });

  describe('modal cancellation', () => {
    beforeEach(() => {
      vi.mocked(transfersApi.getTransfers).mockResolvedValue({
        transfers: [mockIncomingTransfer],
        total: 1,
      });
    });

    it('closes accept modal when Cancel is clicked', async () => {
      render(<PendingTransfersPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Accept/i }));
      expect(screen.getByText('Accept Transfer?')).toBeInTheDocument();

      // Click Cancel in modal
      const cancelButtons = screen.getAllByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelButtons[cancelButtons.length - 1]);

      await waitFor(() => {
        expect(screen.queryByText('Accept Transfer?')).not.toBeInTheDocument();
      });
    });
  });
});
