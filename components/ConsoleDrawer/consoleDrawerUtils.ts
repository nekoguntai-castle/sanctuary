import { ApiError } from '../../src/api/client';
import type {
  ConsolePromptHistory,
  ConsoleScope,
  ConsoleSession,
  ConsoleToolTrace,
  ConsoleTurn,
} from '../../src/api/console';
import type { Wallet } from '../../src/api/wallets';
import type { ConsoleMessage } from './types';

export const GENERAL_SCOPE_ID = 'general';

export function buildConsoleScope(walletId: string): ConsoleScope {
  return walletId === GENERAL_SCOPE_ID
    ? { kind: 'general' }
    : { kind: 'wallet', walletId };
}

export function isConsoleSetupError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function getScopeLabel(scope: ConsoleScope, wallets: Wallet[]): string {
  if (scope.kind === 'wallet') {
    return (
      wallets.find((wallet) => wallet.id === scope.walletId)?.name ??
      'Wallet scope'
    );
  }
  if (scope.kind === 'wallet_set') return `${scope.walletIds.length} wallets`;
  if (scope.kind === 'object') return `${scope.objectType} scope`;
  if (scope.kind === 'admin') return 'Admin scope';
  return 'General network';
}

export function getPromptTitle(prompt: ConsolePromptHistory): string {
  return prompt.title || prompt.prompt;
}

export function formatShortDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function summarizeTrace(trace: ConsoleToolTrace): string {
  if (trace.status === 'failed') return trace.errorMessage || 'Tool failed';
  if (trace.status === 'denied') return 'Denied by scope or sensitivity';
  if (!trace.facts) return 'Completed';

  const entries = Object.entries(trace.facts).slice(0, 2);
  if (entries.length === 0) return 'Completed';
  return entries
    .map(([key, value]) => `${key}: ${formatTraceValue(value)}`)
    .join(' · ');
}

function formatTraceValue(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'object') return `${Object.keys(value).length} fields`;
  return 'value';
}

export function sortSessionsByUpdatedAt(
  sessions: ConsoleSession[]
): ConsoleSession[] {
  return [...sessions].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export function mergeSession(
  sessions: ConsoleSession[],
  session: ConsoleSession
): ConsoleSession[] {
  return sortSessionsByUpdatedAt([
    session,
    ...sessions.filter((entry) => entry.id !== session.id),
  ]);
}

export function turnsToMessages(turns: ConsoleTurn[]): ConsoleMessage[] {
  return turns.flatMap((turn): ConsoleMessage[] => [
    {
      id: `${turn.id}:prompt`,
      role: 'user',
      content: turn.prompt,
      createdAt: turn.createdAt,
      promptHistoryId: turn.promptHistoryId,
    },
    {
      id: `${turn.id}:response`,
      role: 'assistant',
      content: turn.response || responsePlaceholder(turn.state),
      createdAt: turn.completedAt || turn.createdAt,
      state: turn.state,
      traces: turn.toolTraces ?? [],
      promptHistoryId: turn.promptHistoryId,
    },
  ]);
}

export function appendTurnResult(
  messages: ConsoleMessage[],
  result: {
    turn: ConsoleTurn;
    promptHistory: ConsolePromptHistory;
    toolTraces: ConsoleToolTrace[];
  }
): ConsoleMessage[] {
  return [
    ...messages,
    {
      id: `${result.turn.id}:prompt`,
      role: 'user',
      content: result.turn.prompt,
      createdAt: result.turn.createdAt,
      promptHistoryId: result.promptHistory.id,
    },
    {
      id: `${result.turn.id}:response`,
      role: 'assistant',
      content: result.turn.response || responsePlaceholder(result.turn.state),
      createdAt: result.turn.completedAt || result.turn.createdAt,
      state: result.turn.state,
      traces: result.toolTraces,
      promptHistoryId: result.promptHistory.id,
    },
  ];
}

export function mergePromptHistory(
  prompts: ConsolePromptHistory[],
  prompt: ConsolePromptHistory
): ConsolePromptHistory[] {
  return [prompt, ...prompts.filter((entry) => entry.id !== prompt.id)];
}

function responsePlaceholder(state: string): string {
  return state === 'failed'
    ? 'The Console turn failed.'
    : 'No response was returned.';
}
