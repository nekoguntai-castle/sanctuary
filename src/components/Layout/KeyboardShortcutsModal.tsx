import React, { useRef, type RefObject } from 'react';
import { Keyboard, X } from 'lucide-react';
import {
  appShortcuts,
  getShortcutDisplayLabel,
  type AppShortcutDefinition,
} from '../../app/shortcuts';
import { useNativeDialogLifecycle } from './useNativeDialogLifecycle';

interface KeyboardShortcutsModalProps {
  show: boolean;
  consoleAvailable: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
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
  returnFocusRef,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const localReturnFocusRef = useRef<HTMLElement>(null);
  const focusReturn = returnFocusRef ?? localReturnFocusRef;
  useNativeDialogLifecycle({ isOpen: show, dialogRef, initialFocusRef: closeRef, returnFocusRef: focusReturn });
  if (!show) return null;

  const shortcuts = appShortcuts.filter((shortcut) =>
    isShortcutVisible(shortcut, consoleAvailable)
  );

  return (
    <dialog
      ref={dialogRef}
      aria-label="Keyboard shortcuts"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 m-0 flex h-screen max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 px-4 backdrop:backdrop-blur-sm"
    >
      <div
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
            ref={closeRef}
            type="button"
            title="Close keyboard shortcuts"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 focus-contrast"
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
    </dialog>
  );
};
