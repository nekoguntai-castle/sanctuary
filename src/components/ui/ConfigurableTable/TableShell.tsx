import type { ReactNode } from 'react';

interface TableShellProps {
  children: ReactNode;
}

export function TableShell({ children }: TableShellProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
          {children}
        </table>
      </div>
    </div>
  );
}
