/**
 * useTransferActions Hook
 *
 * Encapsulates the four transfer action handlers (accept, decline, cancel, confirm)
 * along with their shared loading/error state and confirmation modal management.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getErrorMessage } from '@sanctuary/shared/utils/errors';
import * as transfersApi from '../../api/transfers';
import { ApiError } from '../../api/client';
import { useUser } from '../../contexts/UserContext';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const error = loadError || actionError;

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // Tracks the resourceType/resourceId this hook instance is currently
  // scoped to. The panel is rendered without a `key`, so the same hook
  // instance survives a resource switch (e.g. navigating from one wallet's
  // detail page to another's) — any fetch or action started against the
  // previous resource must not be allowed to apply its result once the
  // resource has moved on.
  const currentResourceRef = useRef({ resourceType, resourceId });
  currentResourceRef.current = { resourceType, resourceId };
  const isCurrentResource = (requestResourceType: string, requestResourceId: string): boolean => (
    currentResourceRef.current.resourceType === requestResourceType
    && currentResourceRef.current.resourceId === requestResourceId
  );

  // Reset all resource-scoped state synchronously (during render, not in an
  // effect) the moment resourceType/resourceId changes, so stale data from
  // the previous resource is never visible even for a single paint.
  const [trackedResourceKey, setTrackedResourceKey] = useState(`${resourceType}:${resourceId}`);
  const resourceKey = `${resourceType}:${resourceId}`;
  if (resourceKey !== trackedResourceKey) {
    setTrackedResourceKey(resourceKey);
    setTransfers([]);
    setActionLoading(null);
    setActionError(null);
    setConfirmModal(null);
    setLoadError(null);
    setDeclineReason('');
  }

  const fetchTransfers = useCallback(async () => {
    const requestResourceType = resourceType;
    const requestResourceId = resourceId;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await transfersApi.getTransfers({
        status: 'active',
        resourceType: requestResourceType,
      });
      if (!isCurrentResource(requestResourceType, requestResourceId)) return;
      const resourceTransfers = result.transfers.filter(
        (t: Transfer) => t.resourceId === requestResourceId,
      );
      setTransfers(resourceTransfers);
    } catch (err) {
      if (isCurrentResource(requestResourceType, requestResourceId)) {
        setLoadError(getErrorMessage(err));
      }
    } finally {
      if (isCurrentResource(requestResourceType, requestResourceId)) {
        setLoading(false);
      }
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const runAction = useCallback(async (
    transferId: string,
    apiCall: () => Promise<unknown>,
    fallbackMessage: string,
    afterSuccess?: () => void,
  ) => {
    const requestResourceType = resourceType;
    const requestResourceId = resourceId;
    setActionLoading(transferId);
    setActionError(null);
    try {
      await apiCall();
      await fetchTransfers();
      if (isCurrentResource(requestResourceType, requestResourceId)) {
        setConfirmModal(null);
        afterSuccess?.();
      }
    } catch (err) {
      if (isCurrentResource(requestResourceType, requestResourceId)) {
        const message = err instanceof ApiError ? err.message : fallbackMessage;
        setActionError(message);
      }
    } finally {
      if (isCurrentResource(requestResourceType, requestResourceId)) {
        setActionLoading(null);
      }
    }
  }, [fetchTransfers, resourceType, resourceId]);

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
