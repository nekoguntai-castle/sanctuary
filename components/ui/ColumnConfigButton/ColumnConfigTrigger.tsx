import { Columns } from 'lucide-react';

interface ColumnConfigTriggerProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function ColumnConfigTrigger({ isOpen, onToggle }: ColumnConfigTriggerProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        p-2 rounded-md transition-colors
        ${isOpen
          ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100'
          : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'
        }
      `}
      title="Configure columns"
      aria-label="Configure columns"
      aria-expanded={isOpen}
    >
      <Columns className="w-4 h-4" />
    </button>
  );
}
