import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const classes = tone === 'error'
    ? 'bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-300'
    : 'bg-success-50 text-success-700 dark:bg-success-100/20 dark:text-success-700';
  return (
    <div role="alert" className={`p-3 rounded-md text-sm ${classes}`}>
      {children}
    </div>
  );
}

export function IconTextButton({
  icon,
  children,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 text-sm text-sanctuary-700 dark:text-sanctuary-300 disabled:opacity-50"
    >
      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
