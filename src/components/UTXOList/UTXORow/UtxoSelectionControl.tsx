import { Check } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { UtxoRowModel } from './types';

interface UtxoSelectionControlProps {
  model: UtxoRowModel;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
}

export function UtxoSelectionControl({
  model,
  selectable,
  onToggleSelect,
}: UtxoSelectionControlProps) {
  if (!selectable || model.isDisabled) {
    return null;
  }

  const handleClick = () => {
    onToggleSelect?.(model.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onToggleSelect?.(model.id);
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={model.isSelected}
      aria-label="Select UTXO"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`${model.selectionClassName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`}
    >
      {model.isSelected ? <Check className="w-3 h-3" /> : null}
    </div>
  );
}
