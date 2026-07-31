/**
 * useAddressLabels Hook
 *
 * Manages address label editing state and handlers: loading available labels,
 * toggling label selection, saving label assignments, and cancelling edits.
 * Extracted from WalletDetail.tsx to isolate address-label concerns.
 */

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as labelsApi from '../../../src/api/labels';
import type { Address, Label } from '../../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAddressLabelsParams {
  /** Wallet ID – required for fetching wallet-scoped labels */
  walletId: string | undefined;
  /** All labels available for the wallet (from React Query cache) */
  walletLabels: Label[];
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

interface AddressEditorTarget {
  display: string;
  id: string;
  labels: Label[];
}

/**
 * Wallet generation rejects cross-wallet completions, editor generation rejects
 * stale modal ownership, and operation identifies the exact save within it.
 */
interface AddressSaveToken {
  addressId: string;
  display: string;
  editorGeneration: number;
  labels: Label[];
  operation: number;
  walletGeneration: number;
  walletId: string;
}

function getAddressDisplay(address: Address, addressId: string): string {
  const value = address.address;
  if (typeof value === 'string' && value) return value;
  return addressId;
}

function labelsForSnapshot(labelIds: string[], labels: Label[]): Label[] {
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  return labelIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
}

async function enqueueAddressLabelWrite(
  queue: Map<string, Promise<void>>,
  addressId: string,
  labelIds: string[],
): Promise<void> {
  const priorWrite = queue.get(addressId) ?? Promise.resolve();
  const write = priorWrite.then(async () => {
    await labelsApi.setAddressLabels(addressId, labelIds);
  });
  const settledWrite = write.catch(() => undefined);
  queue.set(addressId, settledWrite);
  try {
    await write;
  } finally {
    if (queue.get(addressId) === settledWrite) queue.delete(addressId);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAddressLabels({
  walletId,
  walletLabels,
  setAddresses,
  handleError,
}: UseAddressLabelsParams): UseAddressLabelsReturn {
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingAddressLabels, setSavingAddressLabels] = useState(false);
  const mountedRef = useRef(true);
  const walletIdRef = useRef(walletId);
  walletIdRef.current = walletId;
  const priorWalletIdRef = useRef(walletId);
  const walletGenerationRef = useRef(0);
  const editorGenerationRef = useRef(0);
  const operationOwnerRef = useRef(0);
  const addressOperationRef = useRef(new Map<string, number>());
  const addressWriteQueueRef = useRef(new Map<string, Promise<void>>());
  const editorTargetRef = useRef<AddressEditorTarget | null>(null);
  const savingRef = useRef(false);

  const availableLabels = walletLabels;

  const resetEditor = useCallback(() => {
    editorGenerationRef.current += 1;
    operationOwnerRef.current += 1;
    editorTargetRef.current = null;
    savingRef.current = false;
    setEditingAddressId(null);
    setSelectedLabelIds([]);
    setSavingAddressLabels(false);
  }, []);

  useLayoutEffect(() => {
    if (priorWalletIdRef.current === walletId) return;
    priorWalletIdRef.current = walletId;
    walletGenerationRef.current += 1;
    addressOperationRef.current.clear();
    resetEditor();
  }, [resetEditor, walletId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      walletGenerationRef.current += 1;
      editorGenerationRef.current += 1;
      operationOwnerRef.current += 1;
      addressOperationRef.current.clear();
    };
  }, []);

  const handleEditAddressLabels = useCallback(async (addr: Address) => {
    if (!addr.id || !walletId) return;
    editorGenerationRef.current += 1;
    operationOwnerRef.current += 1;
    savingRef.current = false;
    editorTargetRef.current = {
      display: getAddressDisplay(addr, addr.id),
      id: addr.id,
      labels: addr.labels ?? [],
    };
    setEditingAddressId(addr.id);
    setSelectedLabelIds(addr.labels?.map(l => l.id) || []);
    setSavingAddressLabels(false);
  }, [walletId]);

  const handleSaveAddressLabels = useCallback(async () => {
    const target = editorTargetRef.current;
    const activeWalletId = walletIdRef.current;
    if (!target || !activeWalletId || savingRef.current) return;
    const requestedLabelIds = [...selectedLabelIds];
    const token: AddressSaveToken = {
      addressId: target.id,
      display: target.display,
      editorGeneration: editorGenerationRef.current,
      labels: labelsForSnapshot(requestedLabelIds, [...target.labels, ...availableLabels]),
      operation: ++operationOwnerRef.current,
      walletGeneration: walletGenerationRef.current,
      walletId: activeWalletId,
    };
    addressOperationRef.current.set(token.addressId, token.operation);
    savingRef.current = true;
    setSavingAddressLabels(true);
    try {
      await enqueueAddressLabelWrite(
        addressWriteQueueRef.current,
        token.addressId,
        requestedLabelIds,
      );
      if (!ownsAddressOperation(token)) return;
      setAddresses((current) => current.map((address) => (
        address.id === token.addressId ? { ...address, labels: token.labels } : address
      )));
      addressOperationRef.current.delete(token.addressId);
      if (ownsEditor(token)) resetEditor();
    } catch (err) {
      if (!ownsAddressOperation(token)) return;
      addressOperationRef.current.delete(token.addressId);
      if (!ownsEditor(token)) return;
      handleError(err, `Failed to Save Labels for ${token.display}`);
      savingRef.current = false;
      setSavingAddressLabels(false);
    }
  }, [availableLabels, handleError, resetEditor, selectedLabelIds, setAddresses]);

  const handleToggleAddressLabel = useCallback((labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  }, []);

  const handleCancelEditLabels = useCallback(() => {
    resetEditor();
  }, [resetEditor]);

  function ownsWalletScope(token: AddressSaveToken): boolean {
    return mountedRef.current
      && token.walletGeneration === walletGenerationRef.current
      && token.walletId === walletIdRef.current;
  }

  // Same-wallet stale saves may patch their captured address, but only the
  // current editor operation owns modal-local state such as busy/close.
  function ownsEditor(token: AddressSaveToken): boolean {
    return ownsWalletScope(token)
      && token.editorGeneration === editorGenerationRef.current
      && token.operation === operationOwnerRef.current
      && token.addressId === editorTargetRef.current?.id;
  }

  function ownsAddressOperation(token: AddressSaveToken): boolean {
    return ownsWalletScope(token)
      && addressOperationRef.current.get(token.addressId) === token.operation;
  }

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
