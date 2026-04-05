/**
 * PendingTransfersPanel Component
 *
 * Displays pending ownership transfers for a resource (wallet or device).
 * Shows both incoming transfers (to accept/decline) and outgoing transfers (to confirm/cancel).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Check, X, Clock, AlertTriangle, Send, Inbox } from 'lucide-react';
import { Button } from './ui/Button';
import { useUser } from '../contexts/UserContext';
import * as transfersApi from '../src/api/transfers';
import { Transfer } from '../types';
import { ApiError } from '../src/api/client';
import { useLoadingState } from '../hooks/useLoadingState';

interface PendingTransfersPanelProps {
  resourceType: 'wallet' | 'device';
  resourceId: string;
  onTransferComplete?: () => void;
}

export const PendingTransfersPanel: React.FC<PendingTransfersPanelProps> = ({
  resourceType,
  resourceId,
  onTransferComplete,
}) => {
  const { user } = useUser();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Loading state using hook
  const { loading, error: loadError, execute: runLoad } = useLoadingState({ initialLoading: true });

  // Combined error display
  const error = loadError || actionError;

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    transferId: string;
    action: 'accept' | 'decline' | 'cancel' | 'confirm';
  } | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  // Fetch active transfers for this resource
  const fetchTransfers = useCallback(() => runLoad(async () => {
    const result = await transfersApi.getTransfers({
      status: 'active',
      resourceType,
    });
    // Filter to only this resource
    const resourceTransfers = result.transfers.filter(t => t.resourceId === resourceId);
    setTransfers(resourceTransfers);
  }), [resourceType, resourceId, runLoad]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  // Handle accept transfer
  const handleAccept = async (transferId: string) => {
    setActionLoading(transferId);
    setActionError(null);
    try {
      await transfersApi.acceptTransfer(transferId);
      await fetchTransfers();
      setConfirmModal(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to accept transfer';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle decline transfer
  const handleDecline = async (transferId: string) => {
    setActionLoading(transferId);
    setActionError(null);
    try {
      await transfersApi.declineTransfer(transferId, { reason: declineReason.trim() || undefined });
      await fetchTransfers();
      setConfirmModal(null);
      setDeclineReason('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to decline transfer';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle cancel transfer
  const handleCancel = async (transferId: string) => {
    setActionLoading(transferId);
    setActionError(null);
    try {
      await transfersApi.cancelTransfer(transferId);
      await fetchTransfers();
      setConfirmModal(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel transfer';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle confirm transfer
  const handleConfirm = async (transferId: string) => {
    setActionLoading(transferId);
    setActionError(null);
    try {
      await transfersApi.confirmTransfer(transferId);
      await fetchTransfers();
      setConfirmModal(null);
      onTransferComplete?.();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to confirm transfer';
      setActionError(message);
    } finally {
      setActionLoading(null);
    }
  };

  // Format relative time
  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Format expiry
  const formatExpiry = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) return 'Expired';
    if (diffHours < 24) return `${diffHours}h remaining`;
    return `${diffDays}d remaining`;
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 surface-secondary rounded-lg" />
      </div>
    );
  }

  // Separate transfers by role
  const incomingPending = transfers.filter(t => t.toUserId === user?.id && t.status === 'pending');
  const outgoingPending = transfers.filter(t => t.fromUserId === user?.id && t.status === 'pending');
  const awaitingConfirmation = transfers.filter(t => t.fromUserId === user?.id && t.status === 'accepted');

  const hasTransfers = incomingPending.length > 0 || outgoingPending.length > 0 || awaitingConfirmation.length > 0;

  if (!hasTransfers) {
    return null; // Don't show panel if no active transfers
  }

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-sm flex items-start">
          <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Incoming Pending Transfers */}
      {incomingPending.map(transfer => (
        <div
          key={transfer.id}
          className="surface-elevated rounded-lg p-4 border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400 mr-3">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Incoming Transfer Request
                </p>
                <div className="flex items-center text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-1">
                  <span className="font-medium">{transfer.fromUser?.username}</span>
                  <ArrowRight className="w-4 h-4 mx-1" />
                  <span>You</span>
                </div>
                {transfer.message && (
                  <p className="text-sm text-sanctuary-500 mt-2">"{transfer.message}"</p>
                )}
                <div className="flex items-center text-xs text-sanctuary-400 mt-2 space-x-3">
                  <span>{formatTimeAgo(transfer.createdAt)}</span>
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatExpiry(transfer.expiresAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmModal({ transferId: transfer.id, action: 'decline' })}
                disabled={actionLoading === transfer.id}
              >
                <X className="w-4 h-4 mr-1" />
                Decline
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmModal({ transferId: transfer.id, action: 'accept' })}
                disabled={actionLoading === transfer.id}
                isLoading={actionLoading === transfer.id}
              >
                <Check className="w-4 h-4 mr-1" />
                Accept
              </Button>
            </div>
          </div>
        </div>
      ))}

      {/* Awaiting Confirmation */}
      {awaitingConfirmation.map(transfer => (
        <div
          key={transfer.id}
          className="surface-elevated rounded-lg p-4 border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg text-primary-600 dark:text-primary-400 mr-3">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Ready to Confirm
                </p>
                <div className="flex items-center text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-1">
                  <span>You</span>
                  <ArrowRight className="w-4 h-4 mx-1" />
                  <span className="font-medium">{transfer.toUser?.username}</span>
                </div>
                <p className="text-xs text-primary-600 dark:text-primary-400 mt-2">
                  {transfer.toUser?.username} accepted the transfer. Confirm to complete.
                </p>
                <div className="flex items-center text-xs text-sanctuary-400 mt-2 space-x-3">
                  <span>Accepted {formatTimeAgo(transfer.acceptedAt || transfer.updatedAt)}</span>
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatExpiry(transfer.expiresAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmModal({ transferId: transfer.id, action: 'cancel' })}
                disabled={actionLoading === transfer.id}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmModal({ transferId: transfer.id, action: 'confirm' })}
                disabled={actionLoading === transfer.id}
                isLoading={actionLoading === transfer.id}
              >
                <Send className="w-4 h-4 mr-1" />
                Confirm Transfer
              </Button>
            </div>
          </div>
        </div>
      ))}

      {/* Outgoing Pending */}
      {outgoingPending.map(transfer => (
        <div
          key={transfer.id}
          className="surface-elevated rounded-lg p-4 border border-sanctuary-200 dark:border-sanctuary-700"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <div className="p-2 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg text-sanctuary-500 dark:text-sanctuary-400 mr-3">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Awaiting Response
                </p>
                <div className="flex items-center text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-1">
                  <span>You</span>
                  <ArrowRight className="w-4 h-4 mx-1" />
                  <span className="font-medium">{transfer.toUser?.username}</span>
                </div>
                {transfer.message && (
                  <p className="text-sm text-sanctuary-500 mt-2">"{transfer.message}"</p>
                )}
                <div className="flex items-center text-xs text-sanctuary-400 mt-2 space-x-3">
                  <span>Initiated {formatTimeAgo(transfer.createdAt)}</span>
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatExpiry(transfer.expiresAt)}
                  </span>
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmModal({ transferId: transfer.id, action: 'cancel' })}
              disabled={actionLoading === transfer.id}
            >
              Cancel
            </Button>
          </div>
        </div>
      ))}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-2xl animate-fade-in-up p-6">
            {confirmModal.action === 'accept' && (
              <>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                  Accept Transfer?
                </h3>
                <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-6">
                  The current owner will be asked to confirm the transfer. You will become the owner once they confirm.
                </p>
                <div className="flex justify-end space-x-3">
                  <Button variant="secondary" onClick={() => setConfirmModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleAccept(confirmModal.transferId)}
                    isLoading={actionLoading === confirmModal.transferId}
                  >
                    Accept Transfer
                  </Button>
                </div>
              </>
            )}

            {confirmModal.action === 'decline' && (
              <>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                  Decline Transfer?
                </h3>
                <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-4">
                  The transfer will be cancelled and the owner will be notified.
                </p>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                    Reason (optional)
                  </label>
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Let them know why..."
                    rows={2}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 resize-none text-sm"
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <Button variant="secondary" onClick={() => { setConfirmModal(null); setDeclineReason(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => handleDecline(confirmModal.transferId)}
                    isLoading={actionLoading === confirmModal.transferId}
                  >
                    Decline Transfer
                  </Button>
                </div>
              </>
            )}

            {confirmModal.action === 'cancel' && (
              <>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                  Cancel Transfer?
                </h3>
                <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-6">
                  This transfer will be cancelled. You can initiate a new transfer later if needed.
                </p>
                <div className="flex justify-end space-x-3">
                  <Button variant="secondary" onClick={() => setConfirmModal(null)}>
                    Keep Transfer
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => handleCancel(confirmModal.transferId)}
                    isLoading={actionLoading === confirmModal.transferId}
                  >
                    Cancel Transfer
                  </Button>
                </div>
              </>
            )}

            {confirmModal.action === 'confirm' && (
              <>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
                  Confirm Transfer?
                </h3>
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg mb-6">
                  <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-2 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-300">
                      <p className="font-medium">This action is irreversible</p>
                      <p className="mt-1 text-xs">
                        Ownership will be transferred immediately. You may retain viewer access depending on the transfer settings.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <Button variant="secondary" onClick={() => setConfirmModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleConfirm(confirmModal.transferId)}
                    isLoading={actionLoading === confirmModal.transferId}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Complete Transfer
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
