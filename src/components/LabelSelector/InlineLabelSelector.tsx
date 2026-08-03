import { Plus } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Label } from '../../types';
import { LabelChip } from './LabelChip';

interface InlineLabelSelectorProps {
  availableLabels: Label[];
  className: string;
  disabled: boolean;
  onOpenDropdown: () => void;
  onRemoveLabel: (labelId: string, event: MouseEvent) => void;
  onToggleLabel: (label: Label) => void;
  selectedLabels: Label[];
}

export function InlineLabelSelector({
  availableLabels,
  className,
  disabled,
  onOpenDropdown,
  onRemoveLabel,
  onToggleLabel,
  selectedLabels,
}: InlineLabelSelectorProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {selectedLabels.map((label) => (
        <LabelChip
          key={label.id}
          className="cursor-pointer hover:opacity-80 transition-opacity"
          label={label}
          onClick={() => !disabled && onToggleLabel(label)}
          removable={!disabled}
          onRemove={(event) => onRemoveLabel(label.id, event)}
        />
      ))}
      {!disabled && availableLabels.length > 0 && (
        <button
          onClick={onOpenDropdown}
          className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-full text-xs text-sanctuary-500 hover:border-primary-500 hover:text-primary-500 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Label
        </button>
      )}
    </div>
  );
}
