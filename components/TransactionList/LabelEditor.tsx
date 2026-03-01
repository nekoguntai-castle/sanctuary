import React from 'react';
import { Transaction, Label } from '../../types';
import { AILabelSuggestion } from '../AILabelSuggestion';
import { Tag, Check, Edit2 } from 'lucide-react';

interface LabelEditorProps {
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
}

export const LabelEditor: React.FC<LabelEditorProps> = ({
  selectedTx,
  editingLabels,
  availableLabels,
  selectedLabelIds,
  savingLabels,
  canEdit,
  aiEnabled,
  onEditLabels,
  onSaveLabels,
  onCancelEdit,
  onToggleLabel,
  onAISuggestion,
}) => {
  return (
    <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-sanctuary-500 uppercase">Labels</p>
        {!editingLabels ? (
          canEdit && (
            <button
              onClick={() => onEditLabels(selectedTx)}
              className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >
              <Edit2 className="w-3 h-3" />
              Edit
            </button>
          )
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={onSaveLabels}
              disabled={savingLabels}
              className="flex items-center gap-1 text-xs text-white dark:text-sanctuary-100 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 px-2 py-1 rounded transition-colors"
            >
              {savingLabels ? (
                <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className="text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {editingLabels ? (
        <div className="space-y-3">
          {/* AI Label Suggestion - only show when AI is enabled */}
          {aiEnabled && (
            <AILabelSuggestion
              transaction={selectedTx}
              existingLabels={availableLabels.map(l => l.name)}
              onSuggestionAccepted={onAISuggestion}
            />
          )}

          {availableLabels.length === 0 ? (
            <p className="text-sm text-sanctuary-500">No labels available. Create labels in wallet settings.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableLabels.map(label => {
                const isSelected = selectedLabelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    onClick={() => onToggleLabel(label.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-all ${
                      isSelected
                        ? 'text-white ring-2 ring-offset-2 ring-sanctuary-500 dark:ring-offset-sanctuary-950'
                        : 'text-white opacity-50 hover:opacity-75'
                    }`}
                    style={{ backgroundColor: label.color }}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    {label.name}
                    {isSelected && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(selectedTx.labels && selectedTx.labels.length > 0) ? (
            selectedTx.labels.map(label => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: label.color }}
              >
                <Tag className="w-3.5 h-3.5" />
                {label.name}
              </span>
            ))
          ) : selectedTx.label ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
              <Tag className="w-3.5 h-3.5" />
              {selectedTx.label}
            </span>
          ) : (
            <span className="text-sm text-sanctuary-400 italic">No labels</span>
          )}
        </div>
      )}
    </div>
  );
};
