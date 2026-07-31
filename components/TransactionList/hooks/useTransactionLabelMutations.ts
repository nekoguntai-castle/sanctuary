import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Label, Transaction } from '../../../types';
import * as labelsApi from '../../../src/api/labels';
import { createLogger } from '../../../utils/logger';
import type { SelectionResolution } from './selectionResolution';

const log = createLogger('TransactionList');

interface LabelMutationParams {
  selection: SelectionResolution;
  walletLabels: Label[];
  onLabelsChange?: () => void;
  patchSelectedTxLabels: (
    expectedKey: string,
    expectedTransactionId: string,
    labels: Transaction['labels'],
  ) => void;
}

interface MutationToken {
  generation: number;
  key: string;
  operation: number;
  sequence: number;
  transactionId: string;
}

const mutationMessage = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
);

function labelsMatchingSnapshot(
  labelIds: string[],
  persistedLabels: Label[],
  sourceLabels: Label[],
): Label[] {
  const labelsById = new Map(
    [...sourceLabels, ...persistedLabels].map((label) => [label.id, label]),
  );
  return labelIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
}

export function useTransactionLabelMutations({
  selection,
  walletLabels,
  onLabelsChange,
  patchSelectedTxLabels,
}: LabelMutationParams) {
  const [editingLabels, setEditingLabels] = useState(false);
  const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelMutationError, setLabelMutationError] = useState<string | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const generationRef = useRef(0);
  const priorSelectionKeyRef = useRef(selection.key);
  const saveOwnerRef = useRef(0);
  const aiOwnerRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const errorOwnerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const invalidateOwners = useCallback(() => {
    generationRef.current += 1;
    saveOwnerRef.current += 1;
    aiOwnerRef.current += 1;
  }, []);

  const resetEditor = useCallback(() => {
    setEditingLabels(false);
    setAvailableLabels([]);
    setSelectedLabelIds([]);
    setSavingLabels(false);
    setLabelMutationError(null);
    errorOwnerRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (priorSelectionKeyRef.current === selection.key) return;
    priorSelectionKeyRef.current = selection.key;
    invalidateOwners();
    resetEditor();
  }, [invalidateOwners, resetEditor, selection.key]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateOwners();
    };
  }, [invalidateOwners]);

  const handleEditLabels = useCallback((tx: Transaction) => {
    invalidateOwners();
    setEditingLabels(true);
    setSelectedLabelIds(tx.labels?.map((label) => label.id) ?? []);
    setAvailableLabels(walletLabels);
    setSavingLabels(false);
    setLabelMutationError(null);
  }, [invalidateOwners, walletLabels]);

  const handleCancelEdit = useCallback(() => {
    invalidateOwners();
    resetEditor();
  }, [invalidateOwners, resetEditor]);

  const invalidateForSelectionChange = handleCancelEdit;

  const handleToggleLabel = useCallback((labelId: string) => {
    setSelectedLabelIds((current) => current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId]);
  }, []);

  const isCurrent = useCallback((token: MutationToken, owner: number) => {
    const current = selectionRef.current;
    return mountedRef.current
      && generationRef.current === token.generation
      && owner === token.operation
      && current.key === token.key
      && current.selectedTx?.id === token.transactionId;
  }, []);

  const beginOperation = useCallback((kind: 'save' | 'ai'): MutationToken | null => {
    const current = selectionRef.current;
    if (!current.key || !current.selectedTx) return null;
    const operation = kind === 'save' ? ++saveOwnerRef.current : ++aiOwnerRef.current;
    const sequence = ++mutationSequenceRef.current;
    errorOwnerRef.current = null;
    setLabelMutationError(null);
    return {
      generation: generationRef.current,
      key: current.key,
      operation,
      sequence,
      transactionId: current.selectedTx.id,
    };
  }, []);

  const setOwnedError = useCallback((token: MutationToken, message: string) => {
    if (errorOwnerRef.current !== null && errorOwnerRef.current > token.sequence) return;
    errorOwnerRef.current = token.sequence;
    setLabelMutationError(message);
  }, []);

  const handleSaveLabels = useCallback(async () => {
    const token = beginOperation('save');
    if (!token) return;
    const labelIds = [...selectedLabelIds];
    const snapshotLabels = [
      ...(selectionRef.current.selectedTx?.labels ?? []),
      ...availableLabels,
    ];
    setSavingLabels(true);
    try {
      const persistedLabels = await labelsApi.setTransactionLabels(token.transactionId, labelIds);
      onLabelsChange?.();
      if (!isCurrent(token, saveOwnerRef.current)) return;
      patchSelectedTxLabels(
        token.key,
        token.transactionId,
        labelsMatchingSnapshot(labelIds, persistedLabels, snapshotLabels),
      );
      invalidateOwners();
      resetEditor();
    } catch (error) {
      log.error('Failed to save labels', { error });
      if (!isCurrent(token, saveOwnerRef.current)) return;
      setSavingLabels(false);
      setOwnedError(token, mutationMessage(error, 'Failed to save labels'));
    }
  }, [availableLabels, beginOperation, invalidateOwners, isCurrent, onLabelsChange, patchSelectedTxLabels, resetEditor, selectedLabelIds, setOwnedError]);

  const handleAISuggestion = useCallback(async (suggestion: string) => {
    const current = selectionRef.current;
    if (!current.selectedTx) return;
    const existing = availableLabels.find(
      (label) => label.name.toLowerCase() === suggestion.toLowerCase(),
    );
    if (existing) {
      setSelectedLabelIds((ids) => ids.includes(existing.id) ? ids : [...ids, existing.id]);
      return;
    }
    const token = beginOperation('ai');
    if (!token) return;
    try {
      const created = await labelsApi.createLabel(current.selectedTx.walletId, {
        name: suggestion,
        color: '#6366f1',
      });
      onLabelsChange?.();
      if (!isCurrent(token, aiOwnerRef.current)) return;
      setAvailableLabels((labels) => [...labels, created]);
      setSelectedLabelIds((ids) => ids.includes(created.id) ? ids : [...ids, created.id]);
    } catch (error) {
      log.error('Failed to apply AI suggestion', { error });
      if (isCurrent(token, aiOwnerRef.current)) {
        setOwnedError(token, mutationMessage(error, 'Failed to create label'));
      }
    }
  }, [availableLabels, beginOperation, isCurrent, onLabelsChange, setOwnedError]);

  return {
    availableLabels,
    editingLabels,
    handleAISuggestion,
    handleCancelEdit,
    handleEditLabels,
    handleSaveLabels,
    handleToggleLabel,
    invalidateForSelectionChange,
    labelMutationError,
    savingLabels,
    selectedLabelIds,
  };
}
