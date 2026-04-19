import { Check, Tag } from 'lucide-react';
import { AILabelSuggestion } from '../../AILabelSuggestion';
import type { Label, Transaction } from '../../../types';

type EditingLabelsPanelProps = {
  selectedTx: Transaction;
  availableLabels: Label[];
  selectedLabelIds: string[];
  aiEnabled: boolean;
  onToggleLabel: (labelId: string) => void;
  onAISuggestion: (suggestion: string) => void;
};

export function EditingLabelsPanel({
  selectedTx,
  availableLabels,
  selectedLabelIds,
  aiEnabled,
  onToggleLabel,
  onAISuggestion,
}: EditingLabelsPanelProps) {
  return (
    <div className="space-y-3">
      {aiEnabled && (
        <AILabelSuggestion
          transaction={selectedTx}
          existingLabels={availableLabels.map(label => label.name)}
          onSuggestionAccepted={onAISuggestion}
        />
      )}
      <EditableLabelChoices
        availableLabels={availableLabels}
        selectedLabelIds={selectedLabelIds}
        onToggleLabel={onToggleLabel}
      />
    </div>
  );
}

function EditableLabelChoices({
  availableLabels,
  selectedLabelIds,
  onToggleLabel,
}: {
  availableLabels: Label[];
  selectedLabelIds: string[];
  onToggleLabel: (labelId: string) => void;
}) {
  if (availableLabels.length === 0) {
    return <p className="text-sm text-sanctuary-500">No labels available. Create labels in wallet settings.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {availableLabels.map(label => (
        <EditableLabelChip
          key={label.id}
          label={label}
          selected={selectedLabelIds.includes(label.id)}
          onToggleLabel={onToggleLabel}
        />
      ))}
    </div>
  );
}

function EditableLabelChip({
  label,
  selected,
  onToggleLabel,
}: {
  label: Label;
  selected: boolean;
  onToggleLabel: (labelId: string) => void;
}) {
  return (
    <button
      onClick={() => onToggleLabel(label.id)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-all ${
        selected
          ? 'text-white ring-2 ring-offset-2 ring-sanctuary-500 dark:ring-offset-sanctuary-950'
          : 'text-white opacity-50 hover:opacity-75'
      }`}
      style={{ backgroundColor: label.color }}
    >
      <Tag className="w-3.5 h-3.5" />
      {label.name}
      {selected && <Check className="w-3.5 h-3.5" />}
    </button>
  );
}
