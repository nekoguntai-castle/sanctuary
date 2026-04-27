import apiClient from './client';

export type ConsoleScopeKind =
  | 'general'
  | 'wallet'
  | 'wallet_set'
  | 'object'
  | 'admin';
export type ConsoleSensitivity = 'public' | 'wallet' | 'high' | 'admin';
export type ConsoleTurnState =
  | 'accepted'
  | 'planning'
  | 'executing_tools'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type ConsoleScope =
  | { kind: 'general' }
  | { kind: 'wallet'; walletId: string }
  | { kind: 'wallet_set'; walletIds: string[] }
  | {
      kind: 'object';
      walletId: string;
      objectType:
        | 'transaction'
        | 'utxo'
        | 'address'
        | 'label'
        | 'policy'
        | 'draft'
        | 'insight';
      objectId: string;
    }
  | { kind: 'admin' };

export interface ConsoleTool {
  name: string;
  title: string;
  description: string;
  sensitivity: ConsoleSensitivity;
  requiredScope: string;
  inputFields: string[];
  available: boolean;
  budgets: Record<string, unknown>;
}

export interface ConsoleSession {
  id: string;
  userId: string;
  title?: string | null;
  scope?: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsoleToolTrace {
  id: string;
  turnId: string;
  toolName: string;
  status: 'completed' | 'denied' | 'failed';
  facts?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
  sensitivity?: ConsoleSensitivity | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface ConsoleTurn {
  id: string;
  sessionId: string;
  promptHistoryId?: string | null;
  state: ConsoleTurnState;
  prompt: string;
  response?: string | null;
  scope?: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  toolTraces?: ConsoleToolTrace[];
  createdAt: string;
  completedAt?: string | null;
}

export interface ConsolePromptHistory {
  id: string;
  userId: string;
  sessionId?: string | null;
  prompt: string;
  scope?: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  saved: boolean;
  title?: string | null;
  expiresAt?: string | null;
  replayCount: number;
  lastReplayedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsoleRunTurnInput {
  sessionId?: string;
  prompt: string;
  scope?: ConsoleScope;
  maxSensitivity?: ConsoleSensitivity;
  expiresAt?: string;
}

export interface ConsoleTurnResult {
  session: ConsoleSession;
  turn: ConsoleTurn;
  promptHistory: ConsolePromptHistory;
  toolTraces: ConsoleToolTrace[];
}

export interface ConsolePromptListParams {
  limit?: number;
  offset?: number;
  search?: string;
  saved?: boolean;
  includeExpired?: boolean;
}

export interface ConsolePromptUpdateInput {
  saved?: boolean;
  title?: string | null;
  expiresAt?: string | null;
}

const noRetry = { enabled: false };

export async function listConsoleTools(): Promise<{ tools: ConsoleTool[] }> {
  return apiClient.get<{ tools: ConsoleTool[] }>('/console/tools');
}

export async function listConsoleSessions(
  limit = 20,
  offset = 0
): Promise<{ sessions: ConsoleSession[] }> {
  return apiClient.get<{ sessions: ConsoleSession[] }>('/console/sessions', {
    limit,
    offset,
  });
}

export async function createConsoleSession(
  input: {
    title?: string;
    scope?: ConsoleScope;
    maxSensitivity?: ConsoleSensitivity;
    expiresAt?: string;
  } = {}
): Promise<{ session: ConsoleSession }> {
  return apiClient.post<{ session: ConsoleSession }>(
    '/console/sessions',
    input,
    {
      retry: noRetry,
    }
  );
}

export async function listConsoleTurns(
  sessionId: string
): Promise<{ turns: ConsoleTurn[] }> {
  return apiClient.get<{ turns: ConsoleTurn[] }>(
    `/console/sessions/${encodeURIComponent(sessionId)}/turns`
  );
}

export async function runConsoleTurn(
  input: ConsoleRunTurnInput
): Promise<ConsoleTurnResult> {
  return apiClient.post<ConsoleTurnResult>(
    '/console/turns',
    {
      maxSensitivity: 'wallet',
      ...input,
    },
    { retry: noRetry }
  );
}

export async function listPromptHistory(
  params: ConsolePromptListParams = {}
): Promise<{ prompts: ConsolePromptHistory[] }> {
  const query: Record<string, string | number | boolean | undefined> = {
    limit: params.limit,
    offset: params.offset,
    search: params.search,
    saved: params.saved,
    includeExpired: params.includeExpired,
  };

  return apiClient.get<{ prompts: ConsolePromptHistory[] }>(
    '/console/prompts',
    query
  );
}

export async function updatePromptHistory(
  promptId: string,
  input: ConsolePromptUpdateInput
): Promise<{ prompt: ConsolePromptHistory }> {
  return apiClient.patch<{ prompt: ConsolePromptHistory }>(
    `/console/prompts/${encodeURIComponent(promptId)}`,
    input,
    noRetry
  );
}

export async function deletePromptHistory(
  promptId: string
): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(
    `/console/prompts/${encodeURIComponent(promptId)}`,
    undefined,
    noRetry
  );
}

export async function replayPromptHistory(
  promptId: string,
  input: Omit<ConsoleRunTurnInput, 'prompt'> = {}
): Promise<ConsoleTurnResult> {
  return apiClient.post<ConsoleTurnResult>(
    `/console/prompts/${encodeURIComponent(promptId)}/replay`,
    input,
    { retry: noRetry }
  );
}
