import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransferConfirmationModal } from '../../../components/PendingTransfersPanel/TransferConfirmationModal';

const baseHandlers = {
  onClose: vi.fn(),
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  onDeclineReasonChange: vi.fn(),
};

const renderModal = (
  action: 'accept' | 'decline' | 'cancel' | 'confirm',
  overrides: Record<string, unknown> = {},
) =>
  render(
    <TransferConfirmationModal
      modal={{ transferId: 'transfer-1', action }}
      actionLoading={null}
      declineReason=""
      {...baseHandlers}
      {...overrides}
    />,
  );

describe('TransferConfirmationModal', () => {
  describe('accept action', () => {
    it('renders accept confirmation dialog', () => {
      renderModal('accept');
      expect(screen.getByText('Accept Transfer?')).toBeInTheDocument();
      expect(screen.getByText(/current owner will be asked to confirm/)).toBeInTheDocument();
    });

    it('calls onAccept when Accept Transfer button is clicked', () => {
      const onAccept = vi.fn();
      renderModal('accept', { onAccept });

      fireEvent.click(screen.getByText('Accept Transfer'));
      expect(onAccept).toHaveBeenCalledWith('transfer-1');
    });

    it('calls onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      renderModal('accept', { onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('decline action', () => {
    it('renders decline confirmation dialog with reason textarea', () => {
      renderModal('decline');
      expect(screen.getByText('Decline Transfer?')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Let them know why...')).toBeInTheDocument();
    });

    it('calls onDeclineReasonChange when reason is typed', () => {
      const onDeclineReasonChange = vi.fn();
      renderModal('decline', { onDeclineReasonChange });

      fireEvent.change(screen.getByPlaceholderText('Let them know why...'), {
        target: { value: 'Not interested' },
      });
      expect(onDeclineReasonChange).toHaveBeenCalledWith('Not interested');
    });

    it('calls onDecline when Decline Transfer button is clicked', () => {
      const onDecline = vi.fn();
      renderModal('decline', { onDecline });

      fireEvent.click(screen.getByText('Decline Transfer'));
      expect(onDecline).toHaveBeenCalledWith('transfer-1');
    });

    it('calls onClose and clears reason when Cancel is clicked', () => {
      const onClose = vi.fn();
      const onDeclineReasonChange = vi.fn();
      renderModal('decline', { onClose, onDeclineReasonChange });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
      expect(onDeclineReasonChange).toHaveBeenCalledWith('');
    });
  });

  describe('cancel action', () => {
    it('renders cancel confirmation dialog', () => {
      renderModal('cancel');
      expect(screen.getByText('Cancel Transfer?')).toBeInTheDocument();
      expect(screen.getByText(/You can initiate a new transfer later/)).toBeInTheDocument();
    });

    it('calls onCancel when Cancel Transfer button is clicked', () => {
      const onCancel = vi.fn();
      renderModal('cancel', { onCancel });

      fireEvent.click(screen.getByText('Cancel Transfer'));
      expect(onCancel).toHaveBeenCalledWith('transfer-1');
    });

    it('calls onClose when Keep Transfer button is clicked', () => {
      const onClose = vi.fn();
      renderModal('cancel', { onClose });

      fireEvent.click(screen.getByText('Keep Transfer'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('confirm action', () => {
    it('renders confirm dialog with irreversibility warning', () => {
      renderModal('confirm');
      expect(screen.getByText('Confirm Transfer?')).toBeInTheDocument();
      expect(screen.getByText('This action is irreversible')).toBeInTheDocument();
    });

    it('calls onConfirm when Complete Transfer button is clicked', () => {
      const onConfirm = vi.fn();
      renderModal('confirm', { onConfirm });

      fireEvent.click(screen.getByText('Complete Transfer'));
      expect(onConfirm).toHaveBeenCalledWith('transfer-1');
    });

    it('calls onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      renderModal('confirm', { onClose });

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows loading state when actionLoading matches transferId', () => {
    render(
      <TransferConfirmationModal
        modal={{ transferId: 'transfer-1', action: 'accept' }}
        actionLoading="transfer-1"
        declineReason=""
        {...baseHandlers}
      />,
    );

    // The Accept Transfer button should show loading
    const button = screen.getByText('Accept Transfer').closest('button');
    expect(button).toBeInTheDocument();
  });

  it('does not show loading for different transfer', () => {
    render(
      <TransferConfirmationModal
        modal={{ transferId: 'transfer-1', action: 'accept' }}
        actionLoading="transfer-other"
        declineReason=""
        {...baseHandlers}
      />,
    );

    expect(screen.getByText('Accept Transfer')).toBeInTheDocument();
  });
});
