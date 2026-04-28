import type {
  ConsolePromptHistory,
  ConsoleScope,
  ConsoleSetupReason,
  ConsoleSession,
  ConsoleToolTrace,
  ConsoleTurn,
  ConsoleTurnResult,
} from "../../src/api/console";
import { getConsoleSetupReason } from "../../src/api/console";
import type { Wallet } from "../../src/api/wallets";
import type { ConsoleMessage } from "./types";

export const GENERAL_SCOPE_ID = "general";
export const AUTO_CONTEXT_ID = "auto";
export const ALL_WALLETS_SCOPE_ID = "all-wallets";
export const MAX_WALLET_SET_SCOPE_WALLETS = 25;
const DEFAULT_VISIBLE_MESSAGE_UNITS = 8;

export interface ConsoleCompressedHistoryItem {
  kind: "summary";
  id: string;
  hiddenMessageCount: number;
  hiddenTurnCount: number;
  duplicateTurnCount: number;
}

export type ConsoleMessageDisplayItem =
  | { kind: "message"; message: ConsoleMessage }
  | ConsoleCompressedHistoryItem;

interface ConsoleMessageUnit {
  id: string;
  messages: ConsoleMessage[];
  dedupeKey: string | null;
}

export function buildWalletSetScopeIds(wallets: Wallet[]): string[] {
  const walletIds: string[] = [];
  const seen = new Set<string>();

  for (const wallet of wallets) {
    if (!wallet.id || seen.has(wallet.id)) continue;
    seen.add(wallet.id);
    walletIds.push(wallet.id);
    if (walletIds.length >= MAX_WALLET_SET_SCOPE_WALLETS) break;
  }

  return walletIds;
}

export function buildConsoleScope(
  scopeId: string,
  wallets: Wallet[] = [],
): ConsoleScope {
  if (scopeId === AUTO_CONTEXT_ID || scopeId === GENERAL_SCOPE_ID) {
    return { kind: "general" };
  }
  if (scopeId === ALL_WALLETS_SCOPE_ID) {
    const walletIds = buildWalletSetScopeIds(wallets);
    return walletIds.length > 0
      ? { kind: "wallet_set", walletIds }
      : { kind: "general" };
  }
  return { kind: "wallet", walletId: scopeId };
}

export function buildConsoleClientContext(
  contextId: string,
  routeWalletId?: string | null,
): { mode: "auto"; routeWalletId?: string } | undefined {
  if (contextId !== AUTO_CONTEXT_ID) return undefined;
  return {
    mode: "auto",
    ...(routeWalletId ? { routeWalletId } : {}),
  };
}

export function getConsoleSetupErrorReason(
  error: unknown,
): ConsoleSetupReason | null {
  return getConsoleSetupReason(error);
}

export function isConsoleSetupError(error: unknown): boolean {
  return getConsoleSetupErrorReason(error) !== null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function getErrorDetails(error: unknown): string | undefined {
  const lines =
    error instanceof Error
      ? [`Name: ${error.name}`, `Message: ${error.message}`]
      : [`Error: ${formatDiagnosticValue(error)}`];
  const record = toRecord(error);
  const response = toRecord(record?.response);

  if (typeof record?.status === "number") {
    lines.push(`HTTP status: ${record.status}`);
  }
  if (typeof response?.code === "string") {
    lines.push(`Code: ${response.code}`);
  }
  if (typeof response?.requestId === "string") {
    lines.push(`Request ID: ${response.requestId}`);
  }
  if (response?.details !== undefined) {
    lines.push(`Details:\n${formatDiagnosticValue(response.details)}`);
  }

  return lines.filter(Boolean).join("\n");
}

export function getScopeLabel(scope: ConsoleScope, wallets: Wallet[]): string {
  if (scope.kind === "wallet") {
    return (
      wallets.find((wallet) => wallet.id === scope.walletId)?.name ??
      "Wallet scope"
    );
  }
  if (scope.kind === "wallet_set") {
    const visibleWalletIds = new Set(wallets.map((wallet) => wallet.id));
    return scope.walletIds.length > 0 &&
      scope.walletIds.length === visibleWalletIds.size &&
      scope.walletIds.every((walletId) => visibleWalletIds.has(walletId))
      ? "All visible wallets"
      : `${scope.walletIds.length} wallets`;
  }
  if (scope.kind === "object") return `${scope.objectType} scope`;
  if (scope.kind === "admin") return "Admin scope";
  return "General network";
}

export function getPromptTitle(prompt: ConsolePromptHistory): string {
  return prompt.title || prompt.prompt;
}

export function dedupePromptHistory(
  prompts: ConsolePromptHistory[],
): ConsolePromptHistory[] {
  const seen = new Set<string>();
  const deduped: ConsolePromptHistory[] = [];

  for (const prompt of prompts) {
    const key = buildPromptHistoryDedupeKey(prompt);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(prompt);
  }

  return deduped;
}

export function formatShortDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function summarizeTrace(trace: ConsoleToolTrace): string {
  if (trace.status === "failed") return trace.errorMessage || "Tool failed";
  if (trace.status === "denied") return "Denied by scope or sensitivity";
  if (!trace.facts) return "Completed";

  const entries = Object.entries(trace.facts).slice(0, 2);
  if (entries.length === 0) return "Completed";
  return entries
    .map(([key, value]) => `${key}: ${formatTraceValue(value)}`)
    .join(" · ");
}

function formatTraceValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") return `${Object.keys(value).length} fields`;
  return "value";
}

export function sortSessionsByUpdatedAt(
  sessions: ConsoleSession[],
): ConsoleSession[] {
  return [...sessions].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function mergeSession(
  sessions: ConsoleSession[],
  session: ConsoleSession,
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
      role: "user",
      content: turn.prompt,
      createdAt: turn.createdAt,
      promptHistoryId: turn.promptHistoryId,
    },
    {
      id: `${turn.id}:response`,
      role: "assistant",
      content: turn.response || responsePlaceholder(turn.state),
      createdAt: turn.completedAt || turn.createdAt,
      details: getTurnDetails(turn, turn.toolTraces ?? []),
      state: turn.state,
      traces: turn.toolTraces ?? [],
      promptHistoryId: turn.promptHistoryId,
    },
  ]);
}

export function compressConsoleMessages(
  messages: ConsoleMessage[],
  maxVisibleUnits = DEFAULT_VISIBLE_MESSAGE_UNITS,
): ConsoleMessageDisplayItem[] {
  const units = dedupeMessageUnits(buildMessageUnits(messages));
  const visibleUnitCount = Math.max(1, maxVisibleUnits);
  const compressedUnitCount = Math.max(0, units.kept.length - visibleUnitCount);
  const compressedUnits = units.kept.slice(0, compressedUnitCount);
  const visibleUnits = units.kept.slice(compressedUnitCount);
  const hiddenMessageCount =
    countUnitMessages(compressedUnits) + units.duplicateMessageCount;
  const hiddenTurnCount = compressedUnitCount + units.duplicateUnitCount;
  const visibleItems = visibleUnits.flatMap((unit) =>
    unit.messages.map(
      (message): ConsoleMessageDisplayItem => ({
        kind: "message",
        message,
      }),
    ),
  );

  if (hiddenMessageCount === 0) return visibleItems;

  return [
    {
      kind: "summary",
      id: "console-history-summary",
      hiddenMessageCount,
      hiddenTurnCount,
      duplicateTurnCount: units.duplicateUnitCount,
    },
    ...visibleItems,
  ];
}

export function appendTurnResult(
  messages: ConsoleMessage[],
  result: ConsoleTurnResult,
): ConsoleMessage[] {
  return [
    ...messages,
    {
      id: `${result.turn.id}:prompt`,
      role: "user",
      content: result.turn.prompt,
      createdAt: result.turn.createdAt,
      promptHistoryId: result.promptHistory.id,
    },
    {
      id: `${result.turn.id}:response`,
      role: "assistant",
      content: result.turn.response || responsePlaceholder(result.turn.state),
      createdAt: result.turn.completedAt || result.turn.createdAt,
      details: getTurnDetails(result.turn, result.toolTraces),
      state: result.turn.state,
      traces: result.toolTraces,
      promptHistoryId: result.promptHistory.id,
    },
  ];
}

export function appendPendingPrompt(
  messages: ConsoleMessage[],
  input: { id: string; prompt: string; createdAt: string },
): ConsoleMessage[] {
  return [
    ...messages,
    {
      id: input.id,
      role: "user",
      content: input.prompt,
      createdAt: input.createdAt,
    },
  ];
}

export function replacePendingPromptWithTurnResult(
  messages: ConsoleMessage[],
  pendingPromptId: string,
  result: ConsoleTurnResult,
): ConsoleMessage[] {
  return appendTurnResult(
    messages.filter((message) => message.id !== pendingPromptId),
    result,
  );
}

export function appendFailedAssistantMessage(
  messages: ConsoleMessage[],
  input: {
    id: string;
    content: string;
    createdAt: string;
    details?: string;
  },
): ConsoleMessage[] {
  return [
    ...messages,
    {
      id: input.id,
      role: "assistant",
      content: input.content,
      createdAt: input.createdAt,
      details: input.details,
      state: "failed",
    },
  ];
}

export function getTurnDetails(
  turn: ConsoleTurn,
  traces: ConsoleToolTrace[],
): string | undefined {
  const lines = [
    turn.state && turn.state !== "completed" ? `State: ${turn.state}` : "",
    turn.model ? `Model: ${turn.model}` : "",
    turn.providerProfileId ? `Provider profile: ${turn.providerProfileId}` : "",
    turn.plannedTools
      ? `Plan:\n${formatDiagnosticValue(turn.plannedTools)}`
      : "",
    turn.error ? `Error:\n${formatDiagnosticValue(turn.error)}` : "",
    ...traces.map(formatTraceDetails),
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

export function mergePromptHistory(
  prompts: ConsolePromptHistory[],
  prompt: ConsolePromptHistory,
): ConsolePromptHistory[] {
  return dedupePromptHistory([
    prompt,
    ...prompts.filter((entry) => entry.id !== prompt.id),
  ]);
}

function responsePlaceholder(state: string): string {
  return state === "failed"
    ? "The Console turn failed."
    : "No response was returned.";
}

function buildPromptHistoryDedupeKey(prompt: ConsolePromptHistory): string {
  return [
    normalizeMessageContent(prompt.prompt),
    prompt.maxSensitivity,
    JSON.stringify(prompt.scope ?? null),
  ].join("\n");
}

function buildMessageUnits(messages: ConsoleMessage[]): ConsoleMessageUnit[] {
  const units: ConsoleMessageUnit[] = [];
  let index = 0;

  while (index < messages.length) {
    const current = messages[index];
    const next = messages[index + 1];

    if (current && next && shouldPairMessages(current, next)) {
      const unitMessages = [current, next];
      units.push({
        id: current.id,
        messages: unitMessages,
        dedupeKey: buildUnitDedupeKey(unitMessages),
      });
      index += 2;
      continue;
    }

    if (current) {
      units.push({
        id: current.id,
        messages: [current],
        dedupeKey: null,
      });
    }
    index += 1;
  }

  return units;
}

function shouldPairMessages(
  current: ConsoleMessage,
  next: ConsoleMessage,
): boolean {
  if (current.role !== "user" || next.role !== "assistant") return false;

  const currentTurnId = getTurnId(current.id);
  const nextTurnId = getTurnId(next.id);
  if (currentTurnId && currentTurnId === nextTurnId) return true;

  return next.id.startsWith(`${current.id}:`);
}

function getTurnId(messageId: string): string | null {
  const match = messageId.match(/^(.*):(prompt|response)$/);
  return match?.[1] ?? null;
}

function buildUnitDedupeKey(messages: ConsoleMessage[]): string | null {
  const [prompt, response] = messages as [ConsoleMessage, ConsoleMessage];
  return [
    normalizeMessageContent(prompt.content),
    normalizeMessageContent(response.content),
    response.state ?? "",
    (response.traces ?? [])
      .map((trace) => `${trace.toolName}:${trace.status}`)
      .sort()
      .join(","),
  ].join("\n");
}

function normalizeMessageContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupeMessageUnits(units: ConsoleMessageUnit[]): {
  kept: ConsoleMessageUnit[];
  duplicateUnitCount: number;
  duplicateMessageCount: number;
} {
  const seen = new Set<string>();
  const keptReversed: ConsoleMessageUnit[] = [];
  let duplicateUnitCount = 0;
  let duplicateMessageCount = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;

    if (unit.dedupeKey && seen.has(unit.dedupeKey)) {
      duplicateUnitCount += 1;
      duplicateMessageCount += unit.messages.length;
      continue;
    }

    if (unit.dedupeKey) seen.add(unit.dedupeKey);
    keptReversed.push(unit);
  }

  return {
    kept: keptReversed.reverse(),
    duplicateUnitCount,
    duplicateMessageCount,
  };
}

function countUnitMessages(units: ConsoleMessageUnit[]): number {
  return units.reduce((count, unit) => count + unit.messages.length, 0);
}

function formatTraceDetails(trace: ConsoleToolTrace): string {
  return [
    `Tool: ${trace.toolName}`,
    `Status: ${trace.status}`,
    trace.sensitivity ? `Sensitivity: ${trace.sensitivity}` : "",
    trace.errorMessage ? `Error: ${trace.errorMessage}` : "",
    trace.facts ? `Facts:\n${formatDiagnosticValue(trace.facts)}` : "",
    trace.provenance
      ? `Provenance:\n${formatDiagnosticValue(trace.provenance)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDiagnosticValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
