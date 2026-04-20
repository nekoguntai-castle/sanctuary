import { RotateCcw } from 'lucide-react';

interface ColumnConfigResetButtonProps {
  isDefault: boolean;
  onReset: () => void;
}

export function ColumnConfigResetButton({ isDefault, onReset }: ColumnConfigResetButtonProps) {
  return (
    <div className="mt-2 pt-2 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <button
        onClick={onReset}
        disabled={isDefault}
        className={`
          w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
          transition-colors
          ${isDefault
            ? 'text-sanctuary-300 dark:text-sanctuary-600 cursor-not-allowed'
            : 'text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
          }
        `}
      >
        <RotateCcw className="w-3 h-3" />
        Reset to Default
      </button>
    </div>
  );
}
