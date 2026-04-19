import type { Label } from '../../types';

export interface LabelManagerProps {
  walletId: string;
  onLabelsChange?: () => void;
}

export interface LabelManagerController {
  labels: Label[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  isCreating: boolean;
  editingLabel: Label | null;
  formName: string;
  formColor: string;
  formDescription: string;
  deleteConfirm: string | null;
  setFormName: (value: string) => void;
  setFormColor: (value: string) => void;
  setFormDescription: (value: string) => void;
  clearDeleteConfirm: () => void;
  requestDeleteConfirm: (labelId: string) => void;
  handleCreate: () => void;
  handleEdit: (label: Label) => void;
  handleCancel: () => void;
  handleSave: () => Promise<void>;
  handleDelete: (labelId: string) => Promise<void>;
}
