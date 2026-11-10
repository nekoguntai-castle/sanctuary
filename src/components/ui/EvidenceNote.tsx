import type { ReactNode } from 'react';

/** Muted inline note qualifying a device's capability evidence. */
export function EvidenceNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-xs text-sanctuary-500 dark:text-sanctuary-400${className ? ` ${className}` : ''}`}
      role="note"
    >
      {children}
    </p>
  );
}
