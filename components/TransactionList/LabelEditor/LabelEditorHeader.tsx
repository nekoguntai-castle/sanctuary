import { Check, Edit2 } from 'lucide-react';
import type { Transaction } from '../../../types';

type LabelEditorHeaderProps = {
  selectedTx: Transaction;
  editingLabels: boolean;
  savingLabels: boolean;
  canEdit: boolean;
  onEditLabels: (tx: Transaction) => void;
  onSaveLabels: () => void;
  onCancelEdit: () => void;
};

export function LabelEditorHeader({
  selectedTx,
  editingLabels,
  savingLabels,
  canEdit,
  onEditLabels,
  onSaveLabels,
  onCancelEdit,
}: LabelEditorHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs font-medium text-sanctuary-500 uppercase">Labels</p>
      <LabelEditorHeaderActions
        selectedTx={selectedTx}
        editingLabels={editingLabels}
        savingLabels={savingLabels}
        canEdit={canEdit}
        onEditLabels={onEditLabels}
        onSaveLabels={onSaveLabels}
        onCancelEdit={onCancelEdit}
      />
    </div>
  );
}

function LabelEditorHeaderActions({
  selectedTx,
  editingLabels,
  savingLabels,
  canEdit,
  onEditLabels,
  onSaveLabels,
  onCancelEdit,
}: LabelEditorHeaderProps) {
  if (!editingLabels) {
    return canEdit ? <EditLabelsButton selectedTx={selectedTx} onEditLabels={onEditLabels} /> : null;
  }

  return (
    <div className="flex items-center gap-2">
      <SaveLabelsButton savingLabels={savingLabels} onSaveLabels={onSaveLabels} />
      <button
        onClick={onCancelEdit}
        className="text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function EditLabelsButton({
  selectedTx,
  onEditLabels,
}: {
  selectedTx: Transaction;
  onEditLabels: (tx: Transaction) => void;
}) {
  return (
    <button
      onClick={() => onEditLabels(selectedTx)}
      className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
    >
      <Edit2 className="w-3 h-3" />
      Edit
    </button>
  );
}

function SaveLabelsButton({
  savingLabels,
  onSaveLabels,
}: {
  savingLabels: boolean;
  onSaveLabels: () => void;
}) {
  return (
    <button
      onClick={onSaveLabels}
      disabled={savingLabels}
      className="flex items-center gap-1 text-xs text-white dark:text-sanctuary-100 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 px-2 py-1 rounded transition-colors"
    >
      <SaveLabelsIcon savingLabels={savingLabels} />
      Save
    </button>
  );
}

function SaveLabelsIcon({ savingLabels }: { savingLabels: boolean }) {
  if (savingLabels) {
    return <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />;
  }

  return <Check className="w-3 h-3" />;
}
