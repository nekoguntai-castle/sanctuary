import { useState } from 'react';
import {
  useCreateWalletLabel,
  useDeleteWalletLabel,
  useUpdateWalletLabel,
  useWalletLabels,
} from '../../hooks/queries/useWalletLabels';
import { extractErrorMessage } from '../../shared/utils/errors';
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

  const resetMutationErrors = () => {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
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

    try {
      if (editingLabel) {
        await updateMutation.mutateAsync({ walletId, labelId: editingLabel.id, data });
      } else {
        await createMutation.mutateAsync({ walletId, data });
      }
      handleCancel();
      onLabelsChange?.();
    } catch (error) {
      log.debug('Label save mutation surfaced through hook state', { error });
    }
  };

  const handleDelete = async (labelId: string) => {
    try {
      await deleteMutation.mutateAsync({ walletId, labelId });
      setDeleteConfirm(null);
      onLabelsChange?.();
    } catch (error) {
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
