import React from 'react';
import { Keyboard, X } from 'lucide-react';
import {
  appShortcuts,
  getShortcutDisplayLabel,
  type AppShortcutDefinition,
} from '../../src/app/shortcuts';

interface KeyboardShortcutsModalProps {
  show: boolean;
  consoleAvailable: boolean;
  onClose: () => void;
}

function isShortcutVisible(
  shortcut: AppShortcutDefinition,
  consoleAvailable: boolean
): boolean {
  return shortcut.id !== 'console.open' || consoleAvailable;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  show,
  consoleAvailable,
  onClose,
}) => {
  if (!show) return null;

  const shortcuts = appShortcuts.filter((shortcut) =>
    isShortcutVisible(shortcut, consoleAvailable)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="surface-elevated w-full max-w-md rounded-lg border border-sanctuary-200 shadow-2xl dark:border-sanctuary-800"
      >
        <header className="flex items-center justify-between border-b border-sanctuary-200 px-4 py-3 dark:border-sanctuary-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg surface-secondary text-primary-600 dark:text-primary-400">
              <Keyboard className="h-5 w-5" />
            </span>
            <h2 className="truncate text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
              Keyboard shortcuts
            </h2>
          </div>
          <button
            type="button"
            title="Close keyboard shortcuts"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-2 p-4">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              className="flex items-center justify-between gap-4 rounded-md px-2 py-2"
            >
              <span className="text-sm text-sanctuary-700 dark:text-sanctuary-200">
                {shortcut.label}
              </span>
              <kbd className="rounded border border-sanctuary-200 bg-sanctuary-50 px-2 py-1 font-mono text-xs text-sanctuary-700 dark:border-sanctuary-700 dark:bg-sanctuary-900 dark:text-sanctuary-200">
                {getShortcutDisplayLabel(shortcut)}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
