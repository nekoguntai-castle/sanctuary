/**
 * useTransferActions Hook
 *
 * Encapsulates the four transfer action handlers (accept, decline, cancel, confirm)
 * along with their shared loading/error state and confirmation modal management.
 */

import { useState, useCallback, useEffect } from 'react';
import * as transfersApi from '../../src/api/transfers';
import { ApiError } from '../../src/api/client';
import { useUser } from '../../contexts/UserContext';
import { useLoadingState } from '../../hooks/useLoadingState';
import type { Transfer } from '../../types';

export type TransferAction = 'accept' | 'decline' | 'cancel' | 'confirm';

export interface ConfirmModalState {
  transferId: string;
  action: TransferAction;
}

export interface UseTransferActionsReturn {
  loading: boolean;
  error: string | null;
  actionLoading: string | null;
  confirmModal: ConfirmModalState | null;
  declineReason: string;
  incomingPending: Transfer[];
  outgoingPending: Transfer[];
  awaitingConfirmation: Transfer[];
  hasTransfers: boolean;
  setConfirmModal: (modal: ConfirmModalState | null) => void;
  setDeclineReason: (reason: string) => void;
  handleAccept: (transferId: string) => Promise<void>;
  handleDecline: (transferId: string) => Promise<void>;
  handleCancel: (transferId: string) => Promise<void>;
  handleConfirm: (transferId: string) => Promise<void>;
}

export function useTransferActions(
  resourceType: 'wallet' | 'device',
  resourceId: string,
  onTransferComplete?: () => void,
): UseTransferActionsReturn {
  const { user } = useUser();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { loading, error: loadError, execute: runLoad } = useLoadingState({ initialLoading: true });

  const error = loadError || actionError;

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const fetchTransfers = useCallback(() => runLoad(async () => {
    const result = await transfersApi.getTransfers({
      status: 'active',
      resourceType,
    });
    const resourceTransfers = result.transfers.filter(
      (t: Transfer) => t.resourceId === resourceId,
    );
    setTransfers(resourceTransfers);
  }), [resourceType, resourceId, runLoad]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const runAction = useCallback(async (
    transferId: string,
    apiCall: () => Promise<unknown>,
    fallbackMessage: string,
    afterSuccess?: () => void,
  ) => {
    setActionLoading(transferId);
    setActionError(null);
    try {
      await apiCall();
      await fetchTransfers();
      setConfirmModal(null);
      afterSuccess?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : fallbackMessage;
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchTransfers]);

  const handleAccept = useCallback(async (transferId: string) => {
    await runAction(
      transferId,
      () => transfersApi.acceptTransfer(transferId),
      'Failed to accept transfer',
    );
  }, [runAction]);

  const handleDecline = useCallback(async (transferId: string) => {
    const reason = declineReason.trim() || undefined;
    await runAction(
      transferId,
      () => transfersApi.declineTransfer(transferId, { reason }),
      'Failed to decline transfer',
      () => setDeclineReason(''),
    );
  }, [runAction, declineReason]);

  const handleCancel = useCallback(async (transferId: string) => {
    await runAction(
      transferId,
      () => transfersApi.cancelTransfer(transferId),
      'Failed to cancel transfer',
    );
  }, [runAction]);

  const handleConfirm = useCallback(async (transferId: string) => {
    await runAction(
      transferId,
      () => transfersApi.confirmTransfer(transferId),
      'Failed to confirm transfer',
      () => onTransferComplete?.(),
    );
  }, [runAction, onTransferComplete]);

  const incomingPending = transfers.filter(t => t.toUserId === user?.id && t.status === 'pending');
  const outgoingPending = transfers.filter(t => t.fromUserId === user?.id && t.status === 'pending');
  const awaitingConfirmation = transfers.filter(t => t.fromUserId === user?.id && t.status === 'accepted');
  const hasTransfers = incomingPending.length > 0 || outgoingPending.length > 0 || awaitingConfirmation.length > 0;

  return {
    loading,
    error,
    actionLoading,
    confirmModal,
    declineReason,
    incomingPending,
    outgoingPending,
    awaitingConfirmation,
    hasTransfers,
    setConfirmModal,
    setDeclineReason,
    handleAccept,
    handleDecline,
    handleCancel,
    handleConfirm,
  };
}
