import React from 'react';
import { Brain } from 'lucide-react';
import {
  getAppShortcut,
  getShortcutDisplayLabel,
} from '../../../src/app/shortcuts';

interface SidebarConsoleQuickActionsProps {
  onOpenConsole: () => void;
}

export const SidebarConsoleQuickActions: React.FC<
  SidebarConsoleQuickActionsProps
> = ({ onOpenConsole }) => {
  const shortcut = getShortcutDisplayLabel(getAppShortcut('console.open'));

  return (
    <div
      aria-label="Sidebar quick actions"
      className="mb-2 ml-8 mt-1 flex h-8 items-center gap-1.5"
    >
      <button
        type="button"
        title={`Open Sanctuary Console (${shortcut})`}
        aria-label="Open Sanctuary Console"
        onClick={onOpenConsole}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-sanctuary-400 transition-colors hover:border-sanctuary-200 hover:bg-sanctuary-100 hover:text-primary-700 dark:text-sanctuary-500 dark:hover:border-sanctuary-700 dark:hover:bg-sanctuary-800 dark:hover:text-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Brain className="h-4 w-4" />
      </button>
    </div>
  );
};
