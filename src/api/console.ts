import apiClient, { ApiError } from "./client";

export type ConsoleSetupReason = "feature-disabled" | "provider-setup";
export type ConsoleProviderSetupReason =
  | "provider_not_configured"
  | "provider_config_sync_failed";

const CONSOLE_FEATURE_FLAG = "sanctuaryConsole";
const PROVIDER_SETUP_REASON_CODES = new Set<unknown>([
  "provider_not_configured",
  "provider_config_sync_failed",
  "not_configured",
]);
const PROVIDER_SETUP_MESSAGES = [
  "AI provider is not configured",
  "AI provider configuration could not be synced",
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

function getConsoleErrorReason(error: ApiError): unknown {
  const response = error.response;
  const details = isRecord(response?.details) ? response.details : null;
  return response?.reason ?? details?.reason;
}

export function isConsoleFeatureDisabledError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.response?.feature === CONSOLE_FEATURE_FLAG
  );
}

export function isConsoleProviderSetupError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 503) return false;

  if (PROVIDER_SETUP_REASON_CODES.has(getConsoleErrorReason(error))) {
    return true;
  }

  return PROVIDER_SETUP_MESSAGES.some((message) =>
    error.message.includes(message),
  );
}

export function getConsoleSetupReason(
  error: unknown,
): ConsoleSetupReason | null {
  if (isConsoleFeatureDisabledError(error)) return "feature-disabled";
  if (isConsoleProviderSetupError(error)) return "provider-setup";
  return null;
}

export type ConsoleScopeKind =
  | "general"
  | "wallet"
  | "wallet_set"
  | "object"
  | "admin";
export type ConsoleSensitivity = "public" | "wallet" | "high" | "admin";
export type ConsoleTurnState =
  | "accepted"
  | "planning"
  | "executing_tools"
  | "synthesizing"
  | "completed"
  | "failed"
  | "canceled";

export type ConsoleScope =
  | { kind: "general" }
  | { kind: "wallet"; walletId: string }
  | { kind: "wallet_set"; walletIds: string[] }
  | {
      kind: "object";
      walletId: string;
      objectType:
        | "transaction"
        | "utxo"
        | "address"
        | "label"
        | "policy"
        | "draft"
        | "insight";
      objectId: string;
    }
  | { kind: "admin" };

export interface ConsoleClientContext {
  mode: "auto";
  routeWalletId?: string;
}

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
  status: "completed" | "denied" | "failed";
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
  plannedTools?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  providerProfileId?: string | null;
  model?: string | null;
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
  clientContext?: ConsoleClientContext;
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
const CONSOLE_TURN_TIMEOUT_MS = 300_000;

export async function listConsoleTools(): Promise<{ tools: ConsoleTool[] }> {
  return apiClient.get<{ tools: ConsoleTool[] }>("/console/tools");
}

export async function listConsoleSessions(
  limit = 20,
  offset = 0,
): Promise<{ sessions: ConsoleSession[] }> {
  return apiClient.get<{ sessions: ConsoleSession[] }>("/console/sessions", {
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
  } = {},
): Promise<{ session: ConsoleSession }> {
  return apiClient.post<{ session: ConsoleSession }>(
    "/console/sessions",
    input,
    {
      retry: noRetry,
    },
  );
}

export async function listConsoleTurns(
  sessionId: string,
): Promise<{ turns: ConsoleTurn[] }> {
  return apiClient.get<{ turns: ConsoleTurn[] }>(
    `/console/sessions/${encodeURIComponent(sessionId)}/turns`,
  );
}

export async function deleteConsoleSession(
  sessionId: string,
): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(
    `/console/sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    noRetry,
  );
}

export async function runConsoleTurn(
  input: ConsoleRunTurnInput,
): Promise<ConsoleTurnResult> {
  return apiClient.post<ConsoleTurnResult>(
    "/console/turns",
    {
      maxSensitivity: "wallet",
      ...input,
    },
    { retry: noRetry, timeoutMs: CONSOLE_TURN_TIMEOUT_MS },
  );
}

export async function listPromptHistory(
  params: ConsolePromptListParams = {},
): Promise<{ prompts: ConsolePromptHistory[] }> {
  const query: Record<string, string | number | boolean | undefined> = {
    limit: params.limit,
    offset: params.offset,
    search: params.search,
    saved: params.saved,
    includeExpired: params.includeExpired,
  };

  return apiClient.get<{ prompts: ConsolePromptHistory[] }>(
    "/console/prompts",
    query,
  );
}

export async function updatePromptHistory(
  promptId: string,
  input: ConsolePromptUpdateInput,
): Promise<{ prompt: ConsolePromptHistory }> {
  return apiClient.patch<{ prompt: ConsolePromptHistory }>(
    `/console/prompts/${encodeURIComponent(promptId)}`,
    input,
    noRetry,
  );
}

export async function deletePromptHistory(
  promptId: string,
): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(
    `/console/prompts/${encodeURIComponent(promptId)}`,
    undefined,
    noRetry,
  );
}

export async function clearPromptHistory(): Promise<{
  success: boolean;
  deleted: number;
}> {
  return apiClient.delete<{ success: boolean; deleted: number }>(
    "/console/prompts",
    undefined,
    noRetry,
  );
}

export async function replayPromptHistory(
  promptId: string,
  input: Omit<ConsoleRunTurnInput, "prompt"> = {},
): Promise<ConsoleTurnResult> {
  return apiClient.post<ConsoleTurnResult>(
    `/console/prompts/${encodeURIComponent(promptId)}/replay`,
    input,
    { retry: noRetry, timeoutMs: CONSOLE_TURN_TIMEOUT_MS },
  );
}
