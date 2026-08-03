import { Tag } from 'lucide-react';
import type { LabelBadgesProps } from './types';

export function LabelBadges({
  labels,
  maxDisplay = 3,
  onClick,
  size = 'sm',
}: LabelBadgesProps) {
  if (!labels || labels.length === 0) return null;

  const displayLabels = labels.slice(0, maxDisplay);
  const remaining = labels.length - maxDisplay;
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm';
  const iconClassName = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {displayLabels.map((label) => (
        <span
          key={label.id}
          className={`inline-flex items-center gap-1 rounded-full font-medium text-white ${sizeClasses}`}
          style={{ backgroundColor: label.color }}
          title={label.name}
        >
          <Tag className={iconClassName} />
          {label.name}
        </span>
      ))}
      {remaining > 0 && (
        <span
          className={`inline-flex items-center rounded-full font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 ${sizeClasses}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}
