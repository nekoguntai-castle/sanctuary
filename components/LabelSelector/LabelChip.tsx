import { Tag, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Label } from '../../types';

interface LabelChipProps {
  className?: string;
  label: Label;
  onClick?: () => void;
  onRemove?: (event: MouseEvent) => void;
  removable?: boolean;
  removeClassName?: string;
}

export function LabelChip({
  className = '',
  label,
  onClick,
  onRemove,
  removable = false,
  removeClassName = '',
}: LabelChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${className}`}
      style={{ backgroundColor: label.color }}
      onClick={onClick}
    >
      <Tag className="w-3 h-3" />
      {label.name}
      {removable && (
        <X
          className={`w-3 h-3 hover:scale-110 transition-transform ${removeClassName}`}
          onClick={onRemove}
        />
      )}
    </span>
  );
}
