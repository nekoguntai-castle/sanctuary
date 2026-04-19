import type { Label, Transaction } from '../../../types';

export type LabelEditorProps = {
  selectedTx: Transaction;
  editingLabels: boolean;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingLabels: boolean;
  canEdit: boolean;
  aiEnabled: boolean;
  onEditLabels: (tx: Transaction) => void;
  onSaveLabels: () => void;
  onCancelEdit: () => void;
  onToggleLabel: (labelId: string) => void;
  onAISuggestion: (suggestion: string) => void;
};
