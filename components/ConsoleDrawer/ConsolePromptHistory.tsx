import React from 'react';
import {
  Clock3,
  Infinity,
  RefreshCw,
  RotateCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import type { ConsolePromptHistory as ConsolePromptHistoryItem } from '../../src/api/console';
import { formatShortDate, getPromptTitle } from './consoleDrawerUtils';

interface ConsolePromptHistoryProps {
  prompts: ConsolePromptHistoryItem[];
  search: string;
  replayingPromptId: string | null;
  onSearchChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  onReplay: (promptId: string) => Promise<void>;
  onDelete: (promptId: string) => Promise<void>;
  onToggleSaved: (prompt: ConsolePromptHistoryItem) => Promise<void>;
  onSetExpiration: (
    prompt: ConsolePromptHistoryItem,
    days: number | null
  ) => Promise<void>;
}

const EXPIRATION_DAYS = 30;

const PromptActionButton: React.FC<{
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, disabled = false, onClick, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary-500"
  >
    {children}
  </button>
);

const PromptHistoryRow: React.FC<{
  prompt: ConsolePromptHistoryItem;
  isReplaying: boolean;
  onReplay: (promptId: string) => Promise<void>;
  onDelete: (promptId: string) => Promise<void>;
  onToggleSaved: (prompt: ConsolePromptHistoryItem) => Promise<void>;
  onSetExpiration: (
    prompt: ConsolePromptHistoryItem,
    days: number | null
  ) => Promise<void>;
}> = ({
  prompt,
  isReplaying,
  onReplay,
  onDelete,
  onToggleSaved,
  onSetExpiration,
}) => {
  const expiresAt = formatShortDate(prompt.expiresAt);
  const lastUsedAt = formatShortDate(prompt.lastReplayedAt || prompt.updatedAt);

  return (
    <li className="border-t border-sanctuary-100 px-3 py-2 first:border-t-0 dark:border-sanctuary-800">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-sanctuary-800 dark:text-sanctuary-100">
            {getPromptTitle(prompt)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-sanctuary-500 dark:text-sanctuary-400">
            {lastUsedAt || 'New prompt'}
            {expiresAt ? ` · Expires ${expiresAt}` : ''}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <PromptActionButton
            title="Replay prompt"
            disabled={isReplaying}
            onClick={() => void onReplay(prompt.id)}
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${isReplaying ? 'animate-spin' : ''}`}
            />
          </PromptActionButton>
          <PromptActionButton
            title={prompt.saved ? 'Unsave prompt' : 'Save prompt'}
            onClick={() => void onToggleSaved(prompt)}
          >
            <Star
              className={`h-3.5 w-3.5 ${prompt.saved ? 'fill-current text-warning-500' : ''}`}
            />
          </PromptActionButton>
          <PromptActionButton
            title={prompt.expiresAt ? 'Clear expiration' : 'Expire in 30 days'}
            onClick={() =>
              void onSetExpiration(
                prompt,
                prompt.expiresAt ? null : EXPIRATION_DAYS
              )
            }
          >
            {prompt.expiresAt ? (
              <Infinity className="h-3.5 w-3.5" />
            ) : (
              <Clock3 className="h-3.5 w-3.5" />
            )}
          </PromptActionButton>
          <PromptActionButton
            title="Delete prompt"
            onClick={() => void onDelete(prompt.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </PromptActionButton>
        </div>
      </div>
    </li>
  );
};

export const ConsolePromptHistory: React.FC<ConsolePromptHistoryProps> = ({
  prompts,
  search,
  replayingPromptId,
  onSearchChange,
  onRefresh,
  onReplay,
  onDelete,
  onToggleSaved,
  onSetExpiration,
}) => (
  <section className="border-t border-sanctuary-200 dark:border-sanctuary-800">
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sanctuary-400" />
        <input
          type="search"
          aria-label="Search prompt history"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-8 w-full rounded-md border border-sanctuary-200 bg-transparent pl-7 pr-2 text-xs text-sanctuary-800 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-sanctuary-700 dark:text-sanctuary-100"
          placeholder="Search prompts"
        />
      </div>
      <button
        type="button"
        title="Refresh prompt history"
        aria-label="Refresh prompt history"
        onClick={() => void onRefresh()}
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 hover:text-sanctuary-800 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-100 focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
    <ul className="max-h-44 overflow-y-auto border-t border-sanctuary-100 dark:border-sanctuary-800">
      {prompts.length > 0 ? (
        prompts.map((prompt) => (
          <PromptHistoryRow
            key={prompt.id}
            prompt={prompt}
            isReplaying={replayingPromptId === prompt.id}
            onReplay={onReplay}
            onDelete={onDelete}
            onToggleSaved={onToggleSaved}
            onSetExpiration={onSetExpiration}
          />
        ))
      ) : (
        <li className="px-4 py-4 text-xs text-sanctuary-500 dark:text-sanctuary-400">
          No prompt history
        </li>
      )}
    </ul>
  </section>
);
