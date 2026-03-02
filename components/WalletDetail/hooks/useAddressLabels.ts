/**
 * useAddressLabels Hook
 *
 * Manages address label editing state and handlers: loading available labels,
 * toggling label selection, saving label assignments, and cancelling edits.
 * Extracted from WalletDetail.tsx to isolate address-label concerns.
 */

import { useState, useCallback } from 'react';
import * as labelsApi from '../../../src/api/labels';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import type { Address, Label } from '../../../types';

const log = createLogger('useAddressLabels');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAddressLabelsParams {
  /** Wallet ID – required for fetching wallet-scoped labels */
  walletId: string | undefined;
  /** Setter to update the addresses list after saving label changes */
  setAddresses: React.Dispatch<React.SetStateAction<Address[]>>;
  /** Unified error handler (from useErrorHandler) */
  handleError: (error: unknown, title: string) => void;
}

export interface UseAddressLabelsReturn {
  /** ID of the address currently being edited, or null */
  editingAddressId: string | null;
  /** All labels available for the wallet */
  availableLabels: Label[];
  /** IDs of labels currently selected for the address being edited */
  selectedLabelIds: string[];
  /** Whether a save operation is in progress */
  savingAddressLabels: boolean;
  /** Start editing labels for a given address (loads available labels) */
  handleEditAddressLabels: (addr: Address) => Promise<void>;
  /** Persist the current label selection to the backend */
  handleSaveAddressLabels: () => Promise<void>;
  /** Toggle a single label in the selection */
  handleToggleAddressLabel: (labelId: string) => void;
  /** Cancel editing and reset state */
  handleCancelEditLabels: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAddressLabels({
  walletId,
  setAddresses,
  handleError,
}: UseAddressLabelsParams): UseAddressLabelsReturn {
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingAddressLabels, setSavingAddressLabels] = useState(false);

  const handleEditAddressLabels = useCallback(async (addr: Address) => {
    if (!addr.id || !walletId) return;
    setEditingAddressId(addr.id);
    setSelectedLabelIds(addr.labels?.map(l => l.id) || []);
    try {
      const labels = await labelsApi.getLabels(walletId);
      setAvailableLabels(labels);
    } catch (err) {
      logError(log, err, 'Failed to load labels');
      handleError(err, 'Failed to Load Labels');
    }
  }, [walletId, handleError]);

  const handleSaveAddressLabels = useCallback(async () => {
    if (!editingAddressId) return;
    try {
      setSavingAddressLabels(true);
      await labelsApi.setAddressLabels(editingAddressId, selectedLabelIds);
      // Update the address's labels locally
      const updatedLabels = availableLabels.filter(l => selectedLabelIds.includes(l.id));
      setAddresses(current =>
        current.map(addr =>
          addr.id === editingAddressId ? { ...addr, labels: updatedLabels } : addr
        )
      );
      setEditingAddressId(null);
    } catch (err) {
      logError(log, err, 'Failed to save address labels');
      handleError(err, 'Failed to Save Labels');
    } finally {
      setSavingAddressLabels(false);
    }
  }, [editingAddressId, selectedLabelIds, availableLabels, setAddresses, handleError]);

  const handleToggleAddressLabel = useCallback((labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  }, []);

  const handleCancelEditLabels = useCallback(() => {
    setEditingAddressId(null);
  }, []);

  return {
    editingAddressId,
    availableLabels,
    selectedLabelIds,
    savingAddressLabels,
    handleEditAddressLabels,
    handleSaveAddressLabels,
    handleToggleAddressLabel,
    handleCancelEditLabels,
  };
}
