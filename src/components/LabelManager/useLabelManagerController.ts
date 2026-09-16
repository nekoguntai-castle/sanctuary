import { useEffect, useRef, useState } from 'react';
import {
  useCreateWalletLabel,
  useDeleteWalletLabel,
  useUpdateWalletLabel,
  useWalletLabels,
} from '../../hooks/queries/useWalletLabels';
import { extractErrorMessage } from '@sanctuary/shared/utils/errors';
import type { Label } from '../../types';
import { createLogger } from '../../utils/logger';
import { PRESET_COLORS } from './constants';
import type { LabelManagerController, LabelManagerProps } from './types';

const log = createLogger('LabelManager');

export const useLabelManagerController = ({
  walletId,
  onLabelsChange,
}: LabelManagerProps): LabelManagerController => {
  const { data, isLoading: loading, error: loadError } = useWalletLabels(walletId);
  const createMutation = useCreateWalletLabel();
  const updateMutation = useUpdateWalletLabel();
  const deleteMutation = useDeleteWalletLabel();
  const [isCreating, setIsCreating] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formDescription, setFormDescription] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Reset the draft form and delete confirmation synchronously (during
  // render, not in an effect) the moment walletId changes, so a stale
  // draft from the previous wallet is never painted under the new one.
  // Mirrors src/components/DraftList/useDraftListController.ts's
  // trackedWalletId pattern. LabelManager is mounted without a `key`
  // (GeneralSettings -> LabelManager), so the same hook instance survives
  // a wallet switch.
  const [trackedWalletId, setTrackedWalletId] = useState(walletId);
  const latestWalletIdRef = useRef(walletId);
  if (walletId !== trackedWalletId) {
    setTrackedWalletId(walletId);
    latestWalletIdRef.current = walletId;
    setIsCreating(false);
    setEditingLabel(null);
    setFormName('');
    setFormColor(PRESET_COLORS[0]);
    setFormDescription('');
    setDeleteConfirm(null);
  }

  const resetMutationErrors = () => {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
  };

  // Mutation `reset()` calls are external hook side effects, not local
  // state, so they run from an effect rather than during render. The ref
  // records the wallet the errors were last reset for, so the initial mount
  // (and StrictMode's replay of it, which re-runs the effect with the same
  // walletId) is skipped and only a real wallet switch clears the errors.
  const errorsResetForWalletRef = useRef(walletId);
  useEffect(() => {
    if (errorsResetForWalletRef.current === walletId) return;
    errorsResetForWalletRef.current = walletId;
    resetMutationErrors();
  }, [walletId]);

  // A mutation issued for a previous wallet may settle after the switch.
  // Its outcome must not leak into the new wallet: clear the error it may
  // have left in its own mutation state and skip the form/refresh
  // continuation. `reset()` acts on the hook's shared observer, so it is
  // skipped when a newer mutation of the same kind has been issued since:
  // that mutation's state already supersedes the stale one, and resetting
  // would detach it mid-flight.
  const mutations = { create: createMutation, update: updateMutation, delete: deleteMutation };
  type MutationKind = keyof typeof mutations;
  const issueSeqRef = useRef<Record<MutationKind, number>>({ create: 0, update: 0, delete: 0 });
  const issueMutation = (kind: MutationKind) => {
    issueSeqRef.current[kind] += 1;
    return { kind, seq: issueSeqRef.current[kind], walletId };
  };
  const settledForCurrentWallet = (issue: ReturnType<typeof issueMutation>): boolean => {
    if (latestWalletIdRef.current === issue.walletId) return true;
    if (issueSeqRef.current[issue.kind] === issue.seq) mutations[issue.kind].reset();
    return false;
  };

  const resetForm = () => {
    setIsCreating(false);
    setEditingLabel(null);
    setFormName('');
    setFormColor(PRESET_COLORS[0]);
    setFormDescription('');
  };

  const handleCreate = () => {
    resetForm();
    setIsCreating(true);
    resetMutationErrors();
  };

  const handleEdit = (label: Label) => {
    setEditingLabel(label);
    setIsCreating(false);
    setFormName(label.name);
    setFormColor(label.color);
    setFormDescription(label.description || '');
    resetMutationErrors();
  };

  const handleCancel = () => {
    resetForm();
    resetMutationErrors();
  };

  const handleSave = async () => {
    const data = {
      name: formName.trim(),
      color: formColor,
      description: formDescription.trim() || undefined,
    };

    const issue = issueMutation(editingLabel ? 'update' : 'create');
    try {
      if (editingLabel) {
        await updateMutation.mutateAsync({ walletId, labelId: editingLabel.id, data });
      } else {
        await createMutation.mutateAsync({ walletId, data });
      }
      if (!settledForCurrentWallet(issue)) return;
      handleCancel();
      onLabelsChange?.();
    } catch (error) {
      if (!settledForCurrentWallet(issue)) return;
      log.debug('Label save mutation surfaced through hook state', { error });
    }
  };

  const handleDelete = async (labelId: string) => {
    const issue = issueMutation('delete');
    try {
      await deleteMutation.mutateAsync({ walletId, labelId });
      if (!settledForCurrentWallet(issue)) return;
      setDeleteConfirm(null);
      onLabelsChange?.();
    } catch (error) {
      if (!settledForCurrentWallet(issue)) return;
      log.debug('Label delete mutation surfaced through hook state', { error });
    }
  };

  const mutationError = createMutation.error || updateMutation.error || deleteMutation.error;
  const error = loadError
    ? extractErrorMessage(loadError)
    : mutationError
      ? extractErrorMessage(mutationError)
      : null;

  return {
    labels: data ?? [],
    loading,
    saving: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    error,
    isCreating,
    editingLabel,
    formName,
    formColor,
    formDescription,
    deleteConfirm,
    setFormName,
    setFormColor,
    setFormDescription,
    clearDeleteConfirm: () => setDeleteConfirm(null),
    requestDeleteConfirm: setDeleteConfirm,
    handleCreate,
    handleEdit,
    handleCancel,
    handleSave,
    handleDelete,
  };
};
