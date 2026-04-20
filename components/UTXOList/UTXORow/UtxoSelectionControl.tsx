import { Check } from 'lucide-react';
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

  return (
    <div onClick={handleClick} className={model.selectionClassName}>
      {model.isSelected ? <Check className="w-3 h-3" /> : null}
    </div>
  );
}
