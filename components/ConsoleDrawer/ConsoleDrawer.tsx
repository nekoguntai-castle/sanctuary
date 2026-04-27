import React, { useCallback, useEffect, useRef } from 'react';
import { Brain, Plus, Wrench, X } from 'lucide-react';
import { ConsoleComposer } from './ConsoleComposer';
import { ConsoleMessageList } from './ConsoleMessageList';
import { ConsolePromptHistory } from './ConsolePromptHistory';
import { ConsoleScopeSelector } from './ConsoleScopeSelector';
import { ConsoleSetupState } from './ConsoleSetupState';
import { useConsoleDrawerController } from './useConsoleDrawerController';
import type { ConsoleDrawerProps } from './types';

const NEW_SESSION_VALUE = 'new-session';

const DrawerHeader: React.FC<{
  toolCount: number;
  onNewSession: () => void;
  onClose: () => void;
}> = ({ toolCount, onNewSession, onClose }) => (
  <header className="flex items-center justify-between border-b border-sanctuary-200 px-4 py-3 dark:border-sanctuary-800">
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg surface-secondary text-primary-600 dark:text-primary-400">
        <Brain className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          Sanctuary Console
        </h2>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-sanctuary-500 dark:text-sanctuary-400">
          <Wrench className="h-3 w-3" />
          {toolCount} tools
        </p>
      </div>
    </div>
    <div className="flex items-center gap-1">
      <button
        type="button"
        title="New Console session"
        aria-label="New Console session"
        onClick={onNewSession}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Close Console"
        aria-label="Close Console"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  </header>
);

export const ConsoleDrawer: React.FC<ConsoleDrawerProps> = ({
  isOpen,
  onClose,
  wallets,
  isAdmin = false,
}) => {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const controller = useConsoleDrawerController({ isOpen, wallets });

  const closeDrawer = useCallback(() => {
    onClose();
    const schedule =
      window.requestAnimationFrame?.bind(window) ??
      ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 0));
    schedule(() => restoreFocusRef.current?.focus?.());
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDrawer, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close Console backdrop"
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px] dark:bg-black/40"
        onClick={closeDrawer}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Sanctuary Console"
        className="surface-flyout relative flex h-full w-full flex-col border-l border-sanctuary-200 shadow-2xl dark:border-sanctuary-800 sm:max-w-[500px]"
      >
        <DrawerHeader
          toolCount={controller.tools.length}
          onNewSession={controller.startNewSession}
          onClose={closeDrawer}
        />

        <div className="flex items-center gap-2 border-b border-sanctuary-200 px-4 py-3 dark:border-sanctuary-800">
          <ConsoleScopeSelector
            wallets={wallets}
            selectedWalletId={controller.selectedWalletId}
            onChange={controller.setSelectedWalletId}
          />
          <select
            aria-label="Console session"
            value={controller.selectedSessionId ?? NEW_SESSION_VALUE}
            onChange={(event) => {
              const sessionId =
                event.target.value === NEW_SESSION_VALUE
                  ? null
                  : event.target.value;
              void controller.selectSession(sessionId);
            }}
            className="min-w-0 flex-1 rounded-md border border-sanctuary-200 bg-transparent px-2 py-1 text-xs text-sanctuary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-sanctuary-700 dark:text-sanctuary-100"
          >
            <option value={NEW_SESSION_VALUE}>New session</option>
            {controller.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || `Session ${session.id.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {controller.error ? (
          <div className="border-b border-warning-200 bg-warning-50 px-4 py-2 text-xs text-warning-800 dark:border-warning-900 dark:bg-warning-950 dark:text-warning-200">
            {controller.error}
          </div>
        ) : null}

        {controller.setupNeeded ? (
          <ConsoleSetupState isAdmin={isAdmin} onClose={closeDrawer} />
        ) : (
          <>
            <ConsoleMessageList
              messages={controller.messages}
              loading={controller.loading}
              sending={controller.sending}
              messagesEndRef={controller.messagesEndRef}
            />
            <ConsolePromptHistory
              prompts={controller.prompts}
              search={controller.promptSearch}
              replayingPromptId={controller.replayingPromptId}
              onSearchChange={controller.setPromptSearch}
              onRefresh={controller.refreshPrompts}
              onReplay={controller.replayPrompt}
              onDelete={controller.deletePrompt}
              onToggleSaved={controller.togglePromptSaved}
              onSetExpiration={controller.setPromptExpiration}
            />
            <ConsoleComposer
              input={controller.input}
              sending={controller.sending}
              inputRef={controller.inputRef}
              onInputChange={controller.setInput}
              onSend={controller.sendPrompt}
            />
          </>
        )}
      </aside>
    </div>
  );
};
