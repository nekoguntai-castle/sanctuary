import React from 'react';
import { Brain, Keyboard } from 'lucide-react';
import {
  getAppShortcut,
  getShortcutDisplayLabel,
} from '../../../src/app/shortcuts';

interface SidebarConsoleQuickActionsProps {
  consoleAvailable: boolean;
  onOpenConsole?: () => void;
  onOpenShortcuts: () => void;
}

export const SidebarConsoleQuickActions: React.FC<
  SidebarConsoleQuickActionsProps
> = ({ consoleAvailable, onOpenConsole, onOpenShortcuts }) => {
  const consoleShortcut = getShortcutDisplayLabel(getAppShortcut('console.open'));
  const shortcutsShortcut = getShortcutDisplayLabel(
    getAppShortcut('shortcuts.open')
  );

  return (
    <div
      aria-label="Sidebar actions"
      className="mb-2 mt-4"
    >
      <p className="px-4 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-sanctuary-400 dark:text-sanctuary-500">
        Actions
      </p>
      <div className="flex h-8 items-center gap-1.5 px-3">
        {consoleAvailable && onOpenConsole ? (
          <button
            type="button"
            title={`Open AI Console (${consoleShortcut})`}
            aria-label="Open AI Console"
            onClick={onOpenConsole}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-sanctuary-400 transition-colors hover:border-sanctuary-200 hover:bg-sanctuary-100 hover:text-primary-700 dark:text-sanctuary-500 dark:hover:border-sanctuary-700 dark:hover:bg-sanctuary-800 dark:hover:text-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Brain className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          title={`Show keyboard shortcuts (${shortcutsShortcut})`}
          aria-label="Show keyboard shortcuts"
          onClick={onOpenShortcuts}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-sanctuary-400 transition-colors hover:border-sanctuary-200 hover:bg-sanctuary-100 hover:text-primary-700 dark:text-sanctuary-500 dark:hover:border-sanctuary-700 dark:hover:bg-sanctuary-800 dark:hover:text-primary-400 focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Keyboard className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
