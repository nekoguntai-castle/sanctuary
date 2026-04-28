import { assistantReadToolRegistry } from "../tools";
import { consoleRepository, walletRepository } from "../../repositories";
import { NotFoundError, ServiceUnavailableError } from "../../errors/ApiError";
import {
  auditService,
  AuditAction,
  AuditCategory,
} from "../../services/auditService";
import type { AssistantToolActor } from "../tools";
import {
  DEFAULT_CONSOLE_SCOPE,
  MAX_WALLET_SET_SCOPE_WALLETS,
  describeToolForPlanning,
  normalizePrompt,
  parseOptionalDate,
  parseStoredConsoleSensitivity,
  parseStoredConsoleScope,
  type ConsoleClientContext,
  type ConsoleScope,
  type ConsoleSensitivity,
  type ConsoleToolCall,
} from "./protocol";
import {
  planConsoleTools,
  synthesizeConsoleAnswer,
  type ConsoleGatewayContext,
} from "./modelGateway";
import {
  assertScopeAccess,
  executePlannedTool,
  toJson,
  traceForSynthesis,
} from "./toolExecution";

const MAX_TOOL_CALLS_PER_TURN = 5;

interface ConsoleAuditContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface RunConsoleTurnInput {
  sessionId?: string;
  prompt: string;
  scope?: ConsoleScope;
  clientContext?: ConsoleClientContext;
  maxSensitivity: ConsoleSensitivity;
  expiresAt?: string;
  toolCalls?: ConsoleToolCall[];
}

export interface ReplayConsolePromptInput {
  sessionId?: string;
  scope?: ConsoleScope;
  clientContext?: ConsoleClientContext;
  maxSensitivity?: ConsoleSensitivity;
  expiresAt?: string;
}

interface ResolvedConsoleContext {
  scope: ConsoleScope;
  planningContext?: ConsoleGatewayContext;
}

function actorUsername(actor: AssistantToolActor): string {
  return actor.username || actor.userId;
}

function summarizeToolTraceForAudit(
  trace: Awaited<ReturnType<typeof executePlannedTool>>,
) {
  return {
    toolName: trace.toolName,
    status: trace.status,
    sensitivity: trace.sensitivity,
    rowCount: trace.rowCount,
    walletCount: trace.walletCount,
    errorCode: trace.errorCode,
  };
}

function toolTraceSummary(
  trace: Awaited<ReturnType<typeof executePlannedTool>>,
): string {
  const facts =
    trace.facts && typeof trace.facts === "object"
      ? (trace.facts as Record<string, unknown>)
      : {};
  const summary =
    typeof facts.summary === "string" && facts.summary.trim()
      ? facts.summary.trim()
      : null;
  const detail = summary ?? trace.errorMessage ?? trace.status;
  return `${trace.toolName}: ${detail}`;
}

function buildSynthesisFallbackResponse(
  traces: Array<Awaited<ReturnType<typeof executePlannedTool>>>,
): string {
  const summaries = traces.slice(0, 8).map(toolTraceSummary);
  return [
    "The Console tools completed, but the configured AI provider did not return synthesis text.",
    ...summaries.map((summary) => `- ${summary}`),
  ].join("\n");
}

function selectAutoContextWallets<TWallet extends { id: string }>(
  wallets: TWallet[],
  routeWalletId?: string,
): TWallet[] {
  const routeWallet = routeWalletId
    ? wallets.find((wallet) => wallet.id === routeWalletId)
    : undefined;
  const selected = routeWallet ? [routeWallet] : [];

  for (const wallet of wallets) {
    if (wallet.id === routeWallet?.id) continue;
    selected.push(wallet);
    if (selected.length >= MAX_WALLET_SET_SCOPE_WALLETS) break;
  }

  return selected.slice(0, MAX_WALLET_SET_SCOPE_WALLETS);
}

async function resolveAutoConsoleContext(
  actor: AssistantToolActor,
  clientContext: ConsoleClientContext,
): Promise<ResolvedConsoleContext> {
  const accessibleWallets = await walletRepository.findAccessibleWithSelect(
    actor.userId,
    { id: true, name: true, network: true },
  );
  const wallets = selectAutoContextWallets(
    accessibleWallets,
    clientContext.routeWalletId,
  );
  const currentWallet = clientContext.routeWalletId
    ? wallets.find((wallet) => wallet.id === clientContext.routeWalletId)
    : undefined;
  const scope: ConsoleScope =
    wallets.length > 0
      ? { kind: "wallet_set", walletIds: wallets.map((wallet) => wallet.id) }
      : DEFAULT_CONSOLE_SCOPE;

  return {
    scope,
    planningContext: {
      mode: "auto",
      ...(currentWallet
        ? {
            currentWalletId: currentWallet.id,
            currentWalletName: currentWallet.name,
          }
        : {}),
      wallets,
      ...(accessibleWallets.length > wallets.length
        ? { walletLimitApplied: true }
        : {}),
    },
  };
}

async function resolveConsoleContext(
  actor: AssistantToolActor,
  input: Pick<RunConsoleTurnInput, "scope" | "clientContext">,
): Promise<ResolvedConsoleContext> {
  if (input.scope) return { scope: input.scope };
  if (input.clientContext) {
    return resolveAutoConsoleContext(actor, input.clientContext);
  }
  return { scope: DEFAULT_CONSOLE_SCOPE };
}

async function resolveSession(input: {
  actor: AssistantToolActor;
  sessionId?: string;
  scope: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  expiresAt?: string;
}) {
  if (!input.sessionId) {
    return consoleRepository.createSession({
      userId: input.actor.userId,
      scope: toJson(input.scope),
      maxSensitivity: input.maxSensitivity,
      expiresAt: parseOptionalDate(input.expiresAt) ?? null,
    });
  }

  const session = await consoleRepository.findSessionForUser(
    input.sessionId,
    input.actor.userId,
  );
  if (!session) {
    throw new NotFoundError("Console session not found");
  }

  return consoleRepository.updateSessionScope(
    session.id,
    toJson(input.scope),
    input.maxSensitivity,
  );
}

async function getPlannedToolCalls(input: {
  prompt: string;
  scope: ConsoleScope;
  planningContext?: ConsoleGatewayContext;
  toolCalls?: ConsoleToolCall[];
}) {
  if (input.toolCalls) {
    return {
      toolCalls: input.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN),
      warnings:
        input.toolCalls.length > MAX_TOOL_CALLS_PER_TURN
          ? ["tool_call_limit_applied"]
          : [],
      providerProfileId: undefined,
      model: undefined,
    };
  }

  return planConsoleTools({
    prompt: input.prompt,
    scope: input.scope,
    ...(input.planningContext ? { context: input.planningContext } : {}),
    maxToolCalls: MAX_TOOL_CALLS_PER_TURN,
    tools: assistantReadToolRegistry.list().map(describeToolForPlanning),
  });
}

async function auditConsoleTurn(
  actor: AssistantToolActor,
  success: boolean,
  details: Record<string, unknown>,
  audit?: ConsoleAuditContext,
  errorMsg?: string,
): Promise<void> {
  await auditService.log({
    userId: actor.userId,
    username: actorUsername(actor),
    action: success
      ? AuditAction.CONSOLE_TURN
      : AuditAction.CONSOLE_TURN_FAILED,
    category: AuditCategory.CONSOLE,
    details,
    success,
    errorMsg,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });
}

export function listConsoleTools(actor: AssistantToolActor) {
  return assistantReadToolRegistry.list().map((definition) => ({
    ...describeToolForPlanning(definition),
    available:
      definition.requiredScope.kind !== "admin" &&
      definition.requiredScope.kind !== "audit"
        ? true
        : actor.isAdmin,
    budgets: definition.budgets,
  }));
}

export async function createConsoleSession(input: {
  actor: AssistantToolActor;
  title?: string;
  scope?: ConsoleScope;
  maxSensitivity: ConsoleSensitivity;
  expiresAt?: string;
}) {
  const scope = input.scope ?? DEFAULT_CONSOLE_SCOPE;
  await assertScopeAccess(input.actor, scope);
  return consoleRepository.createSession({
    userId: input.actor.userId,
    title: input.title,
    scope: toJson(scope),
    maxSensitivity: input.maxSensitivity,
    expiresAt: parseOptionalDate(input.expiresAt) ?? null,
  });
}

export function listConsoleSessions(
  actor: AssistantToolActor,
  limit: number,
  offset: number,
) {
  return consoleRepository.listSessions(actor.userId, limit, offset);
}

export async function deleteConsoleSession(
  actor: AssistantToolActor,
  sessionId: string,
) {
  const session = await consoleRepository.findSessionForUser(
    sessionId,
    actor.userId,
  );
  if (!session) throw new NotFoundError("Console session not found");
  return consoleRepository.softDeleteSession(session.id);
}

export async function listConsoleTurns(
  actor: AssistantToolActor,
  sessionId: string,
  limit = 100,
) {
  const session = await consoleRepository.findSessionForUser(
    sessionId,
    actor.userId,
  );
  if (!session) throw new NotFoundError("Console session not found");
  return consoleRepository.listTurns(session.id, limit);
}

export async function runConsoleTurn(
  actor: AssistantToolActor,
  input: RunConsoleTurnInput,
  audit?: ConsoleAuditContext,
) {
  const { scope, planningContext } = await resolveConsoleContext(actor, input);
  await assertScopeAccess(actor, scope);
  const session = await resolveSession({
    actor,
    sessionId: input.sessionId,
    scope,
    maxSensitivity: input.maxSensitivity,
    expiresAt: input.expiresAt,
  });
  const turn = await consoleRepository.createTurn({
    sessionId: session.id,
    prompt: input.prompt,
    scope: toJson(scope),
    maxSensitivity: input.maxSensitivity,
    state: "accepted",
  });
  const promptHistory = await consoleRepository.createPrompt({
    userId: actor.userId,
    sessionId: session.id,
    turnId: turn.id,
    prompt: input.prompt,
    normalizedPrompt: normalizePrompt(input.prompt),
    scope: toJson(scope),
    maxSensitivity: input.maxSensitivity,
    expiresAt: parseOptionalDate(input.expiresAt) ?? session.expiresAt,
  });
  await consoleRepository.attachPromptToTurn(turn.id, promptHistory.id);

  const traces: Awaited<ReturnType<typeof executePlannedTool>>[] = [];
  try {
    await consoleRepository.updateTurnState(turn.id, "planning");
    const plan = await getPlannedToolCalls({
      prompt: input.prompt,
      scope,
      planningContext,
      toolCalls: input.toolCalls,
    });
    await consoleRepository.updateTurnState(turn.id, "executing_tools");
    for (const call of plan.toolCalls) {
      traces.push(
        await executePlannedTool({
          call,
          turnId: turn.id,
          scope,
          maxSensitivity: input.maxSensitivity,
          actor,
        }),
      );
    }
    await consoleRepository.updateTurnState(turn.id, "synthesizing");
    let synthesisFallbackApplied = false;
    const synthesis = await synthesizeConsoleAnswer({
      prompt: input.prompt,
      scope,
      ...(planningContext ? { context: planningContext } : {}),
      toolResults: traces.map(traceForSynthesis),
    }).catch((error) => {
      if (traces.length === 0) throw error;
      synthesisFallbackApplied = true;
      return {
        response: buildSynthesisFallbackResponse(traces),
        providerProfileId: plan.providerProfileId,
        model: plan.model,
      };
    });
    const providerProfileId =
      plan.providerProfileId ?? synthesis.providerProfileId;
    const model = plan.model ?? synthesis.model;
    const warnings = [
      ...plan.warnings,
      ...(synthesisFallbackApplied ? ["synthesis_fallback_applied"] : []),
    ];
    const completedTurn = await consoleRepository.completeTurn({
      id: turn.id,
      response: synthesis.response,
      providerProfileId,
      model,
      plannedTools: toJson({
        toolCalls: plan.toolCalls,
        warnings,
      }),
    });
    await consoleRepository.updatePromptMetadata({
      id: promptHistory.id,
      tools: toJson(plan.toolCalls.map((call) => call.name)),
      providerProfileId,
      model,
    });
    await auditConsoleTurn(
      actor,
      true,
      {
        sessionId: session.id,
        turnId: turn.id,
        toolCount: traces.length,
        tools: traces.map(summarizeToolTraceForAudit),
        planningWarnings: warnings,
        scopeKind: scope.kind,
      },
      audit,
    );
    return { session, turn: completedTurn, promptHistory, toolTraces: traces };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Console turn failed";
    await consoleRepository.failTurn(turn.id, toJson({ message }));
    await auditConsoleTurn(
      actor,
      false,
      {
        sessionId: session.id,
        turnId: turn.id,
        toolCount: traces.length,
        tools: traces.map(summarizeToolTraceForAudit),
        scopeKind: scope.kind,
      },
      audit,
      message,
    );
    if (error instanceof ServiceUnavailableError) throw error;
    throw error;
  }
}

export function listPromptHistory(
  actor: AssistantToolActor,
  input: {
    limit: number;
    offset: number;
    search?: string;
    saved?: boolean;
    includeExpired?: boolean;
  },
) {
  return consoleRepository.listPrompts(
    actor.userId,
    {
      search: input.search ? normalizePrompt(input.search) : undefined,
      saved: input.saved,
      includeExpired: input.includeExpired,
    },
    input.limit,
    input.offset,
  );
}

export async function updatePromptHistory(
  actor: AssistantToolActor,
  promptId: string,
  input: {
    saved?: boolean;
    title?: string | null;
    expiresAt?: string | null;
  },
) {
  const prompt = await consoleRepository.findPromptForUser(
    promptId,
    actor.userId,
  );
  if (!prompt) throw new NotFoundError("Console prompt not found");
  return consoleRepository.updatePrompt({
    id: prompt.id,
    saved: input.saved,
    title: input.title,
    expiresAt: parseOptionalDate(input.expiresAt),
  });
}

export async function deletePromptHistory(
  actor: AssistantToolActor,
  promptId: string,
) {
  const prompt = await consoleRepository.findPromptForUser(
    promptId,
    actor.userId,
  );
  if (!prompt) throw new NotFoundError("Console prompt not found");
  return consoleRepository.softDeletePrompt(prompt.id);
}

export function clearPromptHistory(actor: AssistantToolActor) {
  return consoleRepository.softDeletePromptsForUser(actor.userId);
}

export async function replayPromptHistory(
  actor: AssistantToolActor,
  promptId: string,
  input: ReplayConsolePromptInput,
  audit?: ConsoleAuditContext,
) {
  const prompt = await consoleRepository.findPromptForUser(
    promptId,
    actor.userId,
  );
  if (!prompt) throw new NotFoundError("Console prompt not found");

  await consoleRepository.markPromptReplayed(prompt.id);
  const storedScope = input.clientContext
    ? undefined
    : parseStoredConsoleScope(prompt.scope);
  return runConsoleTurn(
    actor,
    {
      sessionId: input.sessionId ?? prompt.sessionId ?? undefined,
      prompt: prompt.prompt,
      scope: input.scope ?? storedScope,
      clientContext: input.clientContext,
      maxSensitivity:
        input.maxSensitivity ??
        parseStoredConsoleSensitivity(prompt.maxSensitivity),
      expiresAt: input.expiresAt,
    },
    audit,
  );
}

export function purgeExpiredPromptHistory(now?: Date) {
  return consoleRepository.purgeExpiredPromptHistory(now);
}
