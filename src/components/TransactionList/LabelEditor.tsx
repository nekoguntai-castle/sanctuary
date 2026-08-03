import React from 'react';
import { EditingLabelsPanel } from './LabelEditor/EditingLabelsPanel';
import { LabelEditorHeader } from './LabelEditor/LabelEditorHeader';
import { ReadOnlyLabelsPanel } from './LabelEditor/ReadOnlyLabelsPanel';
import type { LabelEditorProps } from './LabelEditor/types';

export const LabelEditor: React.FC<LabelEditorProps> = ({
  selectedTx,
  editingLabels,
  availableLabels,
  selectedLabelIds,
  savingLabels,
  mutationError,
  canEdit,
  aiEnabled,
  onEditLabels,
  onSaveLabels,
  onCancelEdit,
  onToggleLabel,
  onAISuggestion,
}) => {
  return (
    <div className="surface-muted p-4 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800">
      <LabelEditorHeader
        selectedTx={selectedTx}
        editingLabels={editingLabels}
        savingLabels={savingLabels}
        canEdit={canEdit}
        onEditLabels={onEditLabels}
        onSaveLabels={onSaveLabels}
        onCancelEdit={onCancelEdit}
      />
      {editingLabels ? (
        <>
          {mutationError && (
            <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-400">
              {mutationError}
            </p>
          )}
          <EditingLabelsPanel
            selectedTx={selectedTx}
            availableLabels={availableLabels}
            selectedLabelIds={selectedLabelIds}
            aiEnabled={aiEnabled}
            onToggleLabel={onToggleLabel}
            onAISuggestion={onAISuggestion}
          />
        </>
      ) : (
        <ReadOnlyLabelsPanel selectedTx={selectedTx} />
      )}
    </div>
  );
};
